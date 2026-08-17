import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { StringValue } from 'ms';
import { randomUUID } from 'node:crypto';
import {
  gerarLoginOperador,
  hashSenhaFuncionario,
  limparCpf,
} from '../../common/prisma/operator-auth.helper';
import {
  ehComboioTipo,
  ehCondutorDoEquipamentoRow,
  parseCondutoresIds,
} from '../../common/prisma/equipment-api.mapper';
import { mapOperatorToApi } from '../../common/prisma/operator-api.mapper';
import { companyWhere, resolverCompanyId } from '../../common/prisma/company-resolver';
import { PrismaService } from '../../prisma/prisma.service';
import type { Prisma } from '../../prisma/generated/client';
import { CreateFuncionarioDto } from './dto/create-funcionario.dto';
import { AuthFuncionarioDto } from './dto/auth-funcionario.dto';

export interface ImportResultado {
  criados: number;
  ignorados: number;
  erros: { linha: number; nome: string; cpf: string; motivo: string }[];
}

function parseDateOptional(value?: string): Date | null {
  if (!value?.trim()) return null;
  const t = Date.parse(value.trim());
  return Number.isFinite(t) ? new Date(t) : null;
}

@Injectable()
export class FuncionariosService {
  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  private async ehCondutorDeEquipamentoPg(
    companyId: string,
    operadorLegacyId: string,
    apenasComboio: boolean,
  ): Promise<boolean> {
    const rows = await this.prisma.equipment.findMany({
      where: { companyId },
      select: { tipo: true, condutoresIds: true },
    });
    return rows.some((e) => {
      const isComboio = ehComboioTipo(e.tipo);
      if (apenasComboio ? !isComboio : isComboio) return false;
      return ehCondutorDoEquipamentoRow(e, operadorLegacyId);
    });
  }

  private getJwtSecret(): string {
    const jwtSecret = this.configService.get<string>('JWT_SECRET') ?? '';
    if (!jwtSecret) {
      throw new Error('JWT_SECRET nao configurado no ambiente.');
    }
    return jwtSecret;
  }

  private async emitirJwtFuncionario(funcionario: {
    id: string;
    nome: string;
    cpf: string;
    cargo: string;
    loginGerado: string;
    prefeituraId: string;
  }) {
    const expiresIn = this.configService.get<string>('JWT_EXPIRES_IN') ?? '24h';
    const accessToken = await this.jwtService.signAsync(
      {
        sub: funcionario.loginGerado || funcionario.id,
        tipo: 'operador',
        cargo: funcionario.cargo,
        prefeituraId: funcionario.prefeituraId,
        funcionarioId: funcionario.id,
      },
      {
        secret: this.getJwtSecret(),
        expiresIn: expiresIn as StringValue,
      },
    );

    return {
      ok: true as const,
      funcionario,
      accessToken,
      tokenType: 'Bearer' as const,
      expiresIn,
      message: 'Login realizado com sucesso.',
    };
  }

  private buildOperatorCreateData(
    companyId: string,
    dto: CreateFuncionarioDto,
    legacyId: string,
  ): Prisma.OperatorCreateInput {
    const cpf = limparCpf(dto.cpf);
    const senhaInicial = dto.senha || cpf;
    const status = dto.status === 'inativo' ? 'inativo' : 'ativo';
    const cargo = (dto.cargo || '').trim() || null;

    return {
      legacyId,
      company: { connect: { id: companyId } },
      nome: (dto.nome || '').trim(),
      cpf,
      loginGerado: gerarLoginOperador(dto.nome, cpf),
      cargo,
      funcao: cargo,
      celular: dto.telefone?.trim() || null,
      tipo:
        dto.tipo === 'supervisor' || dto.tipo === 'admin' ? dto.tipo : 'operador',
      status,
      ativo: status !== 'inativo',
      senhaHash: hashSenhaFuncionario(cpf, senhaInicial),
      matricula: dto.matricula?.trim() || null,
      dataNascimento: parseDateOptional(dto.dataNascimento),
      rg: dto.rg?.trim() || null,
      cnh: dto.cnh?.replace(/\D/g, '') || null,
      cnhCategoria: dto.cnhCategoria?.trim() || null,
      cnhValidade: parseDateOptional(dto.cnhValidade),
      cnhLocalEmissao: dto.cnhLocalEmissao?.trim() || null,
      cnhEmissao: parseDateOptional(dto.cnhEmissao),
      cnhRestricao: dto.cnhRestricao?.trim() || null,
      observacoes: dto.observacoes?.trim() || null,
    };
  }

  private buildOperatorUpdateData(
    dto: CreateFuncionarioDto,
  ): Prisma.OperatorUpdateInput {
    const cpf = limparCpf(dto.cpf);
    const status = dto.status === 'inativo' ? 'inativo' : 'ativo';
    const cargo = (dto.cargo || '').trim() || null;
    const data: Prisma.OperatorUpdateInput = {
      nome: (dto.nome || '').trim(),
      cpf,
      loginGerado: gerarLoginOperador(dto.nome, cpf),
      cargo,
      funcao: cargo,
      celular: dto.telefone?.trim() || null,
      tipo:
        dto.tipo === 'supervisor' || dto.tipo === 'admin' ? dto.tipo : 'operador',
      status,
      ativo: status !== 'inativo',
      matricula: dto.matricula?.trim() || null,
      dataNascimento: parseDateOptional(dto.dataNascimento),
      rg: dto.rg?.trim() || null,
      cnh: dto.cnh?.replace(/\D/g, '') || null,
      cnhCategoria: dto.cnhCategoria?.trim() || null,
      cnhValidade: parseDateOptional(dto.cnhValidade),
      cnhLocalEmissao: dto.cnhLocalEmissao?.trim() || null,
      cnhEmissao: parseDateOptional(dto.cnhEmissao),
      cnhRestricao: dto.cnhRestricao?.trim() || null,
      observacoes: dto.observacoes?.trim() || null,
    };
    if (dto.senha) {
      data.senhaHash = hashSenhaFuncionario(cpf, dto.senha);
    }
    return data;
  }

  private async findOperatorOrThrow(id: string) {
    const row = await this.prisma.operator.findFirst({
      where: { OR: [{ id }, { legacyId: id }] },
      include: { company: { select: { legacyId: true } } },
    });
    if (!row) {
      throw new NotFoundException('Funcionário não encontrado.');
    }
    return row;
  }

  private async autenticarPostgres(dto: AuthFuncionarioDto) {
    const ident = (dto.identificador ?? '').trim();
    const senha = dto.senha ?? '';
    const limpo = limparCpf(ident);
    const ehCpf = limpo.length === 11;

    const rows = await this.prisma.operator.findMany({
      where: ehCpf
        ? { cpf: limpo }
        : { loginGerado: ident.toLowerCase() },
      include: { company: { select: { legacyId: true } } },
    });
    if (rows.length === 0) return null;

    let temSenha = false;
    let matched: (typeof rows)[number] | null = null;
    const appMotorista = dto.app === 'motorista';

    for (const row of rows) {
      if (!row.senhaHash) continue;
      temSenha = true;
      const cpfDoc = limparCpf(row.cpf ?? '');
      if (row.senhaHash !== hashSenhaFuncionario(cpfDoc, senha)) continue;

      const status = row.status ?? 'ativo';
      if (status !== 'ativo') {
        return { ok: false as const, msg: 'Funcionário inativo. Procure o gestor.' };
      }

      matched = row;
      break;
    }

    if (!matched) {
      if (temSenha) {
        return { ok: false as const, msg: 'Identificador ou senha incorretos.' };
      }
      return {
        ok: false as const,
        msg: 'Funcionário sem senha cadastrada. Procure o gestor.',
      };
    }

    const cpfDoc = limparCpf(matched.cpf ?? '');
    const funcionario = {
      id: matched.legacyId ?? matched.id,
      nome: matched.nome,
      cpf: cpfDoc,
      cargo: matched.cargo ?? matched.funcao ?? '',
      loginGerado: matched.loginGerado ?? gerarLoginOperador(matched.nome, cpfDoc),
      prefeituraId: matched.company.legacyId ?? '',
    };

    const ehCondutor = await this.ehCondutorDeEquipamentoPg(
      matched.companyId,
      funcionario.id,
      !appMotorista,
    );
    if (!ehCondutor) return null;

    return this.emitirJwtFuncionario(funcionario);
  }

  /** Login do operador/funcionário (app de campo). Somente Postgres. */
  async autenticar(dto: AuthFuncionarioDto) {
    const ident = (dto.identificador ?? '').trim();
    const senha = dto.senha ?? '';
    if (!ident || !senha) {
      return { ok: false, msg: 'Informe o CPF/usuário e a senha.' };
    }

    const pg = await this.autenticarPostgres(dto);
    if (pg !== null) return pg;

    return { ok: false, msg: 'Identificador ou senha incorretos.' };
  }

  async credenciaisOffline(
    prefeituraId: string,
    escopo: 'comboio' | 'prefeitura' = 'comboio',
  ): Promise<
    {
      id: string;
      cpf: string;
      loginGerado: string;
      nome: string;
      cargo: string;
      prefeituraId: string;
      senhaHash: string;
    }[]
  > {
    if (!prefeituraId) return [];

    const company = await this.prisma.company.findFirst({
      where: companyWhere(prefeituraId),
      select: { id: true },
    });
    if (!company) return [];

    if (escopo === 'prefeitura') {
      const ops = await this.prisma.operator.findMany({
        where: {
          companyId: company.id,
          status: 'ativo',
          senhaHash: { not: null },
        },
      });
      return ops
        .filter((op) => op.senhaHash)
        .map((op) => this.mapOperadorCredencialOffline(op, prefeituraId));
    }

    const equipRows = await this.prisma.equipment.findMany({
      where: { companyId: company.id },
      select: { tipo: true, condutoresIds: true },
    });
    const condutores = new Set<string>();
    for (const e of equipRows) {
      if (!ehComboioTipo(e.tipo)) continue;
      for (const id of parseCondutoresIds(e.condutoresIds)) condutores.add(id);
    }
    if (condutores.size === 0) return [];

    const ops = await this.prisma.operator.findMany({
      where: { companyId: company.id, status: 'ativo', senhaHash: { not: null } },
    });
    return ops
      .filter((op) => condutores.has(op.legacyId ?? op.id) && op.senhaHash)
      .map((op) => this.mapOperadorCredencialOffline(op, prefeituraId));
  }

  private mapOperadorCredencialOffline(
    op: {
      id: string;
      legacyId: string | null;
      cpf: string | null;
      loginGerado: string | null;
      nome: string;
      cargo: string | null;
      funcao: string | null;
      senhaHash: string | null;
    },
    prefeituraId: string,
  ) {
    const cpf = limparCpf(op.cpf ?? '');
    return {
      id: op.legacyId ?? op.id,
      cpf,
      loginGerado: op.loginGerado ?? gerarLoginOperador(op.nome, cpf),
      nome: op.nome,
      cargo: op.cargo ?? op.funcao ?? '',
      prefeituraId,
      senhaHash: op.senhaHash!,
    };
  }

  async create(prefeituraId: string, dto: CreateFuncionarioDto) {
    const companyId = await resolverCompanyId(this.prisma, prefeituraId);
    if (!companyId) {
      throw new NotFoundException('Empresa não encontrada.');
    }

    try {
      const legacyId = randomUUID();
      const row = await this.prisma.operator.create({
        data: this.buildOperatorCreateData(companyId, dto, legacyId),
      });
      return {
        data: { id: row.legacyId ?? row.id },
        message: 'Funcionário criado com sucesso!',
      };
    } catch (error) {
      console.error('Erro ao criar funcionário:', error);
      throw new InternalServerErrorException(
        'Não foi possível criar o funcionário.',
      );
    }
  }

  async findAllByPrefeitura(prefeituraId: string) {
    try {
      const company = await this.prisma.company.findFirst({
        where: companyWhere(prefeituraId),
        select: { id: true, legacyId: true },
      });
      if (!company) {
        return { data: [], message: 'Funcionários buscados com sucesso!' };
      }

      const rows = await this.prisma.operator.findMany({
        where: { companyId: company.id },
        orderBy: { createdAt: 'desc' },
      });
      const legacy = company.legacyId ?? prefeituraId;
      const data = rows.map((row) => mapOperatorToApi(row, legacy));
      return { data, message: 'Funcionários buscados com sucesso!' };
    } catch (error) {
      console.error('Erro ao buscar funcionários:', error);
      throw new InternalServerErrorException(
        'Não foi possível buscar os funcionários.',
      );
    }
  }

  async findById(id: string) {
    const row = await this.findOperatorOrThrow(id);
    const prefeituraId = row.company.legacyId ?? '';
    return {
      data: mapOperatorToApi(row, prefeituraId),
      message: 'OK',
    };
  }

  async update(id: string, dto: CreateFuncionarioDto) {
    const row = await this.findOperatorOrThrow(id);
    await this.prisma.operator.update({
      where: { id: row.id },
      data: this.buildOperatorUpdateData(dto),
    });
    return { data: {}, message: 'Funcionário atualizado com sucesso!' };
  }

  async remove(id: string) {
    const row = await this.findOperatorOrThrow(id);
    await this.prisma.operator.delete({ where: { id: row.id } });
    return { data: {}, message: 'Funcionário removido com sucesso!' };
  }

  async definirStatus(id: string, status: 'ativo' | 'inativo') {
    const row = await this.findOperatorOrThrow(id);
    const ativo = status !== 'inativo';
    await this.prisma.operator.update({
      where: { id: row.id },
      data: { status: ativo ? 'ativo' : 'inativo', ativo },
    });
    return { data: {}, message: 'Status atualizado.' };
  }

  /** Reseta a senha para o CPF (ação do gestor). */
  async resetarSenha(id: string) {
    const row = await this.findOperatorOrThrow(id);
    const cpf = limparCpf(row.cpf ?? '');
    if (!cpf) {
      throw new InternalServerErrorException(
        'CPF não definido — não dá para resetar.',
      );
    }
    await this.prisma.operator.update({
      where: { id: row.id },
      data: { senhaHash: hashSenhaFuncionario(cpf, cpf) },
    });
    return { data: {}, message: 'Senha resetada para o CPF.' };
  }

  async cpfEmUso(prefeituraId: string, cpf: string, ignorarId?: string) {
    const limpo = limparCpf(cpf);
    if (!limpo) return { data: { emUso: false }, message: 'OK' };

    const companyId = await resolverCompanyId(this.prisma, prefeituraId);
    if (!companyId) return { data: { emUso: false }, message: 'OK' };

    const rows = await this.prisma.operator.findMany({
      where: { companyId, cpf: limpo },
      select: { id: true, legacyId: true },
    });
    const emUso = rows.some(
      (r) => r.id !== ignorarId && (r.legacyId ?? r.id) !== ignorarId,
    );
    return { data: { emUso }, message: 'OK' };
  }

  /** Importa vários funcionários de uma vez, validando e deduplicando por CPF. */
  async importar(
    prefeituraId: string,
    linhas: CreateFuncionarioDto[],
  ): Promise<{ data: ImportResultado; message: string }> {
    const companyId = await resolverCompanyId(this.prisma, prefeituraId);
    if (!companyId) {
      throw new NotFoundException('Empresa não encontrada.');
    }

    try {
      const existentes = await this.prisma.operator.findMany({
        where: { companyId },
        select: { cpf: true },
      });
      const cpfsExistentes = new Set(
        existentes.map((r) => limparCpf(r.cpf ?? '')).filter(Boolean),
      );

      const vistos = new Set<string>();
      const erros: ImportResultado['erros'] = [];
      let criados = 0;

      await this.prisma.$transaction(async (tx) => {
        for (let i = 0; i < linhas.length; i++) {
          const row = linhas[i];
          const linha = i + 1;
          const nome = (row?.nome || '').trim();
          const cpf = limparCpf(row?.cpf || '');

          if (!nome) {
            erros.push({ linha, nome, cpf, motivo: 'Nome vazio' });
            continue;
          }
          if (cpf.length !== 11) {
            erros.push({
              linha,
              nome,
              cpf,
              motivo: 'CPF inválido (precisa de 11 dígitos)',
            });
            continue;
          }
          if (cpfsExistentes.has(cpf) || vistos.has(cpf)) {
            erros.push({ linha, nome, cpf, motivo: 'CPF já cadastrado' });
            continue;
          }

          vistos.add(cpf);
          cpfsExistentes.add(cpf);
          await tx.operator.create({
            data: this.buildOperatorCreateData(companyId, row, randomUUID()),
          });
          criados++;
        }
      });

      return {
        data: { criados, ignorados: erros.length, erros },
        message: `${criados} criado(s), ${erros.length} ignorado(s).`,
      };
    } catch (error) {
      console.error('Erro ao importar funcionários:', error);
      throw new InternalServerErrorException(
        'Não foi possível importar os funcionários.',
      );
    }
  }
}

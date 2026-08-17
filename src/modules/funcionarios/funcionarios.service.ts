import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { StringValue } from 'ms';
import * as admin from 'firebase-admin';
import { FirebaseService } from '../../config/firebase.service';
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
import { companyWhere } from '../../common/prisma/company-resolver';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateFuncionarioDto } from './dto/create-funcionario.dto';
import { AuthFuncionarioDto } from './dto/auth-funcionario.dto';

const COLECAO = 'operadores';
const BATCH_MAX = 450;

function tsToMillis(v: unknown): number {
  if (v && typeof (v as { toMillis?: () => number }).toMillis === 'function') {
    return (v as { toMillis: () => number }).toMillis();
  }
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : 0;
  }
  return 0;
}

export interface ImportResultado {
  criados: number;
  ignorados: number;
  erros: { linha: number; nome: string; cpf: string; motivo: string }[];
}

@Injectable()
export class FuncionariosService {
  constructor(
    private firebaseService: FirebaseService,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  private get firestore() {
    return this.firebaseService.getFirestore();
  }
  private get collection() {
    return this.firestore.collection(COLECAO);
  }

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

  /**
   * O funcionário é condutor responsável de algum equipamento da prefeitura?
   * Gate do PWA FleetFuel (motorista). Filtra em memória (sem índice composto).
   */
  private async ehCondutorDeEquipamento(
    prefeituraId: string,
    funcionarioId: string,
  ): Promise<boolean> {
    if (!prefeituraId || !funcionarioId) return false;
    const snap = await this.firestore
      .collection('equipamentos')
      .where('prefeituraId', '==', prefeituraId)
      .get();
    return snap.docs.some((d) => {
      const data = d.data() as { condutoresResponsaveis?: unknown };
      const condutores = Array.isArray(data.condutoresResponsaveis)
        ? data.condutoresResponsaveis
        : [];
      return condutores.includes(funcionarioId);
    });
  }

  /**
   * O funcionário é condutor responsável de pelo menos um comboio da prefeitura?
   * Gate do PWA do comboista — só condutores de comboio entram.
   */
  private async ehCondutorDeComboio(
    prefeituraId: string,
    funcionarioId: string,
  ): Promise<boolean> {
    if (!prefeituraId || !funcionarioId) return false;
    const snap = await this.firestore
      .collection('equipamentos')
      .where('prefeituraId', '==', prefeituraId)
      .get();
    return snap.docs.some((d) => {
      const data = d.data() as {
        tipo?: unknown;
        condutoresResponsaveis?: unknown;
      };
      const condutores = Array.isArray(data.condutoresResponsaveis)
        ? data.condutoresResponsaveis
        : [];
      return (
        String(data.tipo).toLowerCase() === 'comboio' &&
        condutores.includes(funcionarioId)
      );
    });
  }

  private getJwtSecret(): string {
    const jwtSecret = this.configService.get<string>('JWT_SECRET') ?? '';
    if (!jwtSecret) {
      throw new Error('JWT_SECRET nao configurado no ambiente.');
    }
    return jwtSecret;
  }

  private async emitirJwtFuncionario(
    funcionario: {
      id: string;
      nome: string;
      cpf: string;
      cargo: string;
      loginGerado: string;
      prefeituraId: string;
    },
  ) {
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

  /**
   * Login do operador/funcionário (app de campo). Somente Postgres.
   */
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
      .filter(
        (op) => condutores.has(op.legacyId ?? op.id) && op.senhaHash,
      )
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

  /** Campos do documento (sem createdAt/senha), compartilhado por criar/editar. */
  private basePayload(input: CreateFuncionarioDto) {
    const cpf = limparCpf(input.cpf);
    return {
      nome: (input.nome || '').trim(),
      cpf,
      loginGerado: gerarLoginOperador(input.nome, cpf),
      cargo: (input.cargo || '').trim(),
      telefone: input.telefone?.trim() || null,
      tipo:
        input.tipo === 'supervisor' || input.tipo === 'admin'
          ? input.tipo
          : 'operador',
      status: input.status === 'inativo' ? 'inativo' : 'ativo',
      matricula: input.matricula?.trim() || null,
      dataNascimento: input.dataNascimento?.trim() || null,
      rg: input.rg?.trim() || null,
      cnh: input.cnh?.replace(/\D/g, '') || null,
      cnhCategoria: input.cnhCategoria?.trim() || null,
      cnhValidade: input.cnhValidade?.trim() || null,
      cnhLocalEmissao: input.cnhLocalEmissao?.trim() || null,
      cnhEmissao: input.cnhEmissao?.trim() || null,
      cnhRestricao: input.cnhRestricao?.trim() || null,
      observacoes: input.observacoes?.trim() || null,
    };
  }

  private async getDocOrThrow(id: string) {
    const snap = await this.collection.doc(id).get();
    if (!snap.exists) {
      throw new NotFoundException('Funcionário não encontrado.');
    }
    return snap;
  }

  async create(prefeituraId: string, dto: CreateFuncionarioDto) {
    try {
      const cpf = limparCpf(dto.cpf);
      const senhaInicial = dto.senha || cpf;
      const ref = this.collection.doc();
      await ref.set({
        prefeituraId,
        ...this.basePayload(dto),
        senhaHash: hashSenhaFuncionario(cpf, senhaInicial),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return {
        data: { id: ref.id },
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
      if (company) {
        const rows = await this.prisma.operator.findMany({
          where: { companyId: company.id },
          orderBy: { createdAt: 'desc' },
        });
        if (rows.length > 0) {
          const legacy = company.legacyId ?? prefeituraId;
          const data = rows.map((row) => mapOperatorToApi(row, legacy));
          return { data, message: 'Funcionários buscados com sucesso!' };
        }
      }

      const snap = await this.collection
        .where('prefeituraId', '==', prefeituraId)
        .get();

      const data = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort(
          (a, b) =>
            tsToMillis((b as { createdAt?: unknown }).createdAt) -
            tsToMillis((a as { createdAt?: unknown }).createdAt),
        );

      // Backfill do loginGerado para docs legados (fire-and-forget).
      for (const d of snap.docs) {
        const x = d.data();
        if (x.loginGerado || !x.nome || !x.cpf) continue;
        const lg = gerarLoginOperador(String(x.nome), String(x.cpf));
        if (lg) {
          void this.collection
            .doc(d.id)
            .update({ loginGerado: lg })
            .catch(() => {});
        }
      }

      return { data, message: 'Funcionários buscados com sucesso!' };
    } catch (error) {
      console.error('Erro ao buscar funcionários:', error);
      throw new InternalServerErrorException(
        'Não foi possível buscar os funcionários.',
      );
    }
  }

  async findById(id: string) {
    const pg = await this.prisma.operator.findFirst({
      where: { OR: [{ id }, { legacyId: id }] },
      include: { company: { select: { legacyId: true } } },
    });
    if (pg) {
      const prefeituraId = pg.company.legacyId ?? '';
      return {
        data: mapOperatorToApi(pg, prefeituraId),
        message: 'OK',
      };
    }

    const snap = await this.getDocOrThrow(id);
    return { data: { id: snap.id, ...snap.data() }, message: 'OK' };
  }

  async update(id: string, dto: CreateFuncionarioDto) {
    await this.getDocOrThrow(id);
    const cpf = limparCpf(dto.cpf);
    const payload: Record<string, unknown> = {
      ...this.basePayload(dto),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (dto.senha) payload.senhaHash = hashSenhaFuncionario(cpf, dto.senha);
    await this.collection.doc(id).update(payload);
    return { data: {}, message: 'Funcionário atualizado com sucesso!' };
  }

  async remove(id: string) {
    await this.getDocOrThrow(id);
    await this.collection.doc(id).delete();
    return { data: {}, message: 'Funcionário removido com sucesso!' };
  }

  async definirStatus(id: string, status: 'ativo' | 'inativo') {
    await this.getDocOrThrow(id);
    await this.collection.doc(id).update({
      status: status === 'inativo' ? 'inativo' : 'ativo',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { data: {}, message: 'Status atualizado.' };
  }

  /** Reseta a senha para o CPF (ação do gestor). */
  async resetarSenha(id: string) {
    const snap = await this.getDocOrThrow(id);
    const cpf = limparCpf(String(snap.data()?.cpf ?? ''));
    if (!cpf) {
      throw new InternalServerErrorException(
        'CPF não definido — não dá para resetar.',
      );
    }
    await this.collection.doc(id).update({
      senhaHash: hashSenhaFuncionario(cpf, cpf),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { data: {}, message: 'Senha resetada para o CPF.' };
  }

  async cpfEmUso(prefeituraId: string, cpf: string, ignorarId?: string) {
    const limpo = limparCpf(cpf);
    if (!limpo) return { data: { emUso: false }, message: 'OK' };
    const snap = await this.collection
      .where('prefeituraId', '==', prefeituraId)
      .where('cpf', '==', limpo)
      .get();
    const emUso = snap.docs.some((d) => d.id !== ignorarId);
    return { data: { emUso }, message: 'OK' };
  }

  /** Importa vários funcionários de uma vez, validando e deduplicando por CPF. */
  async importar(
    prefeituraId: string,
    linhas: CreateFuncionarioDto[],
  ): Promise<{ data: ImportResultado; message: string }> {
    try {
      const existentesSnap = await this.collection
        .where('prefeituraId', '==', prefeituraId)
        .get();
      const cpfsExistentes = new Set(
        existentesSnap.docs
          .map((d) => limparCpf(String(d.data().cpf ?? '')))
          .filter(Boolean),
      );

      const vistos = new Set<string>();
      const erros: ImportResultado['erros'] = [];
      let criados = 0;
      let batch = this.firestore.batch();
      let pendentes = 0;

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
        const senhaInicial = row.senha || cpf;
        const ref = this.collection.doc();
        batch.set(ref, {
          prefeituraId,
          ...this.basePayload(row),
          senhaHash: hashSenhaFuncionario(cpf, senhaInicial),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        criados++;
        pendentes++;

        if (pendentes >= BATCH_MAX) {
          await batch.commit();
          batch = this.firestore.batch();
          pendentes = 0;
        }
      }

      if (pendentes > 0) await batch.commit();

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

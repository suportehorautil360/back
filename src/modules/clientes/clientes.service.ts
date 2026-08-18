import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Prisma } from '../../prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { resolverCompanyId, resolverEmpresa } from '../../common/prisma/company-resolver';
import {
  apiTypeToCompanyType,
  companyTypeToApi,
  mapCompanyToLegacyDoc,
  mapCompanyToOverview,
} from '../../common/prisma/company-prisma.mapper';
import { publicLegacyId } from '../../common/prisma/service-order-resolver';
import { slugUnicoEmpresa } from '../../common/prisma/slug.helper';
import { FirebaseService } from '../../config/firebase.service';
import {
  AcessoRow,
  ClienteOverviewRow,
  TipoClienteApi,
} from './clientes.types';
import { CreateClienteDto } from './dto/create-cliente.dto';
import { UpdateClienteDto } from './dto/update-cliente.dto';
import { CreateAcessoDto } from './dto/create-acesso.dto';
import { UpdateAcessoDto } from './dto/update-acesso.dto';
import { ResetSenhaAcessoDto } from './dto/reset-senha-acesso.dto';
import { ChecklistLoginConfigDto } from './dto/checklist-login-config.dto';

function hashSenha(senha: string): string {
  return createHash('sha256').update(senha, 'utf8').digest('hex');
}

function booleano(valor: unknown, padrao = false): boolean {
  return typeof valor === 'boolean' ? valor : padrao;
}

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor : '';
}

function isAcessoDoCliente(d: Record<string, unknown>): boolean {
  if (texto(d.postoId).trim() || texto(d.officinaId).trim()) return false;
  const vinculo = texto(d.vinculo).trim() || texto(d.type).trim();
  return vinculo === 'prefeitura' || vinculo === 'locacao';
}

function mapAcessoRow(id: string, d: Record<string, unknown>): AcessoRow {
  return {
    id,
    nome: texto(d.nome).trim(),
    usuario: texto(d.usuario).trim(),
    email: texto(d.email).trim(),
    whatsapp: texto(d.whatsapp).trim(),
    perfil: texto(d.perfil).trim() || 'gestor',
    notificaEmail: booleano(d.notificaEmail, true),
    notificaWhatsapp: booleano(d.notificaWhatsapp, false),
  };
}

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

@Injectable()
export class ClientesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly firebaseService: FirebaseService,
  ) {}

  async overview(): Promise<{ data: ClienteOverviewRow[] }> {
    try {
      const [companies, equipmentRows, checklistCounts] = await Promise.all([
        this.prisma.company.findMany({ orderBy: { name: 'asc' } }),
        this.prisma.equipment.findMany({
          select: { companyId: true, status: true },
        }),
        this.prisma.checklistRun.groupBy({
          by: ['companyId'],
          _count: { _all: true },
        }),
      ]);

      const frotaPorCliente = new Map<
        string,
        { ativos: number; emManutencao: number }
      >();
      for (const row of equipmentRows) {
        const atual = frotaPorCliente.get(row.companyId) ?? {
          ativos: 0,
          emManutencao: 0,
        };
        const status = row.status.toLowerCase();
        if (status === 'ativo') atual.ativos += 1;
        if (status === 'manutencao' || status === 'manutenção') {
          atual.emManutencao += 1;
        }
        frotaPorCliente.set(row.companyId, atual);
      }

      const checklistsPorCliente = new Map(
        checklistCounts.map((row) => [row.companyId, row._count._all]),
      );

      const data = companies.map((company) => {
        const frota = frotaPorCliente.get(company.id) ?? {
          ativos: 0,
          emManutencao: 0,
        };
        return mapCompanyToOverview(company, {
          ativos: frota.ativos,
          emManutencao: frota.emManutencao,
          checklists: checklistsPorCliente.get(company.id) ?? 0,
        });
      });

      return { data };
    } catch (error) {
      console.error('Erro ao montar overview de clientes:', error);
      throw new InternalServerErrorException(
        'Não foi possível carregar os clientes.',
      );
    }
  }

  async criar(dto: CreateClienteDto) {
    const nome = (dto.nome ?? '').trim();
    const uf = (dto.uf ?? '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .slice(0, 2);
    const contrato = dto.contrato;

    if (!nome || uf.length !== 2) {
      throw new BadRequestException('Informe o município e a UF com 2 letras.');
    }
    if (!contrato?.numero?.trim()) {
      throw new BadRequestException(
        'Informe o número do instrumento contratual.',
      );
    }
    if (!contrato?.objeto?.trim()) {
      throw new BadRequestException('Descreva o objeto do contrato.');
    }
    if (!contrato?.vigenciaInicio?.trim()) {
      throw new BadRequestException(
        'Informe o início da vigência do contrato.',
      );
    }

    const legacyId = randomUUID();
    const tipoCliente: TipoClienteApi =
      dto.tipoCliente === 'locacao' ? 'locacao' : 'prefeitura';
    const qtdInicialAtivos =
      typeof contrato.qtdInicialAtivos === 'number' &&
      contrato.qtdInicialAtivos >= 0
        ? contrato.qtdInicialAtivos
        : 0;

    const contractPayload = {
      numero: contrato.numero.trim(),
      processo: contrato.processo ?? '',
      modalidade: contrato.modalidade ?? 'pregao_eletronico',
      dataAssinatura: contrato.dataAssinatura ?? '',
      vigenciaInicio: contrato.vigenciaInicio,
      vigenciaFim: contrato.vigenciaFim ?? '',
      objeto: contrato.objeto.trim(),
      valorMensal: contrato.valorMensal ?? '',
      valorTotal: contrato.valorTotal ?? '',
      indiceReajuste: contrato.indiceReajuste ?? '',
      periodicidadeFaturamento: contrato.periodicidadeFaturamento ?? 'mensal',
      slaRespostaHoras: contrato.slaRespostaHoras ?? '',
      responsavelContratante: contrato.responsavelContratante ?? '',
      cargoContratante: contrato.cargoContratante ?? '',
      emailContratante: contrato.emailContratante ?? '',
      telefoneContratante: contrato.telefoneContratante ?? '',
      observacoes: contrato.observacoes ?? '',
      status: contrato.status ?? 'ativo',
      qtdInicialAtivos,
    };

    try {
      const slug = await slugUnicoEmpresa(this.prisma, nome, legacyId);
      const row = await this.prisma.company.create({
        data: {
          legacyId,
          name: nome,
          slug,
          type: apiTypeToCompanyType(tipoCliente),
          uf,
          cidade: (dto.cidade ?? '').trim() || null,
          cnpj: (dto.cnpj ?? '').trim() || null,
          caepf: (dto.caepf ?? '').trim() || null,
          whatsapp: (dto.whatsapp ?? '').trim() || null,
          contract: toInputJson(contractPayload),
        },
      });

      const dados = mapCompanyToLegacyDoc(row);
      return { data: dados, message: 'Cliente cadastrado com sucesso.' };
    } catch (error) {
      console.error('Erro ao salvar cliente:', error);
      throw new InternalServerErrorException(
        'Não foi possível salvar o cliente.',
      );
    }
  }

  async atualizar(clienteId: string, dto: UpdateClienteDto) {
    const company = await resolverEmpresa(this.prisma, clienteId);
    if (!company) {
      throw new NotFoundException('Cliente não encontrado.');
    }

    const atual = await this.prisma.company.findUniqueOrThrow({
      where: { id: company.id },
    });

    const data: Prisma.CompanyUpdateInput = {};

    if (dto.nome !== undefined) {
      const nome = (dto.nome ?? '').trim();
      if (!nome) throw new BadRequestException('Informe o município/nome.');
      data.name = nome;
    }
    if (dto.uf !== undefined) {
      const uf = (dto.uf ?? '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z]/g, '')
        .slice(0, 2);
      if (uf.length !== 2) {
        throw new BadRequestException('Informe a UF com 2 letras.');
      }
      data.uf = uf;
    }
    if (dto.tipoCliente !== undefined) {
      data.type = apiTypeToCompanyType(
        dto.tipoCliente === 'locacao' ? 'locacao' : 'prefeitura',
      );
    }
    for (const campo of ['cnpj', 'caepf', 'cidade', 'whatsapp'] as const) {
      if (dto[campo] !== undefined) {
        data[campo] = (dto[campo] ?? '').trim() || null;
      }
    }

    if (dto.contrato) {
      const contratoAtual =
        atual.contract && typeof atual.contract === 'object'
          ? (atual.contract as Record<string, unknown>)
          : {};
      data.contract = toInputJson({ ...contratoAtual, ...dto.contrato });
    }

    try {
      const row = await this.prisma.company.update({
        where: { id: company.id },
        data,
      });
      return {
        data: mapCompanyToLegacyDoc(row),
        message: 'Cliente atualizado com sucesso.',
      };
    } catch (error) {
      console.error('Erro ao atualizar cliente:', error);
      throw new InternalServerErrorException(
        'Não foi possível atualizar o cliente.',
      );
    }
  }

  async obter(clienteId: string) {
    try {
      const row = await resolverEmpresa(this.prisma, clienteId);
      if (!row) {
        throw new NotFoundException('Cliente não encontrado.');
      }
      const company = await this.prisma.company.findUniqueOrThrow({
        where: { id: row.id },
      });
      return { data: mapCompanyToLegacyDoc(company), message: 'Cliente encontrado.' };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      console.error('Erro ao buscar cliente:', error);
      throw new InternalServerErrorException(
        'Não foi possível buscar o cliente.',
      );
    }
  }

  /** Acessos ainda no Firestore `users` — migrar na onda auth. */
  async listarAcessos(clienteId: string): Promise<{ data: AcessoRow[] }> {
    const db = this.firebaseService.getFirestore();
    try {
      const snap = await db
        .collection('users')
        .where('prefeituraId', '==', clienteId)
        .get();

      const data: AcessoRow[] = snap.docs
        .map((doc) => {
          const d = doc.data() as Record<string, unknown>;
          if (!isAcessoDoCliente(d)) return null;
          return mapAcessoRow(doc.id, d);
        })
        .filter((row): row is AcessoRow => row !== null);
      return { data };
    } catch (error) {
      console.error('Erro ao listar acessos:', error);
      throw new InternalServerErrorException(
        'Não foi possível carregar os acessos.',
      );
    }
  }

  async criarAcesso(clienteId: string, dto: CreateAcessoDto) {
    const db = this.firebaseService.getFirestore();
    const nome = (dto.nome ?? '').trim();
    const usuario = (dto.usuario ?? '').trim();
    const senha = (dto.senha ?? '').trim();

    if (!nome || !usuario || !senha) {
      throw new BadRequestException('Preencha nome, login e senha inicial.');
    }
    if (senha.length < 4) {
      throw new BadRequestException('A senha deve ter no mínimo 4 caracteres.');
    }

    const company = await resolverEmpresa(this.prisma, clienteId);
    if (!company) {
      throw new NotFoundException('Cliente não encontrado.');
    }
    const full = await this.prisma.company.findUniqueOrThrow({
      where: { id: company.id },
    });
    const tipoCliente = companyTypeToApi(full.type);

    const duplicado = await db
      .collection('users')
      .where('usuario', '==', usuario)
      .get();
    if (!duplicado.empty) {
      throw new BadRequestException('Já existe um usuário com esse login.');
    }

    const perfil = dto.perfil === 'admin' ? 'admin' : 'gestor';
    const legacyPublicId = publicLegacyId(full);
    const novo = {
      id: randomUUID(),
      nome,
      usuario,
      senha: hashSenha(senha),
      perfil,
      type: tipoCliente,
      vinculo: tipoCliente,
      prefeituraId: legacyPublicId,
      email: (dto.email ?? '').trim(),
      whatsapp: (dto.whatsapp ?? '').trim(),
      notificaEmail: booleano(dto.notificaEmail, true),
      notificaWhatsapp: booleano(dto.notificaWhatsapp, true),
      mustChangePassword: true,
      createdAt: new Date().toISOString(),
    };

    try {
      const ref = await db.collection('users').add(novo);
      const data: AcessoRow = {
        id: ref.id,
        nome,
        usuario,
        email: novo.email,
        whatsapp: novo.whatsapp,
        perfil,
        notificaEmail: novo.notificaEmail,
        notificaWhatsapp: novo.notificaWhatsapp,
      };
      return { data, message: 'Usuário cadastrado com sucesso.' };
    } catch (error) {
      console.error('Erro ao salvar acesso:', error);
      throw new InternalServerErrorException(
        'Não foi possível salvar o acesso.',
      );
    }
  }

  async removerAcesso(acessoId: string) {
    if (!acessoId) {
      throw new BadRequestException('ID inválido.');
    }
    try {
      await this.firebaseService
        .getFirestore()
        .collection('users')
        .doc(acessoId)
        .delete();
      return { message: 'Acesso removido.' };
    } catch (error) {
      console.error('Erro ao remover acesso:', error);
      throw new InternalServerErrorException(
        'Não foi possível remover o acesso.',
      );
    }
  }

  private async carregarAcessoDoCliente(clienteId: string, acessoId: string) {
    const db = this.firebaseService.getFirestore();
    const ref = db.collection('users').doc(acessoId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new NotFoundException('Acesso não encontrado.');
    }
    const data = snap.data() as Record<string, unknown>;
    const company = await resolverEmpresa(this.prisma, clienteId);
    const legacyId = company
      ? publicLegacyId(
          await this.prisma.company.findUniqueOrThrow({
            where: { id: company.id },
          }),
        )
      : clienteId.trim();
    if (texto(data.prefeituraId).trim() !== legacyId) {
      throw new BadRequestException('Acesso não pertence a este cliente.');
    }
    if (!isAcessoDoCliente(data)) {
      throw new BadRequestException(
        'Este usuário não é um acesso de cliente (prefeitura/locação).',
      );
    }
    return { ref, data };
  }

  async atualizarAcesso(
    clienteId: string,
    acessoId: string,
    dto: UpdateAcessoDto,
  ) {
    const { ref, data } = await this.carregarAcessoDoCliente(
      clienteId,
      acessoId,
    );

    const patch: Record<string, unknown> = {};

    if (dto.nome !== undefined) {
      const nome = dto.nome.trim();
      if (!nome) throw new BadRequestException('Nome não pode ser vazio.');
      patch.nome = nome;
    }

    if (dto.usuario !== undefined) {
      const usuario = dto.usuario.trim();
      if (!usuario) throw new BadRequestException('Login não pode ser vazio.');
      if (usuario !== texto(data.usuario)) {
        const db = this.firebaseService.getFirestore();
        const duplicado = await db
          .collection('users')
          .where('usuario', '==', usuario)
          .get();
        const outro = duplicado.docs.find((doc) => doc.id !== acessoId);
        if (outro) {
          throw new BadRequestException('Já existe um usuário com esse login.');
        }
      }
      patch.usuario = usuario;
    }

    if (dto.perfil !== undefined) {
      patch.perfil = dto.perfil === 'admin' ? 'admin' : 'gestor';
    }

    if (dto.email !== undefined) patch.email = dto.email.trim();
    if (dto.whatsapp !== undefined) patch.whatsapp = dto.whatsapp.trim();
    if (dto.notificaEmail !== undefined) patch.notificaEmail = dto.notificaEmail;
    if (dto.notificaWhatsapp !== undefined) {
      patch.notificaWhatsapp = dto.notificaWhatsapp;
    }

    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('Nenhum campo para atualizar.');
    }

    try {
      await ref.update(patch);
      const atualizado = { ...data, ...patch };
      return {
        data: mapAcessoRow(acessoId, atualizado),
        message: 'Acesso atualizado.',
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      console.error('Erro ao atualizar acesso:', error);
      throw new InternalServerErrorException(
        'Não foi possível atualizar o acesso.',
      );
    }
  }

  async resetarSenhaAcesso(
    clienteId: string,
    acessoId: string,
    dto: ResetSenhaAcessoDto,
  ) {
    const { ref } = await this.carregarAcessoDoCliente(clienteId, acessoId);
    const senha = (dto.senha ?? '').trim();
    if (senha.length < 4) {
      throw new BadRequestException('A senha deve ter no mínimo 4 caracteres.');
    }

    try {
      await ref.update({
        senha: hashSenha(senha),
        mustChangePassword: true,
      });
      return { message: 'Senha redefinida com sucesso.' };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      console.error('Erro ao redefinir senha:', error);
      throw new InternalServerErrorException(
        'Não foi possível redefinir a senha.',
      );
    }
  }

  async atualizarChecklistLoginConfig(
    clienteId: string,
    config: ChecklistLoginConfigDto,
  ): Promise<void> {
    const company = await resolverEmpresa(this.prisma, clienteId);
    if (!company) {
      throw new NotFoundException(`Cliente ${clienteId} não encontrado.`);
    }
    await this.prisma.company.update({
      where: { id: company.id },
      data: {
        checklistLogin: toInputJson({
          cpfSenha: config.cpfSenha,
          chassi: config.chassi,
        }),
      },
    });
  }
}

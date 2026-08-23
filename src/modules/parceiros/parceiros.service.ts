import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { resolverCompanyId } from '../../common/prisma/company-resolver';
import {
  apiTypeToPartnerType,
  mapPartnerToDetalhe,
  mapPartnerToOficinaOverview,
  mapPartnerToPostoOverview,
} from '../../common/prisma/partner-prisma.mapper';
import { publicLegacyId } from '../../common/prisma/service-order-resolver';
import {
  OficinaParceiro,
  ParceiroDetalhe,
  ParceirosOverview,
  PostoParceiro,
  TipoParceiro,
} from './parceiros.types';
import { CreateParceiroDto } from './dto/create-parceiro.dto';
import { UpdateParceiroDto } from './dto/update-parceiro.dto';
import {
  CreateParceiroLoginDto,
  ResetParceiroLoginSenhaDto,
} from './dto/create-parceiro-login.dto';
import {
  hashSenhaOperacional,
  mapPartnerPortalUserToParceiroLoginRow,
  type ParceiroLoginRow,
} from './helpers/parceiro-login.helper';
import {
  credenciaisLoginAutomatico,
  type CredenciaisLoginAutomatico,
} from './helpers/gerar-credenciais-parceiro.helper';
import {
  especialidadeFromOficinaDoc,
  nomeFromOficinaDoc,
} from '../os/helpers/especialidade-oficina.helper';
import {
  linhasAtuacaoFromSegmentos,
  segmentosEfetivosCadastro,
} from '../os/helpers/segmento-equipamento.helper';

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor : '';
}

function numero(valor: unknown): number {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
  if (typeof valor === 'string') {
    const limpo = valor
      .replace(/[^0-9,.-]/g, '')
      .replace(/\./g, '')
      .replace(',', '.');
    const n = Number(limpo);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function listaTexto(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  return valor.filter((v): v is string => typeof v === 'string');
}

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

@Injectable()
export class ParceirosService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(prefeituraId?: string): Promise<{ data: ParceirosOverview }> {
    const filtroPref = (prefeituraId ?? '').trim();

    try {
      const [companies, partners] = await Promise.all([
        this.prisma.company.findMany({
          select: { id: true, legacyId: true, name: true, uf: true },
        }),
        this.prisma.partner.findMany({
          include: { company: { select: { legacyId: true } } },
        }),
      ]);

      const clientePorId = new Map<string, { nome: string; uf: string }>();
      for (const company of companies) {
        if (!company.legacyId) continue;
        clientePorId.set(company.legacyId, {
          nome: company.name,
          uf: company.uf ?? '',
        });
      }

      const localDoCliente = (legacyCompanyId: string): string => {
        const c = clientePorId.get(legacyCompanyId);
        if (!c || !c.nome) return '';
        return c.uf ? `${c.nome}/${c.uf}` : c.nome;
      };

      const postos: PostoParceiro[] = [];
      const oficinas: OficinaParceiro[] = [];

      for (const row of partners) {
        const prefId = row.company.legacyId ?? row.companyId;
        if (filtroPref && prefId !== filtroPref) continue;
        const localFallback = localDoCliente(prefId);

        if (row.type === 'POSTO') {
          postos.push(mapPartnerToPostoOverview(row, prefId, localFallback));
        } else {
          oficinas.push(mapPartnerToOficinaOverview(row, prefId, localFallback));
        }
      }

      postos.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
      oficinas.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

      return { data: { postos, oficinas } };
    } catch (error) {
      console.error('Erro ao montar overview de parceiros:', error);
      throw new InternalServerErrorException(
        'Não foi possível carregar os parceiros.',
      );
    }
  }

  async criar(dto: CreateParceiroDto) {
    const tipo: TipoParceiro = dto.tipo === 'oficina' ? 'oficina' : 'posto';
    const razaoSocial = (dto.razaoSocial ?? '').trim();
    if (!razaoSocial) {
      throw new BadRequestException('Informe a razão social do parceiro.');
    }

    const legacyId = randomUUID();
    const prefeituraId = (dto.prefeituraId ?? '').trim();
    let companyId: string | null = null;
    if (prefeituraId) {
      companyId = await resolverCompanyId(this.prisma, prefeituraId);
      if (!companyId) {
        throw new BadRequestException('prefeituraId inválido.');
      }
    } else {
      throw new BadRequestException(
        'Informe prefeituraId para credenciar o parceiro.',
      );
    }

    const baseData = {
      legacyId,
      companyId,
      type: apiTypeToPartnerType(tipo),
      razaoSocial,
      nomeFantasia: (dto.nomeFantasia ?? '').trim() || null,
      cnpj: (dto.cnpj ?? '').trim() || null,
      telefonePrincipal: (dto.telefonePrincipal ?? '').trim() || null,
      emailComercial: (dto.emailComercial ?? '').trim() || null,
      cidadeUf: (dto.cidadeUf ?? '').trim() || null,
      endereco: (dto.endereco ?? '').trim() || null,
      condicaoPagamento: (dto.condicaoPagamento ?? '').trim() || null,
      limiteCredito: numero(dto.limiteCredito) || null,
      descontoComercial: (dto.descontoComercial ?? '').trim() || null,
      observacoesFaturamento: (dto.observacoesFaturamento ?? '').trim() || null,
      status: 'ativo',
      ativo: true,
    };

    try {
      if (tipo === 'posto') {
        await this.prisma.partner.create({
          data: {
            ...baseData,
            bandeira: (dto.bandeira ?? '').trim() || null,
            combustiveis: toInputJson(listaTexto(dto.combustiveis)),
            servicos: toInputJson(listaTexto(dto.servicos)),
          },
        });
      } else {
        const categorias = listaTexto(dto.categoriasServico);
        const { segmentosAtuacao, linhasAtuacao } =
          this.resolverOficinaAtuacao(listaTexto(dto.segmentosAtuacao));
        const dadosOficina = {
          razaoSocial,
          nomeFantasia: baseData.nomeFantasia,
          segmentosAtuacao,
          linhasAtuacao,
          categoriasServico: categorias,
        };
        const especialidade =
          especialidadeFromOficinaDoc(dadosOficina) || categorias.join(', ');

        await this.prisma.partner.create({
          data: {
            ...baseData,
            especialidade,
            linhasAtuacao: toInputJson(linhasAtuacao),
            segmentosAtuacao: toInputJson(segmentosAtuacao),
            categoriasServico: toInputJson(categorias),
          },
        });
      }

      let login: CredenciaisLoginAutomatico | undefined;
      if (prefeituraId) {
        login = await this.provisionarLoginAutomatico(
          tipo,
          legacyId,
          prefeituraId,
          baseData.nomeFantasia || razaoSocial,
          baseData.nomeFantasia || razaoSocial || 'Gestor do parceiro',
        );
      }

      return {
        data: { id: legacyId, tipo, ...(login ? { login } : {}) },
        message: login
          ? 'Parceiro cadastrado. Login operacional criado automaticamente.'
          : 'Parceiro cadastrado.',
      };
    } catch (error) {
      console.error('Erro ao salvar parceiro:', error);
      throw new InternalServerErrorException(
        'Não foi possível salvar o parceiro.',
      );
    }
  }

  async obter(tipoStr: string, id: string): Promise<{ data: ParceiroDetalhe }> {
    const tipo: TipoParceiro = tipoStr === 'oficina' ? 'oficina' : 'posto';
    const docId = (id ?? '').trim();
    if (!docId) throw new BadRequestException('ID inválido.');

    const row = await this.prisma.partner.findFirst({
      where: {
        type: apiTypeToPartnerType(tipo),
        OR: [{ id: docId }, { legacyId: docId }],
      },
      include: { company: { select: { legacyId: true } } },
    });
    if (!row) {
      throw new NotFoundException('Parceiro não encontrado.');
    }

    return {
      data: mapPartnerToDetalhe(
        row,
        row.company.legacyId ?? row.companyId,
      ),
    };
  }

  async atualizar(tipoStr: string, id: string, dto: UpdateParceiroDto) {
    const tipo: TipoParceiro = tipoStr === 'oficina' ? 'oficina' : 'posto';
    const docId = (id ?? '').trim();
    if (!docId) throw new BadRequestException('ID inválido.');

    const atual = await this.prisma.partner.findFirst({
      where: {
        type: apiTypeToPartnerType(tipo),
        OR: [{ id: docId }, { legacyId: docId }],
      },
    });
    if (!atual) {
      throw new NotFoundException('Parceiro não encontrado.');
    }

    const razaoSocial = (dto.razaoSocial ?? atual.razaoSocial).trim();
    if (!razaoSocial) {
      throw new BadRequestException('Informe a razão social do parceiro.');
    }

    const comum: Prisma.PartnerUpdateInput = {
      razaoSocial,
      nomeFantasia: (dto.nomeFantasia ?? atual.nomeFantasia ?? '').trim() || null,
      cnpj: (dto.cnpj ?? atual.cnpj ?? '').trim() || null,
      telefonePrincipal:
        (dto.telefonePrincipal ?? atual.telefonePrincipal ?? '').trim() || null,
      emailComercial:
        (dto.emailComercial ?? atual.emailComercial ?? '').trim() || null,
      cidadeUf: (dto.cidadeUf ?? atual.cidadeUf ?? '').trim() || null,
      endereco: (dto.endereco ?? atual.endereco ?? '').trim() || null,
      condicaoPagamento:
        (dto.condicaoPagamento ?? atual.condicaoPagamento ?? '').trim() || null,
      limiteCredito:
        dto.limiteCredito !== undefined
          ? numero(dto.limiteCredito)
          : numero(atual.limiteCredito),
      descontoComercial:
        (dto.descontoComercial ?? atual.descontoComercial ?? '').trim() || null,
      observacoesFaturamento: (
        dto.observacoesFaturamento ?? atual.observacoesFaturamento ?? ''
      ).trim() || null,
    };

    try {
      if (tipo === 'posto') {
        await this.prisma.partner.update({
          where: { id: atual.id },
          data: {
            ...comum,
            bandeira: (dto.bandeira ?? atual.bandeira ?? '').trim() || null,
            combustiveis:
              dto.combustiveis !== undefined
                ? toInputJson(listaTexto(dto.combustiveis))
                : atual.combustiveis ?? undefined,
            servicos:
              dto.servicos !== undefined
                ? toInputJson(listaTexto(dto.servicos))
                : atual.servicos ?? undefined,
          },
        });
      } else {
        const categorias =
          dto.categoriasServico !== undefined
            ? listaTexto(dto.categoriasServico)
            : listaTexto(atual.categoriasServico);
        const segmentosInput =
          dto.segmentosAtuacao !== undefined
            ? listaTexto(dto.segmentosAtuacao)
            : segmentosEfetivosCadastro(
                listaTexto(atual.segmentosAtuacao),
                listaTexto(atual.linhasAtuacao),
              );
        const { segmentosAtuacao, linhasAtuacao } =
          this.resolverOficinaAtuacao(segmentosInput);

        const dadosOficina = {
          ...atual,
          razaoSocial,
          nomeFantasia: comum.nomeFantasia,
          linhasAtuacao,
          segmentosAtuacao,
          categoriasServico: categorias,
        };
        const nome = nomeFromOficinaDoc(dadosOficina, razaoSocial);
        const especialidade = especialidadeFromOficinaDoc(dadosOficina);

        await this.prisma.partner.update({
          where: { id: atual.id },
          data: {
            ...comum,
            linhasAtuacao: toInputJson(linhasAtuacao),
            segmentosAtuacao: toInputJson(segmentosAtuacao),
            categoriasServico: toInputJson(categorias),
            especialidade: especialidade || categorias.join(', '),
          },
        });

        await this.syncCredenciamentosOficina(publicLegacyId(atual), {
          linhasAtuacao,
          segmentosAtuacao,
          nome,
          especialidade: especialidade || categorias.join(', '),
        });
      }

      return {
        data: { id: publicLegacyId(atual), tipo },
        message: 'Parceiro atualizado.',
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Erro ao atualizar parceiro:', error);
      throw new InternalServerErrorException(
        'Não foi possível atualizar o parceiro.',
      );
    }
  }

  private resolverOficinaAtuacao(segmentosInput: string[]): {
    segmentosAtuacao: string[];
    linhasAtuacao: string[];
  } {
    const segmentosAtuacao = segmentosEfetivosCadastro(segmentosInput);
    if (segmentosAtuacao.length === 0) {
      throw new BadRequestException(
        'Marque ao menos um segmento de equipamento.',
      );
    }

    return {
      segmentosAtuacao,
      linhasAtuacao: linhasAtuacaoFromSegmentos(segmentosAtuacao),
    };
  }

  private async syncCredenciamentosOficina(
    parceiroId: string,
    dados: {
      linhasAtuacao: string[];
      segmentosAtuacao: string[];
      nome: string;
      especialidade: string;
    },
  ): Promise<void> {
    await this.prisma.partner.updateMany({
      where: {
        type: 'OFICINA',
        OR: [{ legacyId: parceiroId }, { id: parceiroId }],
      },
      data: {
        linhasAtuacao: toInputJson(dados.linhasAtuacao),
        segmentosAtuacao: toInputJson(dados.segmentosAtuacao),
        especialidade: dados.especialidade,
        nomeFantasia: dados.nome,
      },
    });
  }

  async remover(tipo: string, id: string) {
    if (!id) throw new BadRequestException('ID inválido.');
    const partnerType = tipo === 'oficina' ? 'OFICINA' : 'POSTO';

    const row = await this.prisma.partner.findFirst({
      where: {
        type: partnerType,
        OR: [{ id }, { legacyId: id }],
      },
    });
    if (!row) {
      throw new NotFoundException('Parceiro não encontrado.');
    }

    try {
      await this.prisma.partner.delete({ where: { id: row.id } });
      return { message: 'Parceiro removido.' };
    } catch (error) {
      console.error('Erro ao remover parceiro:', error);
      throw new InternalServerErrorException(
        'Não foi possível remover o parceiro.',
      );
    }
  }

  private async carregarParceiro(
    tipo: TipoParceiro,
    parceiroId: string,
  ): Promise<{ prefeituraId: string; legacyId: string }> {
    const id = parceiroId.trim();
    if (!id) throw new BadRequestException('ID do parceiro inválido.');

    const row = await this.prisma.partner.findFirst({
      where: {
        type: apiTypeToPartnerType(tipo),
        OR: [{ id }, { legacyId: id }],
      },
      include: { company: { select: { legacyId: true } } },
    });
    if (!row) {
      throw new NotFoundException('Parceiro não encontrado.');
    }

    const prefeituraId = row.company.legacyId ?? '';
    if (!prefeituraId) {
      throw new BadRequestException(
        'Parceiro sem cliente vinculado. Cadastre com prefeituraId.',
      );
    }
    return { prefeituraId, legacyId: publicLegacyId(row) };
  }

  /** Logins operacionais em `partner_portal_users`. */
  private async usuarioLoginDisponivel(usuario: string): Promise<boolean> {
    const row = await this.prisma.partnerPortalUser.findFirst({
      where: { usuario },
      select: { id: true },
    });
    return !row;
  }

  private async persistirLoginOperacional(
    tipo: TipoParceiro,
    parceiroId: string,
    prefeituraId: string,
    input: {
      nome: string;
      usuario: string;
      senha: string;
      perfil?: 'gestor' | 'admin';
    },
  ): Promise<ParceiroLoginRow> {
    const nome = input.nome.trim();
    const usuario = input.usuario.trim();
    const senha = input.senha.trim();
    if (!nome || !usuario || !senha) {
      throw new BadRequestException('Preencha nome, usuário e senha.');
    }
    if (senha.length < 4) {
      throw new BadRequestException('A senha deve ter no mínimo 4 caracteres.');
    }
    if (!(await this.usuarioLoginDisponivel(usuario))) {
      throw new ConflictException('Já existe um usuário com esse login.');
    }

    const companyId = await resolverCompanyId(this.prisma, prefeituraId);
    if (!companyId) {
      throw new BadRequestException('prefeituraId inválido.');
    }

    const partner = await this.prisma.partner.findFirst({
      where: {
        type: apiTypeToPartnerType(tipo),
        OR: [{ legacyId: parceiroId }, { id: parceiroId }],
        companyId,
      },
      select: { id: true, legacyId: true },
    });
    if (!partner) {
      throw new NotFoundException('Parceiro não encontrado.');
    }

    const perfil = input.perfil === 'admin' ? 'admin' : 'gestor';
    const legacyId = randomUUID();

    const created = await this.prisma.partnerPortalUser.create({
      data: {
        legacyId,
        companyId,
        partnerId: partner.id,
        partnerLegacyId: partner.legacyId ?? parceiroId.trim(),
        nome,
        usuario,
        email: usuario.includes('@') ? usuario.toLowerCase() : null,
        senhaHash: hashSenhaOperacional(senha),
        perfil,
        vinculo: tipo,
        status: 'ativo',
      },
    });

    return mapPartnerPortalUserToParceiroLoginRow(created, prefeituraId);
  }

  private async provisionarLoginAutomatico(
    tipo: TipoParceiro,
    parceiroId: string,
    prefeituraId: string,
    slugBase: string,
    nomeExibicao: string,
  ): Promise<CredenciaisLoginAutomatico> {
    let creds = credenciaisLoginAutomatico(tipo, parceiroId, {
      nomeExibicao,
      slugBase,
    });
    if (!(await this.usuarioLoginDisponivel(creds.usuario))) {
      creds = {
        ...creds,
        usuario: `${creds.usuario}.${creds.senhaInicial.slice(0, 4).toLowerCase()}`,
      };
    }
    await this.persistirLoginOperacional(tipo, parceiroId, prefeituraId, {
      nome: creds.nome,
      usuario: creds.usuario,
      senha: creds.senhaInicial,
      perfil: 'gestor',
    });
    return creds;
  }

  async listarLogins(
    tipo: string,
    parceiroId: string,
  ): Promise<{ data: ParceiroLoginRow[]; message: string }> {
    const t: TipoParceiro = tipo === 'oficina' ? 'oficina' : 'posto';
    const { prefeituraId, legacyId } = await this.carregarParceiro(t, parceiroId);

    try {
      const rows = await this.prisma.partnerPortalUser.findMany({
        where: {
          vinculo: t,
          OR: [
            { partnerLegacyId: legacyId },
            { partner: { legacyId } },
            { partnerId: parceiroId },
          ],
        },
        orderBy: { usuario: 'asc' },
      });

      const data = rows
        .map((row) => mapPartnerPortalUserToParceiroLoginRow(row, prefeituraId))
        .sort((a, b) => a.usuario.localeCompare(b.usuario, 'pt-BR'));

      return { data, message: 'Logins carregados com sucesso.' };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      console.error('Erro ao listar logins do parceiro:', error);
      throw new InternalServerErrorException(
        'Não foi possível carregar os logins.',
      );
    }
  }

  async criarLogin(
    tipo: string,
    parceiroId: string,
    dto: CreateParceiroLoginDto,
  ): Promise<{ data: ParceiroLoginRow; message: string }> {
    const t: TipoParceiro = tipo === 'oficina' ? 'oficina' : 'posto';
    const { prefeituraId, legacyId } = await this.carregarParceiro(t, parceiroId);

    try {
      const data = await this.persistirLoginOperacional(t, legacyId, prefeituraId, {
        nome: dto.nome ?? '',
        usuario: dto.usuario ?? '',
        senha: dto.senha ?? '',
        perfil: dto.perfil === 'admin' ? 'admin' : 'gestor',
      });
      return { data, message: 'Login criado com sucesso.' };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException
      ) {
        throw error;
      }
      console.error('Erro ao criar login do parceiro:', error);
      throw new InternalServerErrorException(
        'Não foi possível criar o login.',
      );
    }
  }

  async resetarLoginSenha(acessoId: string, dto: ResetParceiroLoginSenhaDto) {
    const id = acessoId.trim();
    const senha = (dto.senha ?? '').trim();
    if (!id) throw new BadRequestException('ID inválido.');
    if (senha.length < 4) {
      throw new BadRequestException('A senha deve ter no mínimo 4 caracteres.');
    }

    const row = await this.prisma.partnerPortalUser.findFirst({
      where: {
        OR: [{ id }, { legacyId: id }],
      },
      select: { id: true },
    });
    if (!row) {
      throw new NotFoundException('Login não encontrado.');
    }

    try {
      await this.prisma.partnerPortalUser.update({
        where: { id: row.id },
        data: { senhaHash: hashSenhaOperacional(senha) },
      });
      return { message: 'Senha redefinida.' };
    } catch (error) {
      console.error('Erro ao resetar senha do login:', error);
      throw new InternalServerErrorException(
        'Não foi possível redefinir a senha.',
      );
    }
  }

  async removerLogin(acessoId: string) {
    const id = acessoId.trim();
    if (!id) throw new BadRequestException('ID inválido.');

    const row = await this.prisma.partnerPortalUser.findFirst({
      where: {
        OR: [{ id }, { legacyId: id }],
      },
      select: { id: true },
    });
    if (!row) {
      throw new NotFoundException('Login não encontrado.');
    }

    try {
      await this.prisma.partnerPortalUser.delete({ where: { id: row.id } });
      return { message: 'Login removido.' };
    } catch (error) {
      console.error('Erro ao remover login:', error);
      throw new InternalServerErrorException(
        'Não foi possível remover o login.',
      );
    }
  }
}

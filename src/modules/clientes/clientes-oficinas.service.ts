import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { resolverCompanyId } from '../../common/prisma/company-resolver';
import { mapPartnerToCredenciadaListItem } from '../../common/prisma/partner-prisma.mapper';
import { publicLegacyId } from '../../common/prisma/service-order-resolver';
import {
  especialidadeFromOficinaDoc,
  nomeFromOficinaDoc,
} from '../os/helpers/especialidade-oficina.helper';
import {
  linhasAtuacaoFromSegmentos,
  segmentosEfetivosCadastro,
} from '../os/helpers/segmento-equipamento.helper';
import type { OficinaCredenciadaListItem } from './clientes-oficinas.types';

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function listaTexto(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  return valor.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
}

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

@Injectable()
export class ClientesOficinasService {
  constructor(private readonly prisma: PrismaService) {}

  async listarCredenciadas(
    prefeituraId: string,
  ): Promise<{ data: OficinaCredenciadaListItem[]; message: string }> {
    const companyId = await this.assertClienteExiste(prefeituraId);

    try {
      const rows = await this.prisma.partner.findMany({
        where: {
          companyId,
          type: 'OFICINA',
          ativo: true,
        },
      });

      const data = rows
        .map((row) => mapPartnerToCredenciadaListItem(row))
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

      return {
        data,
        message: 'Oficinas credenciadas carregadas com sucesso.',
      };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      console.error('Erro ao listar oficinas credenciadas:', error);
      throw new InternalServerErrorException(
        'Não foi possível listar as oficinas credenciadas.',
      );
    }
  }

  async credenciar(prefeituraId: string, parceiroId: string) {
    const companyId = await this.assertClienteExiste(prefeituraId);
    const pid = parceiroId.trim();

    const fonte = await this.prisma.partner.findFirst({
      where: {
        type: 'OFICINA',
        OR: [{ id: pid }, { legacyId: pid }],
      },
    });
    if (!fonte) {
      throw new NotFoundException('Parceiro oficina não encontrado.');
    }

    const shape = {
      razaoSocial: fonte.razaoSocial,
      nomeFantasia: fonte.nomeFantasia,
      nome: fonte.nomeFantasia ?? fonte.razaoSocial,
      segmentosAtuacao: fonte.segmentosAtuacao,
      linhasAtuacao: fonte.linhasAtuacao,
      categoriasServico: fonte.categoriasServico,
      especialidade: fonte.especialidade,
    };
    const nome = nomeFromOficinaDoc(shape, pid);
    const especialidade = especialidadeFromOficinaDoc(shape);
    if (!especialidade) {
      throw new BadRequestException(
        'Informe segmentosAtuacao ou categoriasServico no cadastro do parceiro.',
      );
    }

    const segmentosAtuacao = segmentosEfetivosCadastro(
      listaTexto(fonte.segmentosAtuacao),
      listaTexto(fonte.linhasAtuacao),
    );
    const linhasAtuacao = linhasAtuacaoFromSegmentos(segmentosAtuacao);

    try {
      if (fonte.companyId === companyId) {
        const row = await this.prisma.partner.update({
          where: { id: fonte.id },
          data: {
            ativo: true,
            status: 'ativo',
            especialidade,
            linhasAtuacao: toInputJson(linhasAtuacao),
            segmentosAtuacao: toInputJson(segmentosAtuacao),
          },
        });
        return {
          data: {
            id: publicLegacyId(row),
            prefeituraId,
            parceiroId: pid,
            status: 'Ativa',
          },
          message: 'Oficina credenciada no município.',
        };
      }

      const existente = await this.prisma.partner.findFirst({
        where: {
          companyId,
          type: 'OFICINA',
          OR: [{ legacyId: pid }, { razaoSocial: fonte.razaoSocial, cnpj: fonte.cnpj ?? undefined }],
        },
      });

      if (existente) {
        const row = await this.prisma.partner.update({
          where: { id: existente.id },
          data: {
            ativo: true,
            status: 'ativo',
            nomeFantasia: fonte.nomeFantasia,
            especialidade,
            linhasAtuacao: toInputJson(linhasAtuacao),
            segmentosAtuacao: toInputJson(segmentosAtuacao),
          },
        });
        return {
          data: {
            id: publicLegacyId(row),
            prefeituraId,
            parceiroId: pid,
            status: 'Ativa',
          },
          message: 'Oficina credenciada no município.',
        };
      }

      const credLegacyId = randomUUID();
      const row = await this.prisma.partner.create({
        data: {
          legacyId: credLegacyId,
          companyId,
          type: 'OFICINA',
          razaoSocial: fonte.razaoSocial,
          nomeFantasia: fonte.nomeFantasia,
          cnpj: fonte.cnpj,
          telefonePrincipal: fonte.telefonePrincipal,
          emailComercial: fonte.emailComercial,
          cidadeUf: fonte.cidadeUf,
          endereco: fonte.endereco,
          especialidade,
          linhasAtuacao: toInputJson(linhasAtuacao),
          segmentosAtuacao: toInputJson(segmentosAtuacao),
          categoriasServico: fonte.categoriasServico ?? toInputJson([]),
          condicaoPagamento: fonte.condicaoPagamento,
          limiteCredito: fonte.limiteCredito,
          status: 'ativo',
          ativo: true,
        },
      });

      return {
        data: {
          id: publicLegacyId(row),
          prefeituraId,
          parceiroId: pid,
          status: 'Ativa',
        },
        message: 'Oficina credenciada no município.',
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      console.error('Erro ao credenciar oficina:', error);
      throw new InternalServerErrorException(
        'Não foi possível credenciar a oficina.',
      );
    }
  }

  async descredenciar(prefeituraId: string, parceiroId: string) {
    const companyId = await this.assertClienteExiste(prefeituraId);
    const pid = parceiroId.trim();

    try {
      const rows = await this.prisma.partner.findMany({
        where: {
          companyId,
          type: 'OFICINA',
          ativo: true,
          OR: [{ id: pid }, { legacyId: pid }],
        },
      });

      if (rows.length === 0) {
        throw new NotFoundException(
          'Nenhum credenciamento ativo encontrado para este município.',
        );
      }

      await this.prisma.partner.updateMany({
        where: { id: { in: rows.map((row) => row.id) } },
        data: { ativo: false, status: 'Suspensa' },
      });

      return { message: 'Oficina descredenciada do município.' };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      console.error('Erro ao descredenciar oficina:', error);
      throw new InternalServerErrorException(
        'Não foi possível descredenciar a oficina.',
      );
    }
  }

  private async assertClienteExiste(prefeituraId: string): Promise<string> {
    const id = prefeituraId.trim();
    if (!id) throw new BadRequestException('prefeituraId inválido.');

    const companyId = await resolverCompanyId(this.prisma, id);
    if (!companyId) {
      throw new NotFoundException('Cliente (prefeitura) não encontrado.');
    }
    return companyId;
  }
}

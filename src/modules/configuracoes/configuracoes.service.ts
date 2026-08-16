import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FirebaseService } from '../../config/firebase.service';
import { resolverEmpresa } from '../../common/prisma/company-resolver';
import {
  mapConfiguracaoToApi,
  mapEscalaToApi,
} from '../../common/prisma/settings-api.mapper';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '../../prisma/generated/client';
import { UpsertConfiguracaoDto } from './dto/upsert-configuracao.dto';

@Injectable()
export class ConfiguracoesService {
  constructor(
    private firebaseService: FirebaseService,
    private readonly prisma: PrismaService,
  ) {}

  private get collection() {
    return this.firebaseService.getFirestore().collection('configuracoes');
  }

  /** Uma configuração por prefeitura: Postgres (CompanySettings) → Firestore. */
  async obter(prefeituraId: string) {
    try {
      const company = await this.prisma.company.findFirst({
        where: {
          OR: [{ legacyId: prefeituraId }, { id: prefeituraId }],
        },
        select: {
          id: true,
          legacyId: true,
          name: true,
          razaoSocial: true,
          cnpj: true,
          caepf: true,
          cidade: true,
          uf: true,
        },
      });

      if (company) {
        const settings = await this.prisma.companySettings.findUnique({
          where: { companyId: company.id },
        });
        const data = mapConfiguracaoToApi(
          prefeituraId,
          company,
          settings,
        );
        return { data, message: 'Configuração buscada com sucesso!' };
      }

      const snap = await this.collection
        .where('prefeituraId', '==', prefeituraId)
        .get();
      const data = snap.empty ? null : snap.docs[0].data();
      return { data, message: 'Configuração buscada com sucesso!' };
    } catch (error) {
      console.error('Erro ao buscar configuração:', error);
      throw new InternalServerErrorException(
        'Não foi possível buscar a configuração.',
      );
    }
  }

  /** Escala da jornada — lê de CompanySettings (Postgres). */
  async obterEscala(prefeituraId: string) {
    try {
      const company = await resolverEmpresa(this.prisma, prefeituraId, {
        id: true,
      });
      if (!company) {
        return { data: null, message: 'Escala não configurada.' };
      }

      const settings = await this.prisma.companySettings.findUnique({
        where: { companyId: company.id },
      });
      if (!settings) {
        return { data: null, message: 'Escala não configurada.' };
      }

      return {
        data: mapEscalaToApi(prefeituraId, settings),
        message: 'Escala buscada com sucesso!',
      };
    } catch (error) {
      console.error('Erro ao buscar escala:', error);
      throw new InternalServerErrorException(
        'Não foi possível buscar a escala.',
      );
    }
  }

  /** Cria ou atualiza a configuração da prefeitura (upsert por prefeituraId). */
  async salvar(dto: UpsertConfiguracaoDto) {
    try {
      const company = await this.prisma.company.findFirst({
        where: {
          OR: [{ legacyId: dto.prefeituraId }, { id: dto.prefeituraId }],
        },
        select: {
          id: true,
          legacyId: true,
          name: true,
          razaoSocial: true,
          cnpj: true,
          caepf: true,
          cidade: true,
          uf: true,
        },
      });

      if (company) {
        const alertas = (dto.alertas ?? {}) as Record<string, boolean>;
        const bloqueio = (dto.bloqueio ?? {}) as Record<string, boolean>;
        const intervalos = JSON.parse(
          JSON.stringify(dto.intervalos ?? {}),
        ) as Prisma.InputJsonValue;

        const settings = await this.prisma.companySettings.upsert({
          where: { companyId: company.id },
          create: {
            companyId: company.id,
            alertBloqueioRevisaoVencida:
              alertas.bloqueioRevisaoVencida ?? true,
            alertNivelCriticoTanque: alertas.nivelCriticoTanque ?? true,
            alertAbastecimentoIrregular:
              alertas.abastecimentoIrregular ?? true,
            alertCnhProximaVencimento: alertas.cnhProximaVencimento ?? true,
            alertRelatorioSemanal: alertas.relatorioSemanal ?? false,
            alertWhatsappEmergencia: alertas.whatsappEmergencia ?? false,
            bloquearAoVencer: bloqueio.bloquearAoVencer ?? true,
            alertar80: bloqueio.alertar80 ?? true,
            alertar90: bloqueio.alertar90 ?? true,
            intervalos,
          },
          update: {
            alertBloqueioRevisaoVencida:
              alertas.bloqueioRevisaoVencida ?? undefined,
            alertNivelCriticoTanque: alertas.nivelCriticoTanque ?? undefined,
            alertAbastecimentoIrregular:
              alertas.abastecimentoIrregular ?? undefined,
            alertCnhProximaVencimento:
              alertas.cnhProximaVencimento ?? undefined,
            alertRelatorioSemanal: alertas.relatorioSemanal ?? undefined,
            alertWhatsappEmergencia: alertas.whatsappEmergencia ?? undefined,
            bloquearAoVencer: bloqueio.bloquearAoVencer ?? undefined,
            alertar80: bloqueio.alertar80 ?? undefined,
            alertar90: bloqueio.alertar90 ?? undefined,
            intervalos,
          },
        });

        const data = mapConfiguracaoToApi(dto.prefeituraId, company, settings);
        return { data, message: 'Configuração atualizada com sucesso!' };
      }

      const snap = await this.collection
        .where('prefeituraId', '==', dto.prefeituraId)
        .get();

      const dados = {
        prefeituraId: dto.prefeituraId,
        empresa: dto.empresa ?? {},
        alertas: dto.alertas ?? {},
        intervalos: dto.intervalos ?? {},
        bloqueio: dto.bloqueio ?? {},
        atualizadoEm: new Date().toISOString(),
      };

      if (snap.empty) {
        const novo = { id: randomUUID(), ...dados };
        await this.collection.doc().set(novo);
        return { data: novo, message: 'Configuração criada com sucesso!' };
      }

      const docId = snap.docs[0].id;
      await this.collection.doc(docId).set(dados, { merge: true });
      return { data: dados, message: 'Configuração atualizada com sucesso!' };
    } catch (error) {
      console.error('Erro ao salvar configuração:', error);
      throw new InternalServerErrorException(
        'Não foi possível salvar a configuração.',
      );
    }
  }
}

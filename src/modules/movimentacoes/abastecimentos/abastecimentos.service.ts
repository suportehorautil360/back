import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mapAbastecimentoRowToDoc } from '../../../common/prisma/abastecimento-api.mapper';
import {
  atualizarMedicaoAtualPg,
  fetchEquipmentMapPg,
  resolveEquipmentByIdPg,
  resolveEquipmentByPlateOrChassisPg,
} from '../../../common/prisma/equipment-resolver';
import { mapPartnerPostoToApi } from '../../../common/prisma/partner-api.mapper';
import {
  companyWhere,
  resolverCompanyId,
} from '../../../common/prisma/company-resolver';
import { debitarTanquePrismaTx } from '../../../common/prisma/tank-saldo-prisma.helper';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CreateAbastecimentoDto,
  TipoMedicao,
} from './dto/create-abastecimento.dto';
import { CreateAbastecimentoMotoristaDto } from './dto/create-abastecimento-motorista.dto';
import {
  capacidadeAlvoAbastecimento,
  deveAtualizarMedicaoAtual,
  ehComboio,
  isSupportedMeasurementType,
  maiorLeituraRegistrada,
  parseLiters,
  resolveAbastecimentoPricing,
} from './helpers/abastecimentos-create.helper';
import {
  mensagemIntervaloAbastecimento,
  ultimoAbastecimentoTimestampMs,
  verificarIntervaloAbastecimento,
} from './helpers/intervalo-abastecimento.helper';
import {
  formatDateTime,
  parseDateEnd,
  parseDateStart,
} from '../shared/date.helper';
import { reverseGeocode } from '../shared/reverse-geocode.helper';
import { ehCombustivelDiesel } from '../../fleetfuel/helpers/fleetfuel-rules.helper';
import {
  formatReadingLabel,
  resolveCurrentReading,
  resolveLiters,
} from './abastecimentos.mapper';

export interface AbastecimentoDoc {
  id: string;
  prefeituraId: string;
  equipmentId: string;
  plateOrChassis: string;
  liters: number;
  tipo: string;
  measurementType: TipoMedicao;
  currentReading: number;
  meterPhoto?: string;
  pricePerLiter?: number | null;
  total?: number | null;
  postoId?: string;
  comboioId?: string;
  funcionarioId?: string;
  postoNome?: string;
  receiptPhoto?: string;
  origem?: string;
  status?: string;
  motoristaNome?: string;
  latitude: number;
  longitude: number;
  createdAt: string;
}

const ABASTECIMENTO_INCLUDE = {
  equipment: { select: { legacyId: true, placa: true, chassi: true } },
} as const;

@Injectable()
export class AbastecimentosService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateAbastecimentoDto): Promise<AbastecimentoDoc> {
    const liters = parseLiters(input.liters);
    if (liters === null) {
      throw new BadRequestException('O campo liters deve ser maior que zero.');
    }

    if (!isSupportedMeasurementType(input.measurementType)) {
      throw new BadRequestException(
        'O campo measurementType deve ser horimetro ou hodometro.',
      );
    }

    if (!input.plateOrChassis?.trim()) {
      throw new BadRequestException(
        'Informe a placa ou chassi do equipamento.',
      );
    }

    if (!Number.isFinite(Number(input.currentReading))) {
      throw new BadRequestException(
        'Informe a leitura atual (currentReading).',
      );
    }

    const companyId = await this.requireCompanyId(input.prefeituraId);
    const equipamento = await resolveEquipmentByPlateOrChassisPg(
      this.prisma,
      input.prefeituraId,
      input.plateOrChassis,
    );

    if (!ehCombustivelDiesel(equipamento.raw.combustivel)) {
      throw new BadRequestException(
        'O comboio só abastece equipamentos a diesel. Verifique o combustível cadastrado no equipamento.',
      );
    }

    const capacidadeAlvo = capacidadeAlvoAbastecimento(equipamento.raw);
    if (capacidadeAlvo > 0 && liters > capacidadeAlvo) {
      const ondeCabe = ehComboio(equipamento.raw.tipo)
        ? 'tanque do caminhão do comboio'
        : 'tanque do equipamento';
      throw new BadRequestException(
        `Acima da capacidade do ${ondeCabe}: ${liters} L solicitado(s), ` +
          `capacidade ${capacidadeAlvo} L.`,
      );
    }

    const leituraNova = Number(input.currentReading);
    const ultima = await this.ultimaLeitura(
      input.prefeituraId,
      equipamento.id,
      input.measurementType,
    );
    if (ultima !== null && leituraNova <= ultima) {
      const unidade = input.measurementType === 'horimetro' ? 'h' : 'km';
      throw new BadRequestException(
        `A leitura (${leituraNova.toLocaleString('pt-BR')} ${unidade}) deve ser maior ` +
          `que a última registrada para este equipamento (${ultima.toLocaleString('pt-BR')} ${unidade}).`,
      );
    }

    const pricing = resolveAbastecimentoPricing(
      liters,
      input.pricePerLiter,
      input.total,
    );

    const id = randomUUID();
    const postoId = input.postoId?.trim() || undefined;
    const comboioId = input.comboioId?.trim() || undefined;

    if (!postoId && !comboioId) {
      throw new BadRequestException(
        'Informe o comboio (comboioId) do qual o combustível foi retirado.',
      );
    }

    const now = new Date();
    const doc: AbastecimentoDoc = {
      id,
      prefeituraId: input.prefeituraId,
      equipmentId: equipamento.id,
      plateOrChassis: input.plateOrChassis,
      liters,
      tipo: 'comboio',
      measurementType: input.measurementType,
      currentReading: leituraNova,
      meterPhoto: input.meterPhoto,
      pricePerLiter: pricing.pricePerLiter,
      total: pricing.total,
      postoId,
      comboioId,
      funcionarioId: input.funcionarioId?.trim() || undefined,
      latitude: input.latitude,
      longitude: input.longitude,
      createdAt: now.toISOString(),
    };

    const createData = {
      id,
      legacyId: id,
      companyId,
      equipmentId: equipamento.equipmentUuid,
      operadorLegacyId: input.funcionarioId?.trim() || null,
      postoLegacyId: postoId ?? null,
      comboioLegacyId: comboioId ?? null,
      data: new Date(now.toISOString().slice(0, 10)),
      litros: liters.toFixed(3),
      valor: String(pricing.total ?? 0),
      origem: postoId ? 'posto' : 'comboio',
      leitura: leituraNova,
      leituraUnidade: input.measurementType === 'horimetro' ? 'h' : 'km',
      plateOrChassis: input.plateOrChassis.trim(),
      precoLitro:
        pricing.pricePerLiter != null
          ? pricing.pricePerLiter.toFixed(4)
          : null,
      status: 'aprovado',
      tipo: 'comboio',
      latitude: input.latitude,
      longitude: input.longitude,
      meterPhoto: input.meterPhoto ?? null,
      createdAt: now,
    };

    try {
      if (postoId) {
        await this.prisma.abastecimento.create({ data: createData });
      } else {
        await this.prisma.$transaction(async (tx) => {
          await debitarTanquePrismaTx(tx, comboioId as string, liters);
          await tx.abastecimento.create({ data: createData });
        });
      }

      if (
        deveAtualizarMedicaoAtual(
          equipamento.raw.unidadeRevisao,
          input.measurementType,
          equipamento.raw.medicaoAtual,
          leituraNova,
        )
      ) {
        await atualizarMedicaoAtualPg(
          this.prisma,
          equipamento.id,
          leituraNova,
        ).catch((e) =>
          console.error('Falha ao atualizar medicaoAtual do equipamento:', e),
        );
      }

      return doc;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Erro ao criar abastecimento:', error);
      throw new InternalServerErrorException(
        'Não foi possível registrar o abastecimento.',
      );
    }
  }

  async createManualMotorista(
    input: CreateAbastecimentoMotoristaDto,
  ): Promise<AbastecimentoDoc> {
    const liters = parseLiters(input.liters);
    if (liters === null) {
      throw new BadRequestException('O campo liters deve ser maior que zero.');
    }

    if (!isSupportedMeasurementType(input.measurementType)) {
      throw new BadRequestException(
        'O campo measurementType deve ser horimetro ou hodometro.',
      );
    }

    const postoNome = input.postoNome?.trim();
    if (!postoNome || postoNome.length < 2) {
      throw new BadRequestException('Informe o nome do posto.');
    }

    if (!input.meterPhoto?.trim()) {
      throw new BadRequestException('A foto do medidor é obrigatória.');
    }
    if (!input.receiptPhoto?.trim()) {
      throw new BadRequestException('A foto do cupom é obrigatória.');
    }

    if (!Number.isFinite(Number(input.currentReading))) {
      throw new BadRequestException(
        'Informe a leitura atual (currentReading).',
      );
    }

    const companyId = await this.requireCompanyId(input.prefeituraId);
    const equipamento = await resolveEquipmentByIdPg(
      this.prisma,
      input.prefeituraId,
      input.equipmentId,
    );

    if (!motoristaEhCondutor(equipamento.raw, input.funcionarioId)) {
      throw new BadRequestException(
        'Você não é condutor responsável deste equipamento.',
      );
    }

    const plateOrChassis = resolvePlateOrChassis(equipamento.raw);
    if (!plateOrChassis) {
      throw new BadRequestException(
        'Equipamento sem placa ou chassi cadastrado.',
      );
    }

    await this.assertIntervaloMinimoAbastecimento(
      input.prefeituraId,
      equipamento.id,
      equipamento.equipmentUuid,
    );

    const capacidadeAlvo = capacidadeAlvoAbastecimento(equipamento.raw);
    if (capacidadeAlvo > 0 && liters > capacidadeAlvo) {
      const ondeCabe = ehComboio(equipamento.raw.tipo)
        ? 'tanque do caminhão do comboio'
        : 'tanque do equipamento';
      throw new BadRequestException(
        `Acima da capacidade do ${ondeCabe}: ${liters} L solicitado(s), ` +
          `capacidade ${capacidadeAlvo} L.`,
      );
    }

    const leituraNova = Number(input.currentReading);
    const ultima = await this.ultimaLeitura(
      input.prefeituraId,
      equipamento.id,
      input.measurementType,
    );
    if (ultima !== null && leituraNova <= ultima) {
      const unidade = input.measurementType === 'horimetro' ? 'h' : 'km';
      throw new BadRequestException(
        `A leitura (${leituraNova.toLocaleString('pt-BR')} ${unidade}) deve ser maior ` +
          `que a última registrada para este equipamento (${ultima.toLocaleString('pt-BR')} ${unidade}).`,
      );
    }

    const pricing = resolveAbastecimentoPricing(
      liters,
      input.pricePerLiter,
      input.total,
    );

    const id = input.id?.trim() || randomUUID();
    const motoristaNome = await this.buscarNomeFuncionario(
      companyId,
      input.funcionarioId,
    );
    const now = new Date();

    const doc: AbastecimentoDoc = {
      id,
      prefeituraId: input.prefeituraId,
      equipmentId: equipamento.id,
      plateOrChassis,
      liters,
      tipo: 'manual_motorista',
      measurementType: input.measurementType,
      currentReading: leituraNova,
      meterPhoto: input.meterPhoto.trim(),
      receiptPhoto: input.receiptPhoto.trim(),
      pricePerLiter: pricing.pricePerLiter,
      total: pricing.total,
      postoNome,
      funcionarioId: input.funcionarioId.trim(),
      motoristaNome,
      origem: 'manual_motorista',
      status: 'pendente_aprovacao',
      latitude: input.latitude,
      longitude: input.longitude,
      createdAt: now.toISOString(),
    };

    try {
      await this.prisma.abastecimento.create({
        data: {
          id,
          legacyId: id,
          companyId,
          equipmentId: equipamento.equipmentUuid,
          operadorLegacyId: input.funcionarioId.trim(),
          data: new Date(now.toISOString().slice(0, 10)),
          litros: liters.toFixed(3),
          valor: String(pricing.total ?? 0),
          origem: 'posto',
          leitura: leituraNova,
          leituraUnidade: input.measurementType === 'horimetro' ? 'h' : 'km',
          plateOrChassis,
          precoLitro:
            pricing.pricePerLiter != null
              ? pricing.pricePerLiter.toFixed(4)
              : null,
          status: 'pendente_aprovacao',
          tipo: 'manual_motorista',
          postoNome,
          motoristaNome,
          latitude: input.latitude,
          longitude: input.longitude,
          meterPhoto: input.meterPhoto.trim(),
          receiptPhoto: input.receiptPhoto.trim(),
          createdAt: now,
        },
      });

      if (
        deveAtualizarMedicaoAtual(
          equipamento.raw.unidadeRevisao,
          input.measurementType,
          equipamento.raw.medicaoAtual,
          leituraNova,
        )
      ) {
        await atualizarMedicaoAtualPg(
          this.prisma,
          equipamento.id,
          leituraNova,
        ).catch((e) =>
          console.error('Falha ao atualizar medicaoAtual do equipamento:', e),
        );
      }

      return doc;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Erro ao criar abastecimento manual do motorista:', error);
      throw new InternalServerErrorException(
        'Não foi possível registrar o abastecimento.',
      );
    }
  }

  private async buscarNomeFuncionario(
    companyId: string,
    funcionarioId: string,
  ): Promise<string> {
    const id = funcionarioId.trim();
    if (!id) return '';
    try {
      const row = await this.prisma.operator.findFirst({
        where: {
          companyId,
          OR: [{ id }, { legacyId: id }],
        },
        select: { nome: true },
      });
      return row?.nome ?? '';
    } catch {
      return '';
    }
  }

  private async assertIntervaloMinimoAbastecimento(
    prefeituraId: string,
    equipmentPublicId: string,
    equipmentUuid: string,
  ): Promise<void> {
    const rows = await this.prisma.abastecimento.findMany({
      where: { equipmentId: equipmentUuid },
    });
    const docs = rows.map((row) =>
      mapAbastecimentoRowToDoc({ ...row, equipment: null }, prefeituraId),
    );
    const ultimoEmMs = ultimoAbastecimentoTimestampMs(
      docs,
      prefeituraId,
      equipmentPublicId,
    );
    const status = verificarIntervaloAbastecimento(ultimoEmMs);
    if (!status.liberado && status.proximoEmMs !== null) {
      throw new BadRequestException(
        mensagemIntervaloAbastecimento(status.proximoEmMs),
      );
    }
  }

  async ultimaLeitura(
    prefeituraId: string,
    equipmentPublicId: string,
    measurementType: TipoMedicao,
  ): Promise<number | null> {
    if (!equipmentPublicId) return null;

    const equip = await this.prisma.equipment.findFirst({
      where: {
        company: companyWhere(prefeituraId),
        OR: [{ id: equipmentPublicId }, { legacyId: equipmentPublicId }],
      },
      select: { id: true },
    });
    if (!equip) return null;

    const rows = await this.prisma.abastecimento.findMany({
      where: { equipmentId: equip.id },
    });
    const docs = rows.map((row) =>
      mapAbastecimentoRowToDoc({ ...row, equipment: null }, prefeituraId),
    );
    return maiorLeituraRegistrada(docs, prefeituraId, measurementType);
  }

  async ultimaLeituraPorPlaca(
    prefeituraId: string,
    plateOrChassis: string,
    measurementType: string,
  ): Promise<{ ultimaLeitura: number | null; measurementType: string }> {
    if (
      !plateOrChassis?.trim() ||
      !isSupportedMeasurementType(measurementType)
    ) {
      return { ultimaLeitura: null, measurementType };
    }
    try {
      const equip = await resolveEquipmentByPlateOrChassisPg(
        this.prisma,
        prefeituraId,
        plateOrChassis,
      );
      const ultimaLeitura = await this.ultimaLeitura(
        prefeituraId,
        equip.id,
        measurementType,
      );
      return { ultimaLeitura, measurementType };
    } catch {
      return { ultimaLeitura: null, measurementType };
    }
  }

  async listar(prefeituraId: string, startDate?: string, endDate?: string) {
    try {
      const companyId = await this.requireCompanyId(prefeituraId);
      const where: {
        companyId: string;
        createdAt?: { gte?: Date; lte?: Date };
      } = { companyId };

      if (startDate) {
        where.createdAt = {
          ...where.createdAt,
          gte: parseDateStart(startDate, 'startDate'),
        };
      }
      if (endDate) {
        where.createdAt = {
          ...where.createdAt,
          lte: parseDateEnd(endDate, 'endDate'),
        };
      }

      const rows = await this.prisma.abastecimento.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: ABASTECIMENTO_INCLUDE,
      });

      const docs = rows.map((row) =>
        mapAbastecimentoRowToDoc(row, prefeituraId),
      );
      const data = await this.formatAbastecimentosDocs(docs, prefeituraId);
      return { data, message: 'Abastecimentos buscados com sucesso!' };
    } catch (error) {
      console.error('Erro ao buscar abastecimentos:', error);
      throw new InternalServerErrorException(
        'Não foi possível buscar os abastecimentos.',
      );
    }
  }

  async listarPorPosto(
    postoId: string,
    startDate?: string,
    endDate?: string,
  ) {
    const id = postoId.trim();
    if (!id) {
      throw new BadRequestException('postoId inválido.');
    }

    try {
      const where: {
        postoLegacyId: string;
        createdAt?: { gte?: Date; lte?: Date };
      } = { postoLegacyId: id };

      if (startDate) {
        where.createdAt = {
          ...where.createdAt,
          gte: parseDateStart(startDate, 'startDate'),
        };
      }
      if (endDate) {
        where.createdAt = {
          ...where.createdAt,
          lte: parseDateEnd(endDate, 'endDate'),
        };
      }

      const rows = await this.prisma.abastecimento.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: ABASTECIMENTO_INCLUDE,
      });

      const docs = await Promise.all(
        rows.map(async (row) => {
          const company = await this.prisma.company.findUnique({
            where: { id: row.companyId },
            select: { legacyId: true },
          });
          return mapAbastecimentoRowToDoc(
            row,
            company?.legacyId ?? row.companyId,
          );
        }),
      );

      const prefeituraId = docs[0]?.prefeituraId ?? '';
      const data = await this.formatAbastecimentosDocs(docs, prefeituraId);
      return {
        data,
        message: 'Abastecimentos do posto buscados com sucesso!',
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Erro ao buscar abastecimentos do posto:', error);
      throw new InternalServerErrorException(
        'Não foi possível buscar os abastecimentos do posto.',
      );
    }
  }

  async remover(id: string) {
    try {
      const row = await this.prisma.abastecimento.findFirst({
        where: { OR: [{ id }, { legacyId: id }] },
      });
      if (!row) {
        throw new NotFoundException('Abastecimento não encontrado.');
      }
      await this.prisma.abastecimento.delete({ where: { id: row.id } });
      return {
        data: { id: row.legacyId ?? row.id },
        message: 'Abastecimento removido.',
      };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      console.error('Erro ao remover abastecimento:', error);
      throw new InternalServerErrorException(
        'Não foi possível remover o abastecimento.',
      );
    }
  }

  private async formatAbastecimentosDocs(
    docs: AbastecimentoDoc[],
    prefeituraId: string,
  ) {
    if (docs.length === 0) return [];

    const uniqueEquipmentIds = [
      ...new Set(docs.map((d) => d.equipmentId).filter(Boolean)),
    ];
    const uniquePostoIds = [
      ...new Set(
        docs.map((d) => d.postoId?.trim()).filter((pid): pid is string => !!pid),
      ),
    ];

    const [equipmentMap, postoMap] = await Promise.all([
      fetchEquipmentMapPg(this.prisma, uniqueEquipmentIds),
      this.fetchPostoMap(uniquePostoIds),
    ]);

    const formatted = await Promise.all(
      docs.map(async (doc) => {
        try {
          return await this.formatAbastecimento(doc, equipmentMap, postoMap);
        } catch (err) {
          console.error(`Falha ao formatar abastecimento ${doc.id}:`, err);
          return null;
        }
      }),
    );
    return formatted.filter((row): row is NonNullable<typeof row> => row != null);
  }

  private async fetchPostoMap(
    ids: string[],
  ): Promise<Map<string, Record<string, unknown>>> {
    const map = new Map<string, Record<string, unknown>>();
    if (!ids.length) return map;

    const partners = await this.prisma.partner.findMany({
      where: {
        OR: [{ id: { in: ids } }, { legacyId: { in: ids } }],
      },
    });

    for (const partner of partners) {
      const api = mapPartnerPostoToApi(partner, '') as Record<string, unknown>;
      const publicId = String(api.id);
      map.set(publicId, api);
      map.set(partner.id, api);
      if (partner.legacyId) map.set(partner.legacyId, api);
    }

    return map;
  }

  private resolveOrigin(
    doc: AbastecimentoDoc,
    postoMap: Map<string, Record<string, unknown>>,
  ): string {
    const raw = doc as unknown as Record<string, unknown>;
    if (!doc.postoId?.trim()) {
      if (raw.origem === 'comboio' || raw.tipo === 'comboio') {
        return 'Comboio';
      }
      const postoNome = asString(raw.postoNome ?? raw.local);
      if (postoNome) {
        const lower = postoNome.toLowerCase();
        if (lower.startsWith('posto ')) return postoNome;
        return `Posto ${postoNome}`;
      }
      return 'Comboio';
    }

    const posto = postoMap.get(doc.postoId.trim());
    const name = asString(posto?.nomeFantasia ?? posto?.name) || 'Credenciado';
    return `Posto ${name}`;
  }

  private async formatAbastecimento(
    doc: AbastecimentoDoc,
    equipmentMap: Map<string, Record<string, unknown>>,
    postoMap: Map<string, Record<string, unknown>>,
  ) {
    const raw = doc as unknown as Record<string, unknown>;
    const equipmentId = asString(doc.equipmentId ?? raw.equipamentoId);
    const equipment = equipmentMap.get(equipmentId) ?? {};
    const plateOrChassis = asString(
      doc.plateOrChassis ?? raw.placa ?? raw.chassis,
    );

    const vehicle = {
      name: asString(
        equipment.descricao ??
          equipment.label ??
          raw.veiculo ??
          plateOrChassis,
      ),
      plate: asString(
        equipment.placa ??
          equipment.chassis ??
          raw.placa ??
          plateOrChassis,
      ),
      type: asString(equipment.tipo ?? equipment.linha ?? raw.tipoVeiculo ?? '—'),
    };

    const readingLabel = formatReadingLabel(raw);
    const currentReading = resolveCurrentReading(raw);

    const hasCoords =
      Number.isFinite(Number(doc.latitude)) &&
      Number.isFinite(Number(doc.longitude)) &&
      !(Number(doc.latitude) === 0 && Number(doc.longitude) === 0);

    const local = hasCoords
      ? await reverseGeocode(Number(doc.latitude), Number(doc.longitude))
      : asString(raw.local) || null;

    const valorLegado = parseValorLegado(raw.valorTotal ?? raw.valor ?? raw.total);
    const precoLegado = parseValorLegado(raw.pricePerLiter ?? raw.precoLitro);

    return {
      id: doc.id,
      dateTime: formatDateTime(doc.createdAt),
      vehicle,
      origin: this.resolveOrigin(doc, postoMap),
      fuelType:
        asString(raw.tipoCombustivel) ||
        asString(raw.combustivel) ||
        asString(equipment.combustivel) ||
        null,
      motoristaNome:
        asString(raw.motoristaNome) ||
        asString(raw.motorista) ||
        null,
      liters: resolveLiters(raw),
      pricePerLiter:
        doc.pricePerLiter ?? (precoLegado > 0 ? precoLegado : null),
      value: doc.total ?? (valorLegado > 0 ? valorLegado : null),
      reading: readingLabel ?? '—',
      currentReading,
      measurementType: doc.measurementType ?? null,
      postoId: doc.postoId ?? null,
      comboioId: doc.comboioId ?? null,
      funcionarioId: doc.funcionarioId ?? null,
      meterPhoto: doc.meterPhoto ?? null,
      local,
      latitude:
        doc.latitude != null && Number.isFinite(Number(doc.latitude))
          ? Number(doc.latitude)
          : null,
      longitude:
        doc.longitude != null && Number.isFinite(Number(doc.longitude))
          ? Number(doc.longitude)
          : null,
      createdAt: doc.createdAt,
      status: asString(raw.status) || 'aprovado',
    };
  }

  private async requireCompanyId(prefeituraId: string): Promise<string> {
    const companyId = await resolverCompanyId(this.prisma, prefeituraId);
    if (!companyId) {
      throw new BadRequestException('Empresa não encontrada.');
    }
    return companyId;
  }
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return '';
}

function parseValorLegado(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v !== 'string') return 0;
  const limpo = v
    .replace(/[^0-9,.-]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const n = Number(limpo);
  return Number.isFinite(n) ? n : 0;
}

function motoristaEhCondutor(
  equipamento: Record<string, unknown>,
  motoristaId: string,
): boolean {
  const lista = Array.isArray(equipamento.condutoresResponsaveis)
    ? equipamento.condutoresResponsaveis
    : [];
  return lista.some((id) => id === motoristaId);
}

function resolvePlateOrChassis(raw: Record<string, unknown>): string {
  const placa = asString(raw.placa);
  if (placa) return placa;
  return asString(raw.chassis);
}

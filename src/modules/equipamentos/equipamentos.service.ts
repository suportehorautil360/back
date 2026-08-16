import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { FirebaseService } from '../../config/firebase.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ehComboioTipo,
  ehCondutorDoEquipamentoRow,
  mapEquipmentToApi,
} from '../../common/prisma/equipment-api.mapper';
import { resolverCompanyId } from '../../common/prisma/company-resolver';
import { randomUUID } from 'node:crypto';
import { CreateEquipamentoDto } from './dto/create-equipamento.dto';
import { UpdateEquipamentoDto } from './dto/update-equipamento.dto';
import { CompleteRevisaoEquipDto } from './dto/complete-revisao-equip.dto';
import {
  ensureTankForComboio,
  tankStatus,
} from '../movimentacoes/shared/tank-saldo.helper';
import {
  deveAplicarMedicaoChecklist,
  resolverLeituraParaUnidade,
  type MedicaoChecklistTexto,
} from './helpers/sync-medicao-from-texto.helper';

/** Equipamento é comboio? (tipo `Comboio`, case-insensitive). */
function ehComboio(tipo: unknown): boolean {
  return typeof tipo === 'string' && tipo.trim().toLowerCase() === 'comboio';
}

function txt(valor: unknown): string {
  return typeof valor === 'string' ? valor : '';
}

function nmr(valor: unknown): number {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

/** Equipamento em que o funcionário é condutor responsável? */
function ehCondutorDoEquipamento(
  e: Record<string, unknown>,
  motoristaId: string,
): boolean {
  const condutores = ehArray(e.condutoresResponsaveis)
    ? e.condutoresResponsaveis
    : [];
  return condutores.some((id) => id === motoristaId);
}

function mapDocEquipamento(doc: {
  id: string;
  data: () => Record<string, unknown>;
}): Record<string, unknown> & { id: string } {
  const raw = doc.data();
  const id = typeof raw.id === 'string' ? raw.id : doc.id;
  return { ...raw, id };
}

/** Type guard que estreita para `unknown[]` (Array.isArray estreita para any[]). */
function ehArray(valor: unknown): valor is unknown[] {
  return Array.isArray(valor);
}

@Injectable()
export class EquipamentosService {
  constructor(
    private firebaseService: FirebaseService,
    private readonly prisma: PrismaService,
  ) {}

  private get collection() {
    return this.firebaseService.getFirestore().collection('equipamentos');
  }

  private get revisoesCollection() {
    return this.firebaseService
      .getFirestore()
      .collection('equipamentos_revisoes');
  }

  /**
   * Localiza o documento pelo campo `id` salvo (docs novos) ou, em fallback,
   * pelo id do próprio documento Firestore (docs legados sem o campo `id`).
   */
  private async findDocByField(id: string) {
    const ref = await this.collection.where('id', '==', id).get();
    if (!ref.empty) return ref.docs[0];

    const byDocId = await this.collection.doc(id).get();
    if (byDocId.exists) return byDocId;

    throw new NotFoundException(
      'Equipamento não encontrado para o ID fornecido.',
    );
  }

  async create(dto: CreateEquipamentoDto) {
    const id = randomUUID();
    try {
      const novo = {
        id,
        ...dto,
        label: dto.descricao,
        status: dto.status ?? 'ativo',
        createdAt: new Date().toISOString(),
      };
      await this.collection.doc().set(novo);
      // Comboio é um equipamento com tanque próprio: garante o doc em `tanks`.
      if (ehComboio(novo.tipo)) {
        await ensureTankForComboio(this.firebaseService.getFirestore(), novo);
      }
      return { data: novo, message: 'Equipamento criado com sucesso!' };
    } catch (error) {
      console.error('Erro ao salvar equipamento:', error);
      throw new InternalServerErrorException(
        'Não foi possível salvar o equipamento no banco de dados.',
      );
    }
  }

  /** Busca um equipamento pelo campo `id` (Postgres → Firestore). */
  async findById(id: string) {
    const prismaRow = await this.prisma.equipment.findFirst({
      where: { OR: [{ id }, { legacyId: id }] },
      include: { company: { select: { legacyId: true } } },
    });
    if (prismaRow) {
      const prefeituraId = prismaRow.company.legacyId ?? prismaRow.companyId;
      return {
        data: mapEquipmentToApi(prismaRow, prefeituraId),
        message: 'Equipamento encontrado.',
      };
    }

    const doc = await this.findDocByField(id);
    return { data: doc.data(), message: 'Equipamento encontrado.' };
  }

  /** Se `id` é UUID válido, devolve; senão devolve UUID nulo (não bate em companyId). */
  private tryUuid(id: string): string {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
      ? id
      : '00000000-0000-0000-0000-000000000000';
  }

  /** Lista os equipamentos da prefeitura. Sem registros => lista vazia (200). */
  async findAllByPrefeitura(prefeituraId: string) {
    try {
      const prismaRows = await this.prisma.equipment.findMany({
        where: {
          OR: [
            { companyId: this.tryUuid(prefeituraId) },
            { company: { legacyId: prefeituraId } },
          ],
        },
        select: {
          id: true,
          legacyId: true,
          descricao: true,
          chassi: true,
          modelo: true,
          linha: true,
          tipo: true,
          placa: true,
          marca: true,
          ano: true,
          obra: true,
          status: true,
          medicaoAtual: true,
          intervaloRevisao: true,
          ultimaRevisao: true,
          unidadeRevisao: true,
        },
        orderBy: { descricao: 'asc' },
      });

      if (prismaRows.length > 0) {
        const data = prismaRows.map((e) => ({
          id: e.legacyId ?? e.id,
          prefeituraId,
          descricao: e.descricao ?? '',
          label: e.descricao ?? '',
          chassis: e.chassi ?? '',
          chassi: e.chassi ?? '',
          modelo: e.modelo ?? '',
          linha: e.linha ?? '',
          tipo: e.tipo ?? '',
          placa: e.placa ?? '',
          marca: e.marca ?? '',
          ano: e.ano ?? '',
          obra: e.obra ?? '',
          status: e.status ?? 'ativo',
          medicaoAtual: e.medicaoAtual ?? 0,
          intervaloRevisao: e.intervaloRevisao ?? 0,
          ultimaRevisao: e.ultimaRevisao ?? 0,
          unidadeRevisao: e.unidadeRevisao ?? 'h',
        }));
        return { data, message: 'Equipamentos buscados com sucesso!' };
      }

      // Fallback Firestore (legado) — empresas ainda não migradas.
      const ref = await this.collection
        .where('prefeituraId', '==', prefeituraId)
        .get();
      const data = ref.docs.map((doc) => {
        const raw = doc.data();
        return { ...raw, id: (raw as { id?: string }).id ?? doc.id };
      });
      return { data, message: 'Equipamentos buscados com sucesso!' };
    } catch (error) {
      console.error('Erro ao buscar equipamentos:', error);
      throw new InternalServerErrorException(
        'Não foi possível buscar os equipamentos no banco de dados.',
      );
    }
  }

  /**
   * Equipamentos da prefeitura em que o funcionário é condutor responsável.
   * Alimenta o seletor de veículo do PWA FleetFuel (motorista).
   */
  async findEquipamentosByMotorista(
    prefeituraId: string,
    motoristaId: string,
  ) {
    try {
      const companyId = await resolverCompanyId(this.prisma, prefeituraId);
      if (companyId) {
        const rows = await this.prisma.equipment.findMany({
          where: { companyId },
          select: {
            id: true,
            legacyId: true,
            descricao: true,
            chassi: true,
            modelo: true,
            linha: true,
            tipo: true,
            placa: true,
            marca: true,
            ano: true,
            obra: true,
            status: true,
            medicaoAtual: true,
            intervaloRevisao: true,
            ultimaRevisao: true,
            unidadeRevisao: true,
            combustivel: true,
            capacidadeTanque: true,
            condutoresIds: true,
          },
        });
        if (rows.length > 0) {
          const equipamentos = rows
            .filter(
              (e) =>
                !ehComboioTipo(e.tipo) &&
                ehCondutorDoEquipamentoRow(e, motoristaId),
            )
            .map((e) => mapEquipmentToApi(e, prefeituraId));

          const data = await Promise.all(
            equipamentos.map(async (e) => {
              const nome =
                txt(e.descricao) || txt(e.modelo) || txt(e.tipo) || 'Equipamento';
              return {
                id: e.id,
                descricao: nome,
                placa: txt(e.placa),
                chassis: txt(e.chassis),
                tipo: txt(e.tipo),
              };
            }),
          );

          return {
            data,
            message: 'Equipamentos do condutor buscados com sucesso!',
          };
        }
      }

      const ref = await this.collection
        .where('prefeituraId', '==', prefeituraId)
        .get();

      const firestore = this.firebaseService.getFirestore();
      const equipamentos = ref.docs
        .map(mapDocEquipamento)
        .filter((e) => ehCondutorDoEquipamento(e, motoristaId));

      const data = await Promise.all(
        equipamentos.map(async (e) => {
          const equipId = e.id;
          const nome =
            txt(e.descricao) || txt(e.modelo) || txt(e.tipo) || 'Equipamento';
          const base = {
            id: equipId,
            descricao: nome,
            placa: txt(e.placa),
            chassis: txt(e.chassis),
            tipo: txt(e.tipo),
          };

          if (!ehComboio(e.tipo)) return base;

          const tankSnap = await firestore
            .collection('tanks')
            .doc(equipId)
            .get();
          const t: Record<string, unknown> = tankSnap.data() ?? {};
          const capacity =
            t.capacity !== undefined
              ? nmr(t.capacity)
              : nmr(e.capacidadeTanque);
          const currentVolume = nmr(t.currentVolume);
          const { percentage, status } = tankStatus(capacity, currentVolume);
          return {
            ...base,
            tank: {
              name: nome,
              fuelType: txt(e.combustivel),
              capacity,
              currentVolume,
              percentage,
              status,
              veiculoModelo: txt(e.modelo) || txt(e.descricao),
              veiculoPlaca: txt(e.placa),
            },
          };
        }),
      );

      return {
        data,
        message: 'Equipamentos do condutor buscados com sucesso!',
      };
    } catch (error) {
      console.error('Erro ao buscar equipamentos do condutor:', error);
      throw new InternalServerErrorException(
        'Não foi possível buscar os equipamentos do condutor.',
      );
    }
  }

  /**
   * Comboios (equipamentos `tipo: Comboio`) da prefeitura em que o funcionário
   * é condutor responsável — com o tanque resolvido. Alimenta o seletor de
   * comboio do PWA do comboista (cada turno escolhe qual comboio opera).
   */
  async findComboiosByMotorista(prefeituraId: string, motoristaId: string) {
    try {
      const companyId = await resolverCompanyId(this.prisma, prefeituraId);
      if (companyId) {
        const rows = await this.prisma.equipment.findMany({
          where: { companyId },
          select: {
            id: true,
            legacyId: true,
            descricao: true,
            chassi: true,
            modelo: true,
            tipo: true,
            placa: true,
            combustivel: true,
            capacidadeTanque: true,
            condutoresIds: true,
          },
        });
        if (rows.length > 0) {
          const firestore = this.firebaseService.getFirestore();
          const comboios = rows.filter(
            (e) =>
              ehComboioTipo(e.tipo) &&
              ehCondutorDoEquipamentoRow(e, motoristaId),
          );

          const data = await Promise.all(
            comboios.map(async (e) => {
              const comboioId = e.legacyId ?? e.id;
              const tankSnap = await firestore
                .collection('tanks')
                .doc(comboioId)
                .get();
              const t: Record<string, unknown> = tankSnap.data() ?? {};
              const capacity =
                t.capacity !== undefined
                  ? nmr(t.capacity)
                  : nmr(e.capacidadeTanque);
              const currentVolume = nmr(t.currentVolume);
              const { percentage, status } = tankStatus(
                capacity,
                currentVolume,
              );
              const nome = txt(e.descricao) || txt(e.modelo) || 'Comboio';
              return {
                id: comboioId,
                descricao: nome,
                placa: txt(e.placa),
                chassis: txt(e.chassi),
                tank: {
                  name: nome,
                  fuelType: txt(e.combustivel),
                  capacity,
                  currentVolume,
                  percentage,
                  status,
                  veiculoModelo: txt(e.modelo) || txt(e.descricao),
                  veiculoPlaca: txt(e.placa),
                },
              };
            }),
          );

          return { data, message: 'Comboios do condutor buscados com sucesso!' };
        }
      }

      const ref = await this.collection
        .where('prefeituraId', '==', prefeituraId)
        .get();

      const firestore = this.firebaseService.getFirestore();
      const comboios = ref.docs
        .map(mapDocEquipamento)
        .filter(
          (e) =>
            txt(e.tipo).toLowerCase() === 'comboio' &&
            ehCondutorDoEquipamento(e, motoristaId),
        );

      const data = await Promise.all(
        comboios.map(async (e) => {
          const comboioId = e.id;
          const tankSnap = await firestore
            .collection('tanks')
            .doc(comboioId)
            .get();
          const t: Record<string, unknown> = tankSnap.data() ?? {};
          const capacity =
            t.capacity !== undefined
              ? nmr(t.capacity)
              : nmr(e.capacidadeTanque);
          const currentVolume = nmr(t.currentVolume);
          const { percentage, status } = tankStatus(capacity, currentVolume);
          const nome = txt(e.descricao) || txt(e.modelo) || 'Comboio';
          return {
            id: comboioId,
            descricao: nome,
            placa: txt(e.placa),
            chassis: txt(e.chassis),
            tank: {
              name: nome,
              fuelType: txt(e.combustivel),
              capacity,
              currentVolume,
              percentage,
              status,
              veiculoModelo: txt(e.modelo) || txt(e.descricao),
              veiculoPlaca: txt(e.placa),
            },
          };
        }),
      );

      return { data, message: 'Comboios do condutor buscados com sucesso!' };
    } catch (error) {
      console.error('Erro ao buscar comboios do condutor:', error);
      throw new InternalServerErrorException(
        'Não foi possível buscar os comboios do condutor.',
      );
    }
  }

  async updateById(id: string, dto: UpdateEquipamentoDto) {
    try {
      const doc = await this.findDocByField(id);
      const atual: Record<string, unknown> = doc.data() ?? {};

      // Só grava os campos informados (evita sobrescrever com undefined).
      const patch: Record<string, unknown> = {
        updatedAt: new Date().toISOString(),
      };
      for (const [key, value] of Object.entries(dto)) {
        if (value !== undefined) patch[key] = value;
      }

      await this.collection.doc(doc.id).update(patch);

      // Mantém o tanque do comboio sincronizado (capacidade/dados do veículo).
      const merged: Record<string, unknown> = {
        ...atual,
        ...patch,
        id: typeof atual.id === 'string' ? atual.id : doc.id,
      };
      if (ehComboio(merged.tipo)) {
        await ensureTankForComboio(this.firebaseService.getFirestore(), merged);
      }
      return { data: {}, message: 'Equipamento atualizado com sucesso!' };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      console.error('Erro ao atualizar equipamento:', error);
      throw new InternalServerErrorException(
        'Não foi possível atualizar o equipamento no banco de dados.',
      );
    }
  }

  /**
   * Atualiza `medicaoAtual` do equipamento quando o checklist informa horímetro
   * ou KM maior que a leitura cadastrada. Falhas são logadas e não propagadas —
   * o checklist já foi salvo.
   */
  async syncMedicaoFromChecklist(
    equipamentoId: string,
    campos: MedicaoChecklistTexto,
  ): Promise<boolean> {
    const id = equipamentoId.trim();
    if (!id) return false;

    const leituraTexto = (campos.hourMeter ?? campos.km ?? '').trim();
    if (!leituraTexto) return false;

    const prismaOk = await this.syncMedicaoPrisma(id, leituraTexto);
    if (prismaOk) return true;

    return this.syncMedicaoFirestore(id, leituraTexto);
  }

  private async syncMedicaoPrisma(
    id: string,
    leituraTexto: string,
  ): Promise<boolean> {
    try {
      const equip = await this.prisma.equipment.findFirst({
        where: { OR: [{ id }, { legacyId: id }] },
        select: { id: true, medicaoAtual: true, unidadeRevisao: true },
      });
      if (!equip) return false;

      const resolvido = resolverLeituraParaUnidade(
        leituraTexto,
        equip.unidadeRevisao,
      );
      if (!resolvido) return false;
      if (
        !deveAplicarMedicaoChecklist(
          {
            unidadeRevisao: equip.unidadeRevisao,
            medicaoAtual: equip.medicaoAtual,
          },
          resolvido.measurementType,
          resolvido.leitura,
        )
      ) {
        return false;
      }

      await this.prisma.equipment.update({
        where: { id: equip.id },
        data: { medicaoAtual: resolvido.leitura },
      });
      return true;
    } catch (error) {
      console.warn(
        'Não foi possível sincronizar medição do equipamento (Postgres):',
        { equipamentoId: id, error },
      );
      return false;
    }
  }

  private async syncMedicaoFirestore(
    id: string,
    leituraTexto: string,
  ): Promise<boolean> {
    try {
      const doc = await this.findDocByField(id);
      const atual = (doc.data() ?? {}) as Record<string, unknown>;
      const resolvido = resolverLeituraParaUnidade(
        leituraTexto,
        atual.unidadeRevisao,
      );
      if (!resolvido) return false;
      if (
        !deveAplicarMedicaoChecklist(
          atual,
          resolvido.measurementType,
          resolvido.leitura,
        )
      ) {
        return false;
      }

      await this.collection.doc(doc.id).update({
        medicaoAtual: resolvido.leitura,
        updatedAt: new Date().toISOString(),
      });
      return true;
    } catch (error) {
      console.warn(
        'Não foi possível sincronizar medição do equipamento após checklist:',
        { equipamentoId: id, error },
      );
      return false;
    }
  }

  async deleteById(id: string) {
    try {
      const doc = await this.findDocByField(id);
      await this.collection.doc(doc.id).delete();
      return { data: {}, message: 'Equipamento removido com sucesso!' };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      console.error('Erro ao remover equipamento:', error);
      throw new InternalServerErrorException(
        'Não foi possível remover o equipamento no banco de dados.',
      );
    }
  }

  /**
   * Registra uma revisão concluída e libera o equipamento: grava a revisão no
   * histórico, adota a leitura informada como leitura atual e base da próxima
   * revisão, e devolve o equipamento para o status "ativo".
   */
  async completeRevision(dto: CompleteRevisaoEquipDto) {
    const revisionId = randomUUID();
    try {
      const doc = await this.findDocByField(dto.equipamentoId);
      const data = doc.data() as { medicaoAtual?: number };

      if (dto.odometerReading < (data.medicaoAtual ?? 0)) {
        throw new BadRequestException(
          'A leitura não pode ser menor que a medição atual do equipamento.',
        );
      }

      const novaRevisao = {
        id: revisionId,
        ...dto,
        status: 'Concluída',
        createdAt: new Date().toISOString(),
      };
      await this.revisoesCollection.doc().set(novaRevisao);

      await this.collection.doc(doc.id).update({
        medicaoAtual: dto.odometerReading,
        ultimaRevisao: dto.odometerReading,
        status: 'ativo',
        updatedAt: new Date().toISOString(),
      });

      return {
        data: novaRevisao,
        message: 'Revisão concluída e equipamento liberado com sucesso!',
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      console.error('Erro ao concluir revisão do equipamento:', error);
      throw new InternalServerErrorException(
        'Não foi possível concluir a revisão. Tente novamente mais tarde.',
      );
    }
  }
}

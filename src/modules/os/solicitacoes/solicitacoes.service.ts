import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { FieldValue } from 'firebase-admin/firestore';
import { FirebaseService } from '../../../config/firebase.service';
import {
  parseDateEnd,
  parseDateStart,
} from '../../movimentacoes/shared/date.helper';
import { nextProtocoloOs } from '../helpers/gerar-protocolo.helper';
import {
  normalizeOsServiceType,
  osServiceTypeFromFirestore,
  osServiceTypeLabel,
  tipoOsLegacyCode,
} from '../helpers/os-service-type.helper';
import { mapOficinaCredenciadaDoc } from '../helpers/oficinas-credenciadas.helper';
import { selecionarOficinas } from '../helpers/selecionar-oficinas.helper';
import { solicitacaoStatusLabel } from '../helpers/status-label.helper';
import {
  formatDateBrFromIso,
  timestampToIso,
  timestampToSeconds,
} from '../helpers/timestamp.helper';
import type {
  CreateSolicitacaoResult,
  OficinaAtiva,
  SolicitacaoOsFirestore,
  SolicitacaoOsListItem,
} from '../os.types';
import { CreateSolicitacaoDto } from './dto/create-solicitacao.dto';
import { ListSolicitacoesQueryDto } from './dto/list-solicitacoes-query.dto';

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function numero(valor: unknown): number {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
  if (typeof valor === 'string') {
    const n = Number(valor.replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function formatHorimetro(raw: Record<string, unknown>): string {
  const medicao = numero(raw.medicaoAtual);
  const unidade = texto(raw.unidadeRevisao) === 'h' ? 'h' : 'km';
  if (medicao <= 0) return '';
  return `${medicao.toLocaleString('pt-BR')} ${unidade}`;
}

function resolveLinhaEquipamento(raw: Record<string, unknown>): string {
  return texto(raw.linha) || texto(raw.tipo);
}

function resolveNomeEquipamento(raw: Record<string, unknown>): string {
  return (
    texto(raw.descricao) ||
    texto(raw.label) ||
    `${texto(raw.marca)} ${texto(raw.modelo)}`.trim() ||
    '—'
  );
}

@Injectable()
export class SolicitacoesService {
  constructor(private readonly firebaseService: FirebaseService) {}

  private get solicitacoesCollection() {
    return this.firebaseService.getFirestore().collection('solicitacoesOS');
  }

  private get equipamentosCollection() {
    return this.firebaseService.getFirestore().collection('equipamentos');
  }

  private get oficinasCollection() {
    return this.firebaseService.getFirestore().collection('oficinas');
  }

  async create(dto: CreateSolicitacaoDto): Promise<CreateSolicitacaoResult> {
    const prefeituraId = dto.prefeituraId.trim();
    const equipmentId = dto.equipmentId.trim();
    const operator = dto.operator.trim();
    const report = dto.report.trim();

    const equipamento = await this.findEquipamento(prefeituraId, equipmentId);
    const linha = resolveLinhaEquipamento(equipamento);
    if (!linha) {
      throw new BadRequestException(
        'Equipment has no line/type configured for workshop routing.',
      );
    }

    const oficinas = await this.listarOficinasAtivas(prefeituraId);
    const convidadas = selecionarOficinas(oficinas, linha, 3);
    if (convidadas.length === 0) {
      throw new UnprocessableEntityException(
        'No credentialed active workshops found for this municipality. ' +
          'Credential a workshop via POST /clientes/:prefeituraId/parceiros/:parceiroId/credenciar',
      );
    }

    const serviceType = normalizeOsServiceType(
      dto.serviceType ?? dto.type,
    );

    try {
      const protocolo = await nextProtocoloOs(
        this.solicitacoesCollection,
        prefeituraId,
      );

      const payload = {
        protocolo,
        prefeituraId,
        equipamentoId: texto(equipamento.id) || equipmentId,
        equipamento: resolveNomeEquipamento(equipamento),
        linha,
        operador: operator,
        horimetro: formatHorimetro(equipamento) || undefined,
        relato: report,
        oficinas: convidadas.map((o) => o.nome),
        oficinasIds: convidadas.map((o) => o.id),
        oficinasResponderam: [] as string[],
        status: 'aguardando_orcamento',
        serviceType,
        tipoOs: tipoOsLegacyCode(serviceType),
        ...(dto.scheduledDate?.trim()
          ? { dataAgendamento: dto.scheduledDate.trim() }
          : {}),
        criadoEm: FieldValue.serverTimestamp(),
      };

      const ref = await this.solicitacoesCollection.add(payload);

      return {
        id: ref.id,
        protocol: protocolo,
        serviceType,
        serviceTypeLabel: osServiceTypeLabel(serviceType),
        invitedWorkshops: convidadas.map((o) => ({ id: o.id, name: o.nome })),
        status: 'aguardando_orcamento',
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof UnprocessableEntityException
      ) {
        throw error;
      }
      console.error('Erro ao criar solicitacao OS:', error);
      throw new InternalServerErrorException(
        'Could not create service order request.',
      );
    }
  }

  async listByPrefeitura(
    prefeituraId: string,
    query: ListSolicitacoesQueryDto,
  ): Promise<{ data: SolicitacaoOsListItem[]; message: string }> {
    try {
      const snap = await this.solicitacoesCollection
        .where('prefeituraId', '==', prefeituraId)
        .get();

      let items = snap.docs.map((doc) =>
        this.mapToListItem(doc.id, doc.data() as SolicitacaoOsFirestore),
      );

      if (query.status && query.status !== 'todos') {
        items = items.filter((item) => item.status === query.status);
      }

      if (query.startDate) {
        const startMs = parseDateStart(
          query.startDate,
          'startDate',
        ).getTime();
        items = items.filter((item) => {
          const ms = new Date(item.createdAt).getTime();
          return !Number.isNaN(ms) && ms >= startMs;
        });
      }

      if (query.endDate) {
        const endMs = parseDateEnd(query.endDate, 'endDate').getTime();
        items = items.filter((item) => {
          const ms = new Date(item.createdAt).getTime();
          return !Number.isNaN(ms) && ms <= endMs;
        });
      }

      items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

      return {
        data: items,
        message: 'Service order requests loaded successfully.',
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Erro ao listar solicitacoes OS:', error);
      throw new InternalServerErrorException(
        'Could not load service order requests.',
      );
    }
  }

  private mapToListItem(
    id: string,
    raw: SolicitacaoOsFirestore,
  ): SolicitacaoOsListItem {
    const createdAt = timestampToIso(raw.criadoEm);
    const status = texto(raw.status) || 'aguardando_orcamento';
    const protocolo = texto(raw.protocolo);
    const serviceType = osServiceTypeFromFirestore(raw);

    return {
      id,
      protocol: protocolo,
      equipment: texto(raw.equipamento),
      line: texto(raw.linha),
      operator: texto(raw.operador),
      report: texto(raw.relato),
      workshops: Array.isArray(raw.oficinas) ? raw.oficinas : [],
      workshopIds: Array.isArray(raw.oficinasIds) ? raw.oficinasIds : [],
      status,
      statusLabel: solicitacaoStatusLabel(status),
      serviceType,
      serviceTypeLabel: osServiceTypeLabel(serviceType),
      dateLabel: formatDateBrFromIso(createdAt),
      createdAt,
      protocolo,
      equipamento: texto(raw.equipamento),
      linha: texto(raw.linha),
      operador: texto(raw.operador),
      relato: texto(raw.relato),
      oficinas: Array.isArray(raw.oficinas) ? raw.oficinas : [],
      oficinasIds: Array.isArray(raw.oficinasIds) ? raw.oficinasIds : [],
      criadoEm: timestampToSeconds(raw.criadoEm),
    };
  }

  private async findEquipamento(
    prefeituraId: string,
    equipmentId: string,
  ): Promise<Record<string, unknown>> {
    const byField = await this.equipamentosCollection
      .where('id', '==', equipmentId)
      .get();

    if (!byField.empty) {
      const doc = byField.docs[0];
      return this.assertEquipamentoPrefeitura(
        prefeituraId,
        doc.data() as Record<string, unknown>,
        doc.id,
      );
    }

    const byDocId = await this.equipamentosCollection.doc(equipmentId).get();
    if (byDocId.exists) {
      return this.assertEquipamentoPrefeitura(
        prefeituraId,
        byDocId.data() as Record<string, unknown>,
        byDocId.id,
      );
    }

    throw new NotFoundException('Equipment not found for the given id.');
  }

  private assertEquipamentoPrefeitura(
    prefeituraId: string,
    data: Record<string, unknown>,
    docId: string,
  ): Record<string, unknown> {
    const equipPrefeitura = texto(data.prefeituraId);
    if (equipPrefeitura && equipPrefeitura !== prefeituraId) {
      throw new BadRequestException(
        'Equipment does not belong to the given prefeituraId.',
      );
    }

    return { ...data, id: texto(data.id) || docId };
  }

  private async listarOficinasAtivas(
    prefeituraId: string,
  ): Promise<OficinaAtiva[]> {
    const snap = await this.oficinasCollection
      .where('prefeituraId', '==', prefeituraId)
      .get();

    return snap.docs
      .map((doc) =>
        mapOficinaCredenciadaDoc(doc.id, doc.data() as Record<string, unknown>),
      )
      .filter((o): o is OficinaAtiva => o !== null);
  }
}

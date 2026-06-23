import {
  BadRequestException,
  ConflictException,
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
import { mapOrdemServicoListItem } from '../helpers/ordem-servico-list.helper';
import {
  ordemElegivelParaAprovacao,
  ordemElegivelParaRecusa,
  solicitacaoPermiteAprovacao,
} from '../helpers/aprovar-orcamento.helper';
import {
  parseLances,
  parseOficinasResponderam,
  valorOrcadoForOficina,
} from '../helpers/lances-os.helper';
import type {
  AprovarSolicitacaoResult,
  CreateSolicitacaoResult,
  OficinaAtiva,
  OrdemOrcamentoListItem,
  SolicitacaoComOrcamentosListItem,
  SolicitacaoOsFirestore,
  SolicitacaoOsListItem,
} from '../os.types';
import { shouldIncludeSolicitacaoForOficina } from '../helpers/solicitacoes-oficina.helper';
import { CreateSolicitacaoDto } from './dto/create-solicitacao.dto';
import { ListSolicitacoesOficinaQueryDto } from './dto/list-solicitacoes-oficina-query.dto';
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

  private get ordensCollection() {
    return this.firebaseService.getFirestore().collection('ordensServico');
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

  async listByOficina(
    oficinaId: string,
    query: ListSolicitacoesOficinaQueryDto,
  ): Promise<{ data: SolicitacaoOsListItem[]; message: string }> {
    const id = oficinaId.trim();
    if (!id) {
      throw new BadRequestException('oficinaId inválido.');
    }

    const statusFiltro = query.status?.trim();

    try {
      let firestoreQuery = this.solicitacoesCollection.where(
        'oficinasIds',
        'array-contains',
        id,
      );

      if (statusFiltro && statusFiltro !== 'todos') {
        firestoreQuery = firestoreQuery.where('status', '==', statusFiltro);
      }

      const snap = await firestoreQuery.get();

      let items = snap.docs
        .filter((doc) => {
          const data = doc.data() as Record<string, unknown>;
          const pref = texto(query.prefeituraId);
          if (pref && texto(data.prefeituraId) !== pref) return false;

          if (
            statusFiltro &&
            ['aguardando_orcamento', 'recebida', 'nova'].includes(
              statusFiltro.toLowerCase(),
            )
          ) {
            return shouldIncludeSolicitacaoForOficina(
              data,
              id,
              query.prefeituraId,
              statusFiltro,
            );
          }

          return true;
        })
        .map((doc) =>
          this.mapToListItem(
            doc.id,
            doc.data() as SolicitacaoOsFirestore,
            id,
          ),
        );

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
        message: 'Service order requests for workshop loaded successfully.',
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Erro ao listar solicitacoes OS da oficina:', error);
      throw new InternalServerErrorException(
        'Could not load service order requests for the workshop.',
      );
    }
  }

  async aprovar(
    solicitacaoId: string,
    ordemServicoId: string,
  ): Promise<AprovarSolicitacaoResult> {
    const solId = solicitacaoId.trim();
    const ordemId = ordemServicoId.trim();
    if (!solId || !ordemId) {
      throw new BadRequestException('solicitacaoId e ordemServicoId são obrigatórios.');
    }

    const solRef = this.solicitacoesCollection.doc(solId);
    const ordemRef = this.ordensCollection.doc(ordemId);

    try {
      return await this.firebaseService.getFirestore().runTransaction(
        async (tx) => {
          const [solSnap, ordemSnap, outrasSnap] = await Promise.all([
            tx.get(solRef),
            tx.get(ordemRef),
            tx.get(
              this.ordensCollection
                .where('solicitacaoOsId', '==', solId),
            ),
          ]);

          if (!solSnap.exists) {
            throw new NotFoundException('Solicitação de OS não encontrada.');
          }
          if (!ordemSnap.exists) {
            throw new NotFoundException('Orçamento não encontrado.');
          }

          const sol = solSnap.data() as Record<string, unknown>;
          const ordem = ordemSnap.data() as Record<string, unknown>;

          if (!solicitacaoPermiteAprovacao(sol.status)) {
            throw new ConflictException(
              'Esta O.S. já foi finalizada e não pode ser aprovada novamente.',
            );
          }

          if (texto(ordem.solicitacaoOsId) !== solId) {
            throw new BadRequestException(
              'O orçamento não pertence a esta solicitação.',
            );
          }

          if (!ordemElegivelParaAprovacao(ordem.status)) {
            throw new UnprocessableEntityException(
              'Este orçamento não está elegível para aprovação.',
            );
          }

          const agora = new Date().toISOString();

          tx.update(ordemRef, {
            status: 'aprovado',
            aprovadoEm: agora,
          });

          for (const doc of outrasSnap.docs) {
            if (doc.id === ordemId) continue;
            const data = doc.data() as Record<string, unknown>;
            if (ordemElegivelParaRecusa(data.status)) {
              tx.update(doc.ref, {
                status: 'recusado',
                recusadoEm: agora,
              });
            }
          }

          tx.update(solRef, {
            status: 'aprovado',
            aprovadoEm: agora,
            ordemServicoAprovadaId: ordemId,
          });

          return {
            solicitacaoId: solId,
            approvedOrdemId: ordemId,
            status: 'aprovado',
          };
        },
      );
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof ConflictException ||
        error instanceof UnprocessableEntityException
      ) {
        throw error;
      }
      console.error('Erro ao aprovar orçamento:', error);
      throw new InternalServerErrorException(
        'Não foi possível aprovar o orçamento.',
      );
    }
  }

  async listComOrcamentosByPrefeitura(
    prefeituraId: string,
    query: ListSolicitacoesQueryDto,
  ): Promise<{ data: SolicitacaoComOrcamentosListItem[]; message: string }> {
    try {
      const { data: solicitacoes } = await this.listByPrefeitura(
        prefeituraId,
        query,
      );

      const ordensSnap = await this.ordensCollection
        .where('prefeituraId', '==', prefeituraId)
        .get();

      const ordensPorSolicitacao = new Map<string, OrdemOrcamentoListItem[]>();

      for (const doc of ordensSnap.docs) {
        const ordem = mapOrdemServicoListItem(
          doc.id,
          doc.data() as Record<string, unknown>,
        );
        if (!ordem.solicitacaoOsId) continue;

        const lista = ordensPorSolicitacao.get(ordem.solicitacaoOsId) ?? [];
        lista.push(ordem);
        ordensPorSolicitacao.set(ordem.solicitacaoOsId, lista);
      }

      for (const [solId, ordens] of ordensPorSolicitacao) {
        ordens.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        ordensPorSolicitacao.set(solId, ordens);
      }

      const data = solicitacoes.map((sol) => {
        const quotes = ordensPorSolicitacao.get(sol.id) ?? [];
        return {
          ...sol,
          quotes,
          orcamentos: quotes,
          quotesReceived: quotes.length,
          invitedCount: sol.oficinasIds.length,
        };
      });

      return {
        data,
        message: 'Service order requests with quotes loaded successfully.',
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Erro ao listar solicitacoes com orcamentos:', error);
      throw new InternalServerErrorException(
        'Could not load service order requests with quotes.',
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
    oficinaIdContext?: string,
  ): SolicitacaoOsListItem {
    const createdAt = timestampToIso(raw.criadoEm);
    const status = texto(raw.status) || 'aguardando_orcamento';
    const protocolo = texto(raw.protocolo);
    const serviceType = osServiceTypeFromFirestore(raw);
    const lances = parseLances(raw.lances);
    const oficinasResponderam = parseOficinasResponderam(raw.oficinasResponderam);
    const valorOrcado = oficinaIdContext
      ? valorOrcadoForOficina(lances, oficinaIdContext)
      : null;

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
      oficinasResponderam,
      lances,
      valorOrcado,
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

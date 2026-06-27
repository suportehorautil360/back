import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { FirebaseService } from '../../config/firebase.service';
import {
  buscarChdsPorEquipamento,
  buscarChdsPorSolicitacao,
} from '../checklist-devolucao/helpers/chd-por-solicitacao.helper';
import type { ChecklistDevolucaoDoc } from '../checklist-devolucao/checklist-devolucao.types';
import { nomeFromOficinaDoc } from '../os/helpers/especialidade-oficina.helper';
import type { GarantiaDoc, GarantiaListItem } from './garantias.types';
import { gerarGarantiasDeChecklistDevolucao } from './helpers/gerar-garantias-de-chd.helper';
import {
  aplicarFiltrosGarantia,
  mesclarLinhasGarantia,
  montarResumoGarantia,
  parseHorimetroQuery,
  type FiltrosGarantiaQuery,
} from './helpers/garantias-query.helper';
import {
  mapGarantiaFromFirestore,
  mapGarantiaParaLista,
} from './helpers/garantias.mapper';

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

@Injectable()
export class GarantiasService {
  constructor(private readonly firebaseService: FirebaseService) {}

  private get collection() {
    return this.firebaseService.getFirestore().collection('garantias');
  }

  private get chdCollection() {
    return this.firebaseService.getFirestore().collection('checklistsDevolucao');
  }

  private get solicitacoesCollection() {
    return this.firebaseService.getFirestore().collection('solicitacoesOS');
  }

  private get oficinasCollection() {
    return this.firebaseService.getFirestore().collection('oficinas');
  }

  async gerarDeChecklistDevolucao(
    chd: ChecklistDevolucaoDoc,
    ctx: {
      prefeituraId: string;
      equipamentoId: string;
      equipamento: string;
      fornecedor: string;
      horimetroAtual?: number | null;
    },
  ): Promise<GarantiaDoc[]> {
    const registros = gerarGarantiasDeChecklistDevolucao(chd, ctx);
    if (!registros.length) return [];

    const batch = this.firebaseService.getFirestore().batch();
    for (const registro of registros) {
      batch.set(this.collection.doc(registro.id), registro);
    }
    await batch.commit();
    return registros;
  }

  async listarPorSolicitacao(
    solicitacaoOsId: string,
    query: FiltrosGarantiaQuery,
  ) {
    const solId = solicitacaoOsId.trim();
    if (!solId) throw new BadRequestException('solicitacaoOsId inválido.');

    const horimetroAtual = parseHorimetroQuery(query.horimetroAtual);

    try {
      const solSnap = await this.solicitacoesCollection.doc(solId).get();
      if (!solSnap.exists) {
        throw new NotFoundException('Solicitação de O.S. não encontrada.');
      }

      const sol = solSnap.data() as Record<string, unknown>;
      const equipamentoId = texto(sol.equipamentoId);
      const equipamento = texto(sol.equipamento);
      const prefeituraId = texto(sol.prefeituraId);
      const protocolo = texto(sol.protocolo);

      const chds = await this.buscarChdsPorSolicitacao(solId, protocolo);
      const linhasChd = await this.derivarLinhasDeChds(chds, {
        prefeituraId,
        equipamentoId,
        equipamento,
        horimetroAtual,
      });

      const persistidas = equipamentoId
        ? await this.carregarPersistidasPorEquipamento(equipamentoId)
        : [];
      const persistidasOs = persistidas
        .filter((doc) => doc.solicitacaoOsId === solId)
        .map((doc) => mapGarantiaParaLista(doc, horimetroAtual));

      const todas = mesclarLinhasGarantia(persistidasOs, linhasChd);
      const linhas = aplicarFiltrosGarantia(todas, query);

      return {
        resumo: montarResumoGarantia({
          equipamentoId: equipamentoId || solId,
          equipamento: equipamento || '—',
          horimetroAtual,
          linhas: todas,
        }),
        data: linhas,
        chdsEncontrados: chds.length,
        message:
          chds.length > 0
            ? 'Garantias derivadas do checklist de devolução (CHD) desta O.S.'
            : 'Nenhum CHD encontrado para esta O.S. — aguardando devolução da oficina.',
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      console.error('Erro ao listar garantias por solicitação:', error);
      throw new InternalServerErrorException(
        'Não foi possível carregar as garantias desta O.S.',
      );
    }
  }

  async listarPorEquipamento(
    equipamentoId: string,
    query: FiltrosGarantiaQuery,
  ) {
    const id = equipamentoId.trim();
    if (!id) throw new BadRequestException('equipamentoId inválido.');

    const horimetroAtual = parseHorimetroQuery(query.horimetroAtual);

    try {
      const persistidas = await this.carregarPersistidasPorEquipamento(id);
      const linhasPersistidas = persistidas.map((doc) =>
        mapGarantiaParaLista(doc, horimetroAtual),
      );

      const chds = await this.buscarChdsPorEquipamento(id);
      const linhasChd = await this.derivarLinhasDeChds(chds, {
        prefeituraId: persistidas[0]?.prefeituraId ?? chds[0]?.prefeituraId ?? '',
        equipamentoId: id,
        equipamento:
          persistidas[0]?.equipamento ??
          chds[0]?.identification.brandModel ??
          '—',
        horimetroAtual,
      });

      const todas = mesclarLinhasGarantia(linhasPersistidas, linhasChd);
      const linhas = aplicarFiltrosGarantia(todas, query);
      const equipamentoNome =
        persistidas[0]?.equipamento ??
        chds[0]?.identification.brandModel ??
        '—';

      return {
        resumo: montarResumoGarantia({
          equipamentoId: id,
          equipamento: equipamentoNome,
          horimetroAtual,
          linhas: todas,
        }),
        data: linhas,
        message: 'Histórico de garantia carregado com sucesso.',
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Erro ao listar garantias:', error);
      throw new InternalServerErrorException(
        'Não foi possível carregar o histórico de garantia.',
      );
    }
  }

  private async carregarPersistidasPorEquipamento(
    equipamentoId: string,
  ): Promise<GarantiaDoc[]> {
    const snap = await this.collection
      .where('equipamentoId', '==', equipamentoId)
      .get();

    return snap.docs
      .map((doc) =>
        mapGarantiaFromFirestore(doc.id, doc.data() as Record<string, unknown>),
      )
      .sort((a, b) => b.dataExecucao.localeCompare(a.dataExecucao));
  }

  private async buscarChdsPorSolicitacao(
    solicitacaoOsId: string,
    protocolo?: string,
  ): Promise<ChecklistDevolucaoDoc[]> {
    return buscarChdsPorSolicitacao(
      this.chdCollection,
      solicitacaoOsId,
      protocolo,
    );
  }

  private async buscarChdsPorEquipamento(
    equipamentoId: string,
  ): Promise<ChecklistDevolucaoDoc[]> {
    return buscarChdsPorEquipamento(
      this.chdCollection,
      this.solicitacoesCollection,
      equipamentoId,
    );
  }

  private async derivarLinhasDeChds(
    chds: ChecklistDevolucaoDoc[],
    ctx: {
      prefeituraId: string;
      equipamentoId: string;
      equipamento: string;
      horimetroAtual: number | null;
    },
  ): Promise<GarantiaListItem[]> {
    const linhas: GarantiaListItem[] = [];

    for (const chd of chds) {
      const fornecedor = await this.resolveFornecedor(chd.oficinaId);
      const docs = gerarGarantiasDeChecklistDevolucao(chd, {
        prefeituraId: ctx.prefeituraId || texto(chd.prefeituraId),
        equipamentoId: ctx.equipamentoId,
        equipamento: ctx.equipamento || chd.identification.brandModel,
        fornecedor,
        horimetroAtual: ctx.horimetroAtual,
      });

      docs.forEach((doc, index) => {
        const comId = {
          ...doc,
          id: `${chd.id}-${doc.tipo}-${index}`,
        };
        linhas.push(mapGarantiaParaLista(comId, ctx.horimetroAtual));
      });
    }

    return linhas;
  }

  private async resolveFornecedor(oficinaId: string): Promise<string> {
    const id = texto(oficinaId);
    if (!id) return '—';

    const snap = await this.oficinasCollection.doc(id).get();
    if (!snap.exists) return id;
    return nomeFromOficinaDoc(snap.data() as Record<string, unknown>, id);
  }
}

import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { FirebaseService } from '../../config/firebase.service';
import type { ChecklistDevolucaoDoc } from '../checklist-devolucao/checklist-devolucao.types';
import type { GarantiaDoc, GarantiaListItem, GarantiaResumoEquipamento } from './garantias.types';
import { gerarGarantiasDeChecklistDevolucao } from './helpers/gerar-garantias-de-chd.helper';
import {
  mapGarantiaFromFirestore,
  mapGarantiaParaLista,
} from './helpers/garantias.mapper';
import { parseHorimetro } from './helpers/parse-horimetro.helper';

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

@Injectable()
export class GarantiasService {
  constructor(private readonly firebaseService: FirebaseService) {}

  private get collection() {
    return this.firebaseService.getFirestore().collection('garantias');
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

  async listarPorEquipamento(
    equipamentoId: string,
    query: {
      horimetroAtual?: string;
      status?: string;
      tipo?: string;
      busca?: string;
    },
  ): Promise<{
    resumo: GarantiaResumoEquipamento;
    data: GarantiaListItem[];
    message: string;
  }> {
    const id = equipamentoId.trim();
    if (!id) throw new BadRequestException('equipamentoId inválido.');

    const horimetroAtual = query.horimetroAtual
      ? parseHorimetro(query.horimetroAtual)
      : null;

    try {
      const snap = await this.collection
        .where('equipamentoId', '==', id)
        .get();

      let docs = snap.docs.map((doc) =>
        mapGarantiaFromFirestore(doc.id, doc.data() as Record<string, unknown>),
      );

      docs.sort((a, b) => b.dataExecucao.localeCompare(a.dataExecucao));

      let linhas = docs.map((doc) =>
        mapGarantiaParaLista(doc, horimetroAtual),
      );

      const statusFiltro = texto(query.status).toLowerCase();
      if (statusFiltro && statusFiltro !== 'todos') {
        linhas = linhas.filter((l) => l.status === statusFiltro);
      }

      const tipoFiltro = texto(query.tipo).toLowerCase();
      if (tipoFiltro && tipoFiltro !== 'todos') {
        linhas = linhas.filter((l) => l.tipo === tipoFiltro);
      }

      const busca = texto(query.busca).toLowerCase();
      if (busca) {
        linhas = linhas.filter(
          (l) =>
            l.osOrigem.toLowerCase().includes(busca) ||
            l.item.toLowerCase().includes(busca) ||
            l.fornecedor.toLowerCase().includes(busca),
        );
      }

      const todasLinhas = docs.map((doc) =>
        mapGarantiaParaLista(doc, horimetroAtual),
      );

      const equipamentoNome = docs[0]?.equipamento ?? '—';

      return {
        resumo: {
          equipamentoId: id,
          equipamento: equipamentoNome,
          horimetroAtual,
          itensEmGarantia: todasLinhas.filter((l) => l.status === 'vigente')
            .length,
          prestesAVencer: todasLinhas.filter((l) => l.status === 'vencendo')
            .length,
        },
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
}

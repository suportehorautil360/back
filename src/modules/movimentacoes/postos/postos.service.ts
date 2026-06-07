import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FirebaseService } from '../../../config/firebase.service';
import { parseDateEnd, parseDateStart } from '../shared/date.helper';
import { CreatePostoDto } from './dto/create-posto.dto';
import {
  AbastecimentoPostoStats,
  extractAbastecimentoValues,
  formatBRL,
  formatLitros,
  formatPrecoPorLitro,
  isWithinPeriod,
} from './helpers/postos-list.helper';
import { PostoDoc, PostoListItem, TIPO_PARCEIRO_OPTIONS } from './postos.types';

@Injectable()
export class PostosService {
  constructor(private firebaseService: FirebaseService) {}

  private get collection() {
    return this.firebaseService.getFirestore().collection('postos');
  }

  private get abastecimentosCollection() {
    return this.firebaseService.getFirestore().collection('abastecimentos');
  }

  async create(input: CreatePostoDto): Promise<PostoDoc> {
    if (!TIPO_PARCEIRO_OPTIONS.includes(input.tipoParceiro)) {
      throw new BadRequestException(
        'O campo tipoParceiro deve ser posto ou oficina.',
      );
    }

    const id = randomUUID();
    const doc: PostoDoc = {
      id,
      prefeituraId: input.prefeituraId.trim(),
      tipoParceiro: input.tipoParceiro,
      cnpj: input.cnpj.trim(),
      telefonePrincipal: input.telefonePrincipal.trim(),
      razaoSocial: input.razaoSocial.trim(),
      nomeFantasia: input.nomeFantasia.trim(),
      emailComercial: input.emailComercial.trim(),
      cidadeUf: input.cidadeUf.trim(),
      endereco: input.endereco.trim(),
      createdAt: new Date().toISOString(),
    };

    try {
      await this.collection.doc(id).set(doc);
      return doc;
    } catch (error) {
      console.error('Erro ao criar posto:', error);
      throw new InternalServerErrorException(
        'Não foi possível registrar o posto.',
      );
    }
  }

  async listarPorPrefeitura(
    prefeituraId: string,
    startDate?: string,
    endDate?: string,
  ): Promise<{ data: PostoListItem[]; message: string }> {
    try {
      const startIso = startDate
        ? parseDateStart(startDate, 'startDate').toISOString()
        : undefined;
      const endIso = endDate
        ? parseDateEnd(endDate, 'endDate').toISOString()
        : undefined;

      const snap = await this.collection
        .where('prefeituraId', '==', prefeituraId)
        .orderBy('createdAt', 'asc')
        .get();

      const docs = snap.docs
        .map((doc) => doc.data() as PostoDoc)
        .filter((doc) => doc.tipoParceiro === 'posto');

      if (docs.length === 0) {
        return { data: [], message: 'Postos buscados com sucesso!' };
      }
      const codeMap = new Map(
        docs.map((doc, index) => [doc.id, `P${index + 1}`]),
      );
      const statsMap = await this.fetchAbastecimentoStats(
        prefeituraId,
        docs.map((doc) => doc.id),
        startIso,
        endIso,
      );

      const data = [...docs]
        .sort((a, b) => a.nomeFantasia.localeCompare(b.nomeFantasia, 'pt-BR'))
        .map((doc) => this.mapToListItem(doc, codeMap, statsMap));

      return { data, message: 'Postos buscados com sucesso!' };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      console.error('Erro ao buscar postos:', error);
      throw new InternalServerErrorException(
        'Não foi possível buscar os postos.',
      );
    }
  }

  private async fetchAbastecimentoStats(
    prefeituraId: string,
    postoIds: string[],
    startIso?: string,
    endIso?: string,
  ): Promise<Map<string, AbastecimentoPostoStats>> {
    const stats = new Map<string, AbastecimentoPostoStats>();
    for (const postoId of postoIds) {
      stats.set(postoId, {
        abastecimentos: 0,
        totalLitros: 0,
        totalGasto: 0,
        precoMedioPorLitro: null,
      });
    }

    if (postoIds.length === 0) {
      return stats;
    }

    const snap = await this.abastecimentosCollection
      .where('prefeituraId', '==', prefeituraId)
      .get();

    for (const docSnap of snap.docs) {
      const data = docSnap.data() as Record<string, unknown>;
      const postoId = asString(data.postoId);
      if (!postoId || !stats.has(postoId)) continue;
      if (!isWithinPeriod(data.createdAt, startIso, endIso)) continue;

      const { liters, gasto } = extractAbastecimentoValues(data);
      const current = stats.get(postoId)!;
      stats.set(postoId, {
        abastecimentos: current.abastecimentos + 1,
        totalLitros: current.totalLitros + liters,
        totalGasto: current.totalGasto + gasto,
        precoMedioPorLitro: null,
      });
    }

    for (const [postoId, current] of stats.entries()) {
      stats.set(postoId, {
        ...current,
        precoMedioPorLitro:
          current.totalLitros > 0
            ? current.totalGasto / current.totalLitros
            : null,
      });
    }

    return stats;
  }

  private mapToListItem(
    doc: PostoDoc,
    codeMap: Map<string, string>,
    statsMap: Map<string, AbastecimentoPostoStats>,
  ): PostoListItem {
    const stats = statsMap.get(doc.id) ?? {
      abastecimentos: 0,
      totalLitros: 0,
      totalGasto: 0,
      precoMedioPorLitro: null,
    };

    const precoPorLitro = doc.precoPorLitro ?? stats.precoMedioPorLitro ?? null;

    return {
      id: doc.id,
      code: codeMap.get(doc.id) ?? 'P?',
      name: doc.nomeFantasia,
      endereco: doc.endereco,
      precoPorLitro,
      precoPorLitroLabel: formatPrecoPorLitro(precoPorLitro),
      abastecimentos: stats.abastecimentos,
      totalLitros: stats.totalLitros,
      totalLitrosLabel: formatLitros(stats.totalLitros),
      totalGasto: stats.totalGasto,
      totalGastoLabel: formatBRL(stats.totalGasto),
      razaoSocial: doc.razaoSocial,
      cnpj: doc.cnpj,
      telefonePrincipal: doc.telefonePrincipal,
      emailComercial: doc.emailComercial,
      cidadeUf: doc.cidadeUf,
      tipoParceiro: doc.tipoParceiro,
      createdAt: doc.createdAt,
    };
  }
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

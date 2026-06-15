import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FirebaseService } from '../../../config/firebase.service';
import { formatDateTime } from '../shared/date.helper';
import { fetchPrefeituraDocs } from '../shared/prefeitura-query.helper';
import { creditarTanque } from '../shared/tank-saldo.helper';
import {
  CreateReabastecimentoDto,
  ReabastecimentoSourceType,
} from './dto/create-reabastecimento.dto';
import {
  isSupportedSourceType,
  parseReceivedLiters,
} from './helpers/reabastecimento-create.helper';

export interface ReabastecimentoDoc {
  id: string;
  prefeituraId: string;
  comboioId: string;
  sourceType: ReabastecimentoSourceType;
  receivedLiters: number;
  invoiceNumber?: string;
  funcionarioId?: string;
  clientRequestId?: string;
  createdAt: string;
}

export interface ReabastecimentoListItem {
  id: string;
  dateTime: string;
  comboioId: string | null;
  sourceType: ReabastecimentoSourceType;
  receivedLiters: number;
  invoiceNumber: string | null;
  funcionarioId: string | null;
  createdAt: string;
}

@Injectable()
export class ReabastecimentoService {
  constructor(private firebaseService: FirebaseService) {}

  private get collection() {
    return this.firebaseService.getFirestore().collection('reabastecimentos');
  }

  async create(input: CreateReabastecimentoDto): Promise<ReabastecimentoDoc> {
    const receivedLiters = parseReceivedLiters(input.receivedLiters);
    if (receivedLiters === null) {
      throw new BadRequestException(
        'The field receivedLiters must be greater than zero.',
      );
    }

    if (!isSupportedSourceType(input.sourceType)) {
      throw new BadRequestException(
        'The field sourceType must be gasStation, farmTank or distributor.',
      );
    }

    const comboioId = input.comboioId?.trim();
    if (!comboioId) {
      throw new BadRequestException('Informe o comboio (comboioId) da carga.');
    }

    const id = randomUUID();

    const doc: ReabastecimentoDoc = {
      id,
      prefeituraId: input.prefeituraId,
      comboioId,
      sourceType: input.sourceType,
      receivedLiters,
      invoiceNumber: input.invoiceNumber,
      funcionarioId: input.funcionarioId?.trim() || undefined,
      clientRequestId: input.clientRequestId,
      createdAt: new Date().toISOString(),
    };

    try {
      await this.collection.doc(id).set(doc, { merge: true });
      // Carga no comboio soma no saldo do tanque do comboio.
      await creditarTanque(
        this.firebaseService.getFirestore(),
        comboioId,
        receivedLiters,
      );
      return doc;
    } catch (error) {
      console.error('Erro ao criar reabastecimento:', error);
      throw new InternalServerErrorException(
        'Não foi possível registrar o reabastecimento.',
      );
    }
  }

  async listarPorPrefeitura(
    prefeituraId: string,
    startDate?: string,
    endDate?: string,
  ): Promise<{ data: ReabastecimentoListItem[]; message: string }> {
    try {
      const docs = await fetchPrefeituraDocs<ReabastecimentoDoc>(
        this.collection,
        prefeituraId,
        { startDate, endDate, order: 'desc' },
      );

      const data = docs.map((doc) => this.mapToListItem(doc));

      return { data, message: 'Reabastecimentos buscados com sucesso!' };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      console.error('Erro ao buscar reabastecimentos:', error);
      throw new InternalServerErrorException(
        'Não foi possível buscar os reabastecimentos.',
      );
    }
  }

  private mapToListItem(doc: ReabastecimentoDoc): ReabastecimentoListItem {
    return {
      id: doc.id,
      dateTime: formatDateTime(doc.createdAt),
      comboioId: doc.comboioId ?? null,
      sourceType: doc.sourceType,
      receivedLiters: doc.receivedLiters,
      invoiceNumber: doc.invoiceNumber ?? null,
      funcionarioId: doc.funcionarioId ?? null,
      createdAt: doc.createdAt,
    };
  }
}

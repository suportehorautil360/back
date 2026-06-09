import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FirebaseService } from '../../../config/firebase.service';
import {
  formatDateTime,
  parseDateEnd,
  parseDateStart,
} from '../shared/date.helper';
import { ajustarSaldoTanque } from '../shared/tank-saldo.helper';
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
  sourceType: ReabastecimentoSourceType;
  receivedLiters: number;
  invoiceNumber?: string;
  clientRequestId?: string;
  createdAt: string;
}

export interface ReabastecimentoListItem {
  id: string;
  dateTime: string;
  sourceType: ReabastecimentoSourceType;
  receivedLiters: number;
  invoiceNumber: string | null;
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

    const id = randomUUID();

    const doc: ReabastecimentoDoc = {
      id,
      prefeituraId: input.prefeituraId,
      sourceType: input.sourceType,
      receivedLiters,
      invoiceNumber: input.invoiceNumber,
      clientRequestId: input.clientRequestId,
      createdAt: new Date().toISOString(),
    };

    try {
      await this.collection.doc(id).set(doc, { merge: true });
      // Carga no comboio soma no saldo do tanque.
      await ajustarSaldoTanque(
        this.firebaseService.getFirestore(),
        input.prefeituraId,
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
      let query = this.collection
        .where('prefeituraId', '==', prefeituraId)
        .orderBy('createdAt', 'desc');

      if (startDate) {
        const start = parseDateStart(startDate, 'startDate');
        query = query.where('createdAt', '>=', start.toISOString());
      }

      if (endDate) {
        const end = parseDateEnd(endDate, 'endDate');
        query = query.where('createdAt', '<=', end.toISOString());
      }

      const snap = await query.get();
      const data = snap.docs.map((doc) =>
        this.mapToListItem(doc.data() as ReabastecimentoDoc),
      );

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
      sourceType: doc.sourceType,
      receivedLiters: doc.receivedLiters,
      invoiceNumber: doc.invoiceNumber ?? null,
      createdAt: doc.createdAt,
    };
  }
}

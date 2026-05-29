import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { FirebaseService } from '../../config/firebase.service';

export interface AbonoDoc {
  id: string;
  prefeituraId: string;
  /** CPF do funcionário (só dígitos) — chave pra casar com batidas/folha. */
  funcionarioCpf: string;
  /** Nome do funcionário (denormalizado para listagem). */
  funcionarioNome: string;
  /** Data do dia abonado no formato YYYY-MM-DD (local). */
  data: string;
  /** Motivo declarado pelo operador na solicitação. */
  motivo?: string | null;
  /** ID da solicitação de abono que originou (rastreabilidade). */
  solicitacaoId?: string | null;
  createdAt: string;
}

/**
 * Coleção de dias "abonados" — gerada quando o RH aprova uma solicitação
 * de abono. O front lê pra classificar o dia como `abonado` em vez de
 * `falta` no cálculo de saldo/KPIs.
 */
@Injectable()
export class AbonosService {
  constructor(private firebase: FirebaseService) {}

  private get collection() {
    return this.firebase.getFirestore().collection('abonos');
  }

  async criar(
    input: Omit<AbonoDoc, 'id' | 'createdAt'>,
  ): Promise<AbonoDoc> {
    const id = uuid();
    const doc: AbonoDoc = {
      id,
      ...input,
      createdAt: new Date().toISOString(),
    };
    try {
      await this.collection.doc(id).set(doc);
      return doc;
    } catch (e) {
      console.error('Erro ao criar abono:', e);
      throw new InternalServerErrorException(
        'Não foi possível registrar o abono.',
      );
    }
  }

  async listar(prefeituraId: string) {
    try {
      const snap = await this.collection
        .where('prefeituraId', '==', prefeituraId)
        .get();
      const data = snap.docs
        .map((d) => d.data() as AbonoDoc)
        // Mais recentes primeiro (data desc).
        .sort((a, b) => b.data.localeCompare(a.data));
      return { data, message: 'Abonos carregados.' };
    } catch (e) {
      console.error('Erro ao listar abonos:', e);
      throw new InternalServerErrorException(
        'Não foi possível listar os abonos.',
      );
    }
  }

  async remover(id: string) {
    const ref = this.collection.doc(id);
    const snap = await ref.get();
    if (!snap.exists) throw new NotFoundException('Abono não encontrado.');
    await ref.delete();
    return { data: { id }, message: 'Abono removido.' };
  }
}

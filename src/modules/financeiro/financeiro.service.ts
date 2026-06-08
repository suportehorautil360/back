import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FirebaseService } from '../../config/firebase.service';
import {
  FinanceiroOverview,
  LancamentoFinanceiro,
  StatusLancamento,
  TipoLancamento,
} from './financeiro.types';
import { CreateLancamentoDto } from './dto/create-lancamento.dto';

const COLECAO = 'lancamentos_financeiros';
const STATUS: StatusLancamento[] = ['pago', 'pendente', 'atrasado'];

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor : '';
}

function numero(valor: unknown): number {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
  if (typeof valor === 'string') {
    const limpo = valor
      .replace(/[^0-9,.-]/g, '')
      .replace(/\./g, '')
      .replace(',', '.');
    const n = Number(limpo);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** "FI-1001" => 1001. */
function numeroDocumento(documento: string): number {
  const m = /(\d+)/.exec(documento);
  return m ? Number(m[1]) : 0;
}

@Injectable()
export class FinanceiroService {
  constructor(private firebaseService: FirebaseService) {}

  private get colecao() {
    return this.firebaseService.getFirestore().collection(COLECAO);
  }

  private mapDoc(id: string, d: Record<string, unknown>): LancamentoFinanceiro {
    const tipo: TipoLancamento = d.tipo === 'despesa' ? 'despesa' : 'receita';
    const statusBruto = texto(d.status) as StatusLancamento;
    const status: StatusLancamento = STATUS.includes(statusBruto)
      ? statusBruto
      : 'pendente';
    return {
      id,
      documento: texto(d.documento),
      tipo,
      descricao: texto(d.descricao),
      valor: numero(d.valor),
      vencimento: texto(d.vencimento),
      status,
    };
  }

  async listar(): Promise<{ data: FinanceiroOverview }> {
    try {
      const snap = await this.colecao.get();
      const lancamentos = snap.docs.map((doc) =>
        this.mapDoc(doc.id, doc.data() as Record<string, unknown>),
      );
      lancamentos.sort(
        (a, b) => numeroDocumento(a.documento) - numeroDocumento(b.documento),
      );

      const receitas = lancamentos
        .filter((l) => l.tipo === 'receita')
        .reduce((s, l) => s + l.valor, 0);
      const despesas = lancamentos
        .filter((l) => l.tipo === 'despesa')
        .reduce((s, l) => s + l.valor, 0);

      return {
        data: {
          lancamentos,
          resumo: {
            receitas,
            despesas,
            saldo: receitas - despesas,
            total: lancamentos.length,
          },
        },
      };
    } catch (error) {
      console.error('Erro ao listar lançamentos:', error);
      throw new InternalServerErrorException(
        'Não foi possível carregar o financeiro.',
      );
    }
  }

  async criar(dto: CreateLancamentoDto) {
    const descricao = (dto.descricao ?? '').trim();
    const valor = numero(dto.valor);
    const tipo: TipoLancamento = dto.tipo === 'despesa' ? 'despesa' : 'receita';
    const status: StatusLancamento = STATUS.includes(
      dto.status as StatusLancamento,
    )
      ? (dto.status as StatusLancamento)
      : 'pendente';

    if (!descricao) {
      throw new BadRequestException('Informe a descrição do lançamento.');
    }
    if (!(valor > 0)) {
      throw new BadRequestException('Informe um valor maior que zero.');
    }

    try {
      const snap = await this.colecao.get();
      let max = 1000;
      for (const doc of snap.docs) {
        const n = numeroDocumento(
          texto((doc.data() as Record<string, unknown>).documento),
        );
        if (n > max) max = n;
      }
      const documento = `FI-${max + 1}`;
      const id = randomUUID();
      const novo = {
        id,
        documento,
        tipo,
        descricao,
        valor,
        vencimento: texto(dto.vencimento),
        status,
        createdAt: new Date().toISOString(),
      };
      await this.colecao.doc(id).set(novo);
      return { data: { id, documento }, message: 'Lançamento criado.' };
    } catch (error) {
      console.error('Erro ao salvar lançamento:', error);
      throw new InternalServerErrorException(
        'Não foi possível salvar o lançamento.',
      );
    }
  }

  async remover(id: string) {
    if (!id) throw new BadRequestException('ID inválido.');
    try {
      await this.colecao.doc(id).delete();
      return { message: 'Lançamento removido.' };
    } catch (error) {
      console.error('Erro ao remover lançamento:', error);
      throw new InternalServerErrorException(
        'Não foi possível remover o lançamento.',
      );
    }
  }
}

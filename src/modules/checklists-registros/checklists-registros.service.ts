import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { FirebaseService } from '../../config/firebase.service';
import type {
  ChecklistRegistroDoc,
  ChecklistRegistroResumoPainel,
  TopOperadorChecklist,
} from './checklists-registros.types';
import { mapChecklistRegistroFromFirestore } from './helpers/checklists-registros.mapper';
import {
  calcularChecklistsPorSemana,
  calcularTopOperadores,
  filtrarChecklistsPorMes,
} from './helpers/top-operadores.helper';

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function mesAtualIso(): string {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
}

@Injectable()
export class ChecklistsRegistrosService {
  constructor(private readonly firebaseService: FirebaseService) {}

  private get collection() {
    return this.firebaseService.getFirestore().collection('checklistsRegistros');
  }

  private async listarDocsPorPrefeitura(
    prefeituraId: string,
  ): Promise<ChecklistRegistroDoc[]> {
    const id = texto(prefeituraId);
    if (!id) {
      throw new BadRequestException('prefeituraId inválido.');
    }

    try {
      const snap = await this.collection.where('prefeituraId', '==', id).get();

      return snap.docs
        .map((doc) =>
          mapChecklistRegistroFromFirestore(
            doc.id,
            doc.data() as Record<string, unknown>,
          ),
        )
        .sort((a, b) => b.dataHoraIso.localeCompare(a.dataHoraIso));
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Erro ao listar checklists de operador:', error);
      throw new InternalServerErrorException(
        'Não foi possível listar os checklists de operador.',
      );
    }
  }

  async listarPorPrefeitura(
    prefeituraId: string,
  ): Promise<{ data: ChecklistRegistroDoc[]; message: string }> {
    const data = await this.listarDocsPorPrefeitura(prefeituraId);
    return {
      data,
      message: 'Checklists de operador carregados com sucesso.',
    };
  }

  async topOperadores(
    prefeituraId: string,
    mes?: string,
    limite = 5,
  ): Promise<{
    data: { mes: string; operadores: TopOperadorChecklist[] };
    message: string;
  }> {
    const mesRef = texto(mes) || mesAtualIso();
    const registros = await this.listarDocsPorPrefeitura(prefeituraId);
    const noMes = filtrarChecklistsPorMes(registros, mesRef);
    const operadores = calcularTopOperadores(noMes, limite);

    return {
      data: { mes: mesRef, operadores },
      message: 'Ranking de operadores carregado com sucesso.',
    };
  }

  async resumoPainel(
    prefeituraId: string,
    mes?: string,
  ): Promise<{ data: ChecklistRegistroResumoPainel; message: string }> {
    const mesRef = texto(mes) || mesAtualIso();
    const registros = await this.listarDocsPorPrefeitura(prefeituraId);
    const noMes = filtrarChecklistsPorMes(registros, mesRef);

    return {
      data: {
        mes: mesRef,
        totalGeral: registros.length,
        totalNoMes: noMes.length,
        checklistsPorSemana: calcularChecklistsPorSemana(noMes),
        topOperadores: calcularTopOperadores(noMes, 5),
      },
      message: 'Resumo de checklists do painel carregado com sucesso.',
    };
  }
}

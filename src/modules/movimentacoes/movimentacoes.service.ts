import { Injectable } from '@nestjs/common';
import { AbastecimentosService } from './abastecimentos/abastecimentos.service';

export interface MovimentacaoFiltroPeriodo {
  startDate?: string;
  endDate?: string;
}

@Injectable()
export class MovimentacoesService {
  constructor(private readonly abastecimentosService: AbastecimentosService) {}

  async listarHistorico(
    prefeituraId: string,
    startDate?: string,
    endDate?: string,
  ) {
    return this.abastecimentosService.listar(prefeituraId, startDate, endDate);
  }
}

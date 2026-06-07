export type UnidadeMedicao = 'h' | 'km';
export type TipoMedicaoInterno = 'horimetro' | 'hodometro';
export type MeasurementTypeResponse = 'horimetro' | 'odometro';
export type TotalDestaqueTipo = 'litros' | 'gasto';

export interface ConsumoCustoMetricaConsumo {
  rotulo: string;
  valor: number | null;
  valorExibicao: string;
}

export interface ConsumoCustoMetricaCusto {
  rotulo: string;
  valor: number | null;
  valorExibicao: string;
}

export interface ConsumoCustoTotalDestaque {
  tipo: TotalDestaqueTipo;
  rotulo: string;
  valor: number;
  valorExibicao: string;
}

export interface ConsumoCustoTotais {
  litros: number;
  litrosExibicao: string;
  gasto: number;
  gastoExibicao: string;
}

export interface ConsumoCustoIntervalo {
  periodoLabel: string;
  distanciaLabel: string;
  consumoLabel: string;
  custoLabel: string;
}

export interface ConsumoCustoVeiculoCard {
  equipmentId: string;
  nome: string;
  placa: string;
  tipo: string;
  setor: string;
  subtitulo: string;
  measurementType: MeasurementTypeResponse;
  unidadeMedicao: UnidadeMedicao;
  temCusto: boolean;
  consumoMedio: ConsumoCustoMetricaConsumo;
  custoMedio: ConsumoCustoMetricaCusto;
  totalDestaque: ConsumoCustoTotalDestaque;
  totais: ConsumoCustoTotais;
  historicoIntervalos: ConsumoCustoIntervalo[];
}

export interface ConsumoCustoCalculoInfo {
  titulo: string;
  formulaConsumo: string;
  formulaCusto: string;
  observacao: string;
}

export interface ConsumoCustoPeriodo {
  label: string;
  startDate: string | null;
  endDate: string | null;
}

export interface ConsumoCustoPayload {
  titulo: string;
  periodo: ConsumoCustoPeriodo;
  calculo: ConsumoCustoCalculoInfo;
  veiculos: ConsumoCustoVeiculoCard[];
}

export interface AbastecimentoConsumoInput {
  id: string;
  equipmentId: string;
  plateOrChassis: string;
  liters: number;
  currentReading: number;
  measurementType: TipoMedicaoInterno;
  total: number | null;
  createdAt: string;
}

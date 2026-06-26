import { TipoMedicao } from '../movimentacoes/abastecimentos/dto/create-abastecimento.dto';

/** Estados da intenção de abastecimento (fluxo do QR posto ↔ motorista). */
export type FleetfuelStatus =
  | 'pendente_validacao'
  | 'concluido'
  | 'expirado'
  | 'cancelado';

/**
 * Intenção de abastecimento criada pelo operador do posto (coleção
 * `fleetfuel_intencoes`). Nasce `pendente_validacao` e só vira `concluido`
 * quando o motorista valida o QR — é nesse momento que o saldo é debitado.
 */
export interface IntencaoAbastecimentoDoc {
  id: string;
  prefeituraId: string;
  postoId: string;
  postoNome?: string;
  equipmentId: string;
  plateOrChassis: string;
  veiculoModelo?: string;
  veiculoDescricao?: string;
  combustivelVeiculo?: string;
  motoristaId: string | null;
  motoristaCpf: string;
  motoristaNome: string;
  tipoCombustivel: string;
  liters: number;
  pricePerLiter: number;
  total: number;
  currentReading: number;
  measurementType: TipoMedicao;
  status: FleetfuelStatus;
  abastecimentoId?: string;
  createdAt: string;
  expiresAt: string;
  validatedAt?: string;
  /** Funcionário que validou (motorista que escaneou o QR). */
  validadoPorFuncionarioId?: string;
}

/** Dados do veículo devolvidos na verificação (Etapa 1). */
export interface VeiculoVerificado {
  equipmentId: string;
  placa: string;
  descricao: string;
  modelo: string;
  tipo: string;
  combustivel: string;
  medicaoAtual: number;
  unidadeRevisao: 'km' | 'h' | null;
  capacidadeTanque: number;
  status: string;
}

/** Dados do motorista devolvidos na verificação (Etapa 1). */
export interface MotoristaVerificado {
  id: string;
  nome: string;
  cpf: string;
  cargo: string;
}

/** Motivo de bloqueio da verificação. */
export interface BloqueioVerificacao {
  codigo:
    | 'veiculo_nao_encontrado'
    | 'veiculo_inativo'
    | 'odometro_incoerente'
    | 'revisao_obrigatoria'
    | 'motorista_nao_encontrado'
    | 'motorista_inativo';
  titulo: string;
  detalhe: string;
}

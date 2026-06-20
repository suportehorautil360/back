import type {
  AcaoMatriz,
  CicloMatriz,
  LinhaMatriz,
  SalvarPlanoPreventivoInput,
} from '../planos-preventivos.types';

function tituloCicloPadrao(horas: number, km: number, idx: number): string {
  const h = horas.toLocaleString('pt-BR');
  const k = km.toLocaleString('pt-BR');
  return `Ciclo ${idx + 1} (${h}h / ${k}km)`;
}

function ciclo(
  id: string,
  horas: number,
  km: number,
  idx: number,
): CicloMatriz {
  return { id, horas, km, titulo: tituloCicloPadrao(horas, km, idx) };
}

function linha(
  id: string,
  categoria: string,
  item: string,
  especificacao: string,
  acoesLista: AcaoMatriz[],
): LinhaMatriz {
  const ciclosIds = ['c1', 'c2', 'c3', 'c4'];
  const acoes: Record<string, AcaoMatriz> = {};
  ciclosIds.forEach((cid, i) => {
    acoes[cid] = acoesLista[i] ?? 'na';
  });
  return { id, categoria, item, especificacao, acoes };
}

/** Seed espelhando MATRIZ_PADRAO do front (plano-preventivo-model.ts). */
export const MATRIZ_PADRAO: SalvarPlanoPreventivoInput = {
  ciclos: [
    ciclo('c1', 250, 10_000, 0),
    ciclo('c2', 500, 20_000, 1),
    ciclo('c3', 1_000, 40_000, 2),
    ciclo('c4', 2_000, 80_000, 3),
  ],
  linhas: [
    linha('l1', 'Fluidos', 'Óleo do Motor', 'SAE 15W-40 CI-4', [
      'inspecionar',
      'inspecionar',
      'trocar',
      'trocar',
    ]),
    linha('l2', 'Fluidos', 'Óleo da Transmissão', 'Conforme fabricante', [
      'na',
      'inspecionar',
      'trocar',
      'trocar',
    ]),
    linha('l3', 'Fluidos', 'Óleo do Sistema Hidráulico', 'ISO VG 46', [
      'inspecionar',
      'inspecionar',
      'trocar',
      'trocar',
    ]),
    linha('l4', 'Fluidos', 'Óleo dos Eixos / Diferencial', '80W-90 GL-5', [
      'na',
      'inspecionar',
      'trocar',
      'trocar',
    ]),
    linha('l5', 'Fluidos', 'Líquido de Arrefecimento', 'Orgânico / Etileno', [
      'inspecionar',
      'inspecionar',
      'trocar',
      'trocar',
    ]),
    linha('l6', 'Fluidos', 'Fluido de Freio / Embreagem', 'DOT 4', [
      'inspecionar',
      'inspecionar',
      'trocar',
      'trocar',
    ]),
    linha('l7', 'Filtros', 'Filtro de Óleo do Motor', 'Cartucho / spin-on', [
      'trocar',
      'trocar',
      'trocar',
      'trocar',
    ]),
    linha(
      'l8',
      'Filtros',
      'Filtro de Combustível (Principal)',
      'Elemento principal',
      ['inspecionar', 'trocar', 'trocar', 'trocar'],
    ),
    linha(
      'l9',
      'Filtros',
      'Filtro de Combustível (Separador/Racor)',
      "Separador d'água",
      ['inspecionar', 'trocar', 'trocar', 'trocar'],
    ),
    linha(
      'l10',
      'Filtros',
      'Filtro de Ar do Motor (Primário)',
      'Elemento externo',
      ['inspecionar', 'trocar', 'trocar', 'trocar'],
    ),
    linha(
      'l11',
      'Filtros',
      'Filtro de Ar do Motor (Secundário)',
      'Elemento interno',
      ['na', 'inspecionar', 'trocar', 'trocar'],
    ),
    linha(
      'l12',
      'Filtros',
      'Filtro do Hidráulico (Sucção/Retorno)',
      'Duplo elemento',
      ['inspecionar', 'trocar', 'trocar', 'trocar'],
    ),
    linha('l13', 'Filtros', 'Filtro da Transmissão', 'Conforme fabricante', [
      'na',
      'na',
      'trocar',
      'trocar',
    ]),
    linha(
      'l14',
      'Filtros',
      'Filtro de Cabine (Ar Condicionado)',
      'Cabine / HVAC',
      ['na', 'inspecionar', 'trocar', 'trocar'],
    ),
    linha(
      'l15',
      'Consumo',
      'Correia de Acessórios (Alternador/Ar)',
      'Perfil V / Poly-V',
      ['inspecionar', 'inspecionar', 'trocar', 'trocar'],
    ),
    linha('l16', 'Consumo', 'Correia Dentada (se houver)', 'Conforme motor', [
      'inspecionar',
      'inspecionar',
      'se_necessario',
      'trocar',
    ]),
    linha('l17', 'Consumo', 'Pastilhas / Lonas de Freio', 'Conjunto eixo', [
      'inspecionar',
      'inspecionar',
      'medir_trocar',
      'medir_trocar',
    ]),
    linha('l18', 'Consumo', 'Discos / Tambores de Freio', 'Conforme desgaste', [
      'inspecionar',
      'inspecionar',
      'medir_trocar',
      'medir_trocar',
    ]),
    linha('l19', 'Consumo', 'Palhetas do Limpador', 'Par dianteiro', [
      'inspecionar',
      'se_necessario',
      'trocar',
      'trocar',
    ]),
    linha(
      'l20',
      'Consumo',
      'Elementos de Desgaste (Dentes/Chapas)',
      'Caçamba / implemento',
      ['inspecionar', 'inspecionar', 'trocar', 'trocar'],
    ),
    linha(
      'l21',
      'Serviço',
      'Lubrificação Geral (Graxeiras)',
      'Pontos de graxa',
      ['lubrificar', 'lubrificar', 'lubrificar', 'lubrificar'],
    ),
    linha(
      'l22',
      'Serviço',
      'Análise de Óleo (Preditiva)',
      'Laboratório credenciado',
      ['na', 'coletar', 'coletar', 'coletar'],
    ),
  ],
};

export function clonarMatrizPadrao(): SalvarPlanoPreventivoInput {
  return JSON.parse(
    JSON.stringify(MATRIZ_PADRAO),
  ) as SalvarPlanoPreventivoInput;
}

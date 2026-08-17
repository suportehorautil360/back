type EquipmentRow = {
  id: string;
  legacyId: string | null;
  descricao: string | null;
  chassi: string | null;
  modelo: string | null;
  linha: string | null;
  tipo: string | null;
  placa: string | null;
  marca: string | null;
  ano: string | null;
  obra: string | null;
  status: string;
  medicaoAtual: number | null;
  intervaloRevisao: number | null;
  ultimaRevisao: number | null;
  unidadeRevisao: string | null;
  combustivel?: string | null;
  capacidadeTanque?: number | null;
  capacidadeTanqueCaminhao?: number | null;
  condutoresIds?: unknown;
};

function txt(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function parseCondutoresIds(json: unknown): string[] {
  if (!Array.isArray(json)) return [];
  return json.filter((x): x is string => typeof x === 'string');
}

export function ehCondutorDoEquipamentoRow(
  row: Pick<EquipmentRow, 'condutoresIds'>,
  operadorLegacyId: string,
): boolean {
  return parseCondutoresIds(row.condutoresIds).includes(operadorLegacyId);
}

export function ehComboioTipo(tipo: unknown): boolean {
  return typeof tipo === 'string' && tipo.trim().toLowerCase() === 'comboio';
}

/** Shape consumido pelos PWAs (compat Firestore `equipamentos`). */
export function mapEquipmentToApi(
  row: EquipmentRow,
  prefeituraId: string,
) {
  const publicId = row.legacyId ?? row.id;
  return {
    id: publicId,
    prefeituraId,
    descricao: row.descricao ?? '',
    label: row.descricao ?? '',
    chassis: row.chassi ?? '',
    chassi: row.chassi ?? '',
    modelo: row.modelo ?? '',
    linha: row.linha ?? '',
    tipo: row.tipo ?? '',
    placa: row.placa ?? '',
    marca: row.marca ?? '',
    ano: row.ano ?? '',
    obra: row.obra ?? '',
    status: row.status ?? 'ativo',
    medicaoAtual: row.medicaoAtual ?? 0,
    intervaloRevisao: row.intervaloRevisao ?? 0,
    ultimaRevisao: row.ultimaRevisao ?? 0,
    unidadeRevisao: row.unidadeRevisao ?? 'h',
    combustivel: txt(row.combustivel),
    capacidadeTanque: row.capacidadeTanque ?? null,
    capacidadeTanqueCaminhao: row.capacidadeTanqueCaminhao ?? null,
    condutoresResponsaveis: parseCondutoresIds(row.condutoresIds),
  };
}

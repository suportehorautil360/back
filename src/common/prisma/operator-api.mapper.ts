type OperatorRow = {
  id: string;
  legacyId: string | null;
  nome: string;
  cpf: string | null;
  cargo: string | null;
  funcao: string | null;
  tipo: string;
  status: string;
  loginGerado: string | null;
  matricula: string | null;
  telefone?: string | null;
  celular?: string | null;
  dataNascimento?: Date | null;
  rg?: string | null;
  cnh?: string | null;
  cnhCategoria?: string | null;
  cnhValidade?: Date | null;
  cnhEmissao?: Date | null;
  cnhLocalEmissao?: string | null;
  cnhRestricao?: string | null;
  observacoes?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function isoDate(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString().slice(0, 10);
}

/** Compat com coleção Firestore `operadores`. */
export function mapOperatorToApi(
  row: OperatorRow,
  prefeituraId: string,
): Record<string, unknown> {
  const publicId = row.legacyId ?? row.id;
  const telefone = row.celular ?? row.telefone ?? null;
  return {
    id: publicId,
    prefeituraId,
    nome: row.nome,
    cpf: row.cpf ?? '',
    cargo: row.cargo ?? row.funcao ?? '',
    loginGerado: row.loginGerado ?? '',
    tipo: row.tipo ?? 'operador',
    status: row.status ?? 'ativo',
    matricula: row.matricula,
    telefone,
    dataNascimento: isoDate(row.dataNascimento),
    rg: row.rg,
    cnh: row.cnh,
    cnhCategoria: row.cnhCategoria,
    cnhValidade: isoDate(row.cnhValidade),
    cnhEmissao: isoDate(row.cnhEmissao),
    cnhLocalEmissao: row.cnhLocalEmissao,
    cnhRestricao: row.cnhRestricao,
    observacoes: row.observacoes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

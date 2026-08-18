import type { Company, CompanyType } from '../../prisma/generated/client';
import type {
  ClienteOverviewRow,
  TipoClienteApi,
} from '../../modules/clientes/clientes.types';
import { publicLegacyId } from './service-order-resolver';

function contractRecord(
  contract: unknown,
): Record<string, unknown> {
  if (contract && typeof contract === 'object' && !Array.isArray(contract)) {
    return contract as Record<string, unknown>;
  }
  return {};
}

export function companyTypeToApi(type: CompanyType): TipoClienteApi {
  return type === 'RENTAL' ? 'locacao' : 'prefeitura';
}

export function apiTypeToCompanyType(tipo: TipoClienteApi): CompanyType {
  return tipo === 'locacao' ? 'RENTAL' : 'MUNICIPALITY';
}

export function mapCompanyToOverview(
  row: Company,
  metrics: { ativos: number; emManutencao: number; checklists: number },
): ClienteOverviewRow {
  const contrato = contractRecord(row.contract);
  return {
    id: publicLegacyId(row),
    nome: row.name,
    uf: row.uf ?? '',
    tipoCliente: companyTypeToApi(row.type),
    email: String(contrato.emailContratante ?? row.email ?? ''),
    ativos: metrics.ativos,
    emManutencao: metrics.emManutencao,
    checklists: metrics.checklists,
    custoAcumulado: 0,
    osCotacao: 0,
    osNfPagamento: 0,
  };
}

export function mapCompanyToLegacyDoc(row: Company): Record<string, unknown> {
  const contrato = contractRecord(row.contract);
  return {
    id: publicLegacyId(row),
    nome: row.name,
    uf: row.uf ?? '',
    tipoCliente: companyTypeToApi(row.type),
    cnpj: row.cnpj ?? '',
    caepf: row.caepf ?? '',
    cidade: row.cidade ?? '',
    whatsapp: row.whatsapp ?? '',
    contrato,
    checklistLogin: row.checklistLogin ?? undefined,
    razaoSocial: row.razaoSocial ?? row.name,
  };
}

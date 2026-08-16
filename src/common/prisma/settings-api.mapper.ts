type CompanyRow = {
  legacyId: string | null;
  name: string;
  razaoSocial: string | null;
  cnpj: string | null;
  caepf: string | null;
  cidade: string | null;
  uf: string | null;
};

type SettingsRow = {
  alertBloqueioRevisaoVencida: boolean;
  alertNivelCriticoTanque: boolean;
  alertAbastecimentoIrregular: boolean;
  alertCnhProximaVencimento: boolean;
  alertRelatorioSemanal: boolean;
  alertWhatsappEmergencia: boolean;
  bloquearAoVencer: boolean;
  alertar80: boolean;
  alertar90: boolean;
  escalaInicio: string;
  escalaFim: string;
  escalaAlmocoMin: number;
  escalaDias: unknown;
  intervalos: unknown;
};

function parseDiasSemana(json: unknown): number[] {
  if (!Array.isArray(json)) return [1, 2, 3, 4, 5];
  return json.filter((n): n is number => typeof n === 'number');
}

/** Compat com GET `/configuracoes/:prefeituraId` (Firestore legado). */
export function mapConfiguracaoToApi(
  prefeituraId: string,
  company: CompanyRow,
  settings: SettingsRow | null,
) {
  const empresa = {
    razaoSocial: company.razaoSocial ?? company.name,
    cnpj: company.cnpj ?? undefined,
    caepf: company.caepf ?? undefined,
    cidade: company.cidade ?? undefined,
    estado: company.uf ?? undefined,
  };

  if (!settings) {
    return { prefeituraId, empresa };
  }

  return {
    prefeituraId,
    empresa,
    alertas: {
      bloqueioRevisaoVencida: settings.alertBloqueioRevisaoVencida,
      nivelCriticoTanque: settings.alertNivelCriticoTanque,
      abastecimentoIrregular: settings.alertAbastecimentoIrregular,
      cnhProximaVencimento: settings.alertCnhProximaVencimento,
      relatorioSemanal: settings.alertRelatorioSemanal,
      whatsappEmergencia: settings.alertWhatsappEmergencia,
    },
    bloqueio: {
      bloquearAoVencer: settings.bloquearAoVencer,
      alertar80: settings.alertar80,
      alertar90: settings.alertar90,
    },
    intervalos: settings.intervalos ?? {},
  };
}

/** Compat com GET `/escala/:prefeituraId`. */
export function mapEscalaToApi(
  prefeituraId: string,
  settings: SettingsRow,
) {
  return {
    prefeituraId,
    inicio: settings.escalaInicio,
    fim: settings.escalaFim,
    diasSemana: parseDiasSemana(settings.escalaDias),
    almocoMinutos: settings.escalaAlmocoMin,
  };
}

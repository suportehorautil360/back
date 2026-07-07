/** Funções puras de métricas do Hub WhatsApp (sem I/O — fáceis de testar). */

export type WhatsAppStatus =
  | 'desconectado'
  | 'conectando'
  | 'aguardando_qr'
  | 'conectado';

export type TipoEventoWhats =
  | 'sessao_iniciada'
  | 'qr_gerado'
  | 'conectado'
  | 'queda'
  | 'sessao_encerrada';

export type StatusEventoWhats = 'sucesso' | 'aviso' | 'erro';

export interface EventoWhats {
  id: string;
  tipo: TipoEventoWhats;
  status: StatusEventoWhats;
  timestamp: string;
}

export interface ConfigWhats {
  alertas?: { notificacaoWhatsapp?: boolean };
  empresa?: { whatsappNumero?: string };
}

/** Conta empresas com a notificação de emergência ligada E número cadastrado. */
export function contarEmpresasComWhats(configs: ConfigWhats[]): number {
  return configs.filter(
    (c) =>
      c.alertas?.notificacaoWhatsapp === true &&
      (c.empresa?.whatsappNumero ?? '').trim() !== '',
  ).length;
}

const MS_DIA = 86_400_000;

export interface WhatsappDisponibilidade {
  percentual: number;
  desde: string;
  janelaCompleta: boolean;
}

/**
 * % de tempo "conectado" no período medido, a partir do log de eventos.
 * Assume desconectado antes do primeiro evento dentro da janela (a precisão
 * cresce conforme o histórico acumula — ver spec). `agora` é injetado p/ teste.
 */
export function calcularDisponibilidade(
  eventos: { tipo: TipoEventoWhats; timestamp: string }[],
  agora: Date,
  janelaDias = 30,
): WhatsappDisponibilidade {
  const fimMs = agora.getTime();
  const janelaInicioMs = fimMs - janelaDias * MS_DIA;

  // Só eventos de transição que abrem/fecham conexão, ordenados asc.
  const transicoes = eventos
    .filter((e) => ['conectado', 'queda', 'sessao_encerrada'].includes(e.tipo))
    .map((e) => ({ tipo: e.tipo, ms: new Date(e.timestamp).getTime() }))
    .filter((e) => Number.isFinite(e.ms))
    .sort((a, b) => a.ms - b.ms);

  if (transicoes.length === 0) {
    return { percentual: 0, desde: agora.toISOString(), janelaCompleta: false };
  }

  const primeiroMs = transicoes[0].ms;
  const janelaCompleta = primeiroMs <= janelaInicioMs;
  const inicioMedicaoMs = Math.max(primeiroMs, janelaInicioMs);
  const totalMs = Math.max(fimMs - inicioMedicaoMs, 1);

  let conectadoMs = 0;
  let aberturaMs: number | null = null;
  for (const t of transicoes) {
    const pontoMs = Math.max(t.ms, inicioMedicaoMs);
    if (t.tipo === 'conectado') {
      if (aberturaMs === null) aberturaMs = pontoMs;
    } else if (aberturaMs !== null) {
      conectadoMs += Math.max(pontoMs - aberturaMs, 0);
      aberturaMs = null;
    }
  }
  // Conexão ainda aberta no fim da janela.
  if (aberturaMs !== null) conectadoMs += Math.max(fimMs - aberturaMs, 0);

  const percentual = Math.round((conectadoMs / totalMs) * 1000) / 10;
  return {
    percentual: Math.min(percentual, 100),
    desde: new Date(inicioMedicaoMs).toISOString(),
    janelaCompleta,
  };
}

export interface WhatsappSessao {
  numeroConectado: string | null;
  nomeSessao: string | null;
  conectadoDesde: string | null;
  ultimaAtividade: string | null;
  versaoSessao: string | null;
  ambiente: 'dev' | 'prod';
}
export interface WhatsappKpis {
  empresasUtilizando: number;
  mensagensHoje: number;
  mensagens30d: number;
  disponibilidade: WhatsappDisponibilidade;
}
export type WhatsAppIntegracao = 'evolution' | 'remote' | 'baileys';

export interface WhatsappOverview {
  status: WhatsAppStatus;
  qrImagem?: string;
  /** Como a sessão WhatsApp é gerenciada (Evolution = pareamento no Manager). */
  integracao: WhatsAppIntegracao;
  /** URL do Manager Evolution (quando `integracao === 'evolution'`). */
  evolutionManagerUrl?: string | null;
  sessao: WhatsappSessao;
  kpis: WhatsappKpis;
  eventos: EventoWhats[];
}

/** Lista de `count` ids de dia (YYYY-MM-DD, UTC), terminando em `ref`, desc. */
export function ultimosDias(count: number, ref: Date): string[] {
  const dias: string[] = [];
  for (let i = 0; i < count; i++) {
    dias.push(new Date(ref.getTime() - i * MS_DIA).toISOString().slice(0, 10));
  }
  return dias;
}

export interface MontarOverviewArgs extends WhatsappSessao {
  status: WhatsAppStatus;
  qrImagem?: string;
  integracao: WhatsAppIntegracao;
  evolutionManagerUrl?: string | null;
  empresasUtilizando: number;
  mensagensHoje: number;
  mensagens30d: number;
  disponibilidade: WhatsappDisponibilidade;
  eventos: EventoWhats[];
}

export function montarOverview(a: MontarOverviewArgs): WhatsappOverview {
  return {
    status: a.status,
    qrImagem: a.qrImagem,
    integracao: a.integracao,
    evolutionManagerUrl: a.evolutionManagerUrl ?? null,
    sessao: {
      numeroConectado: a.numeroConectado,
      nomeSessao: a.nomeSessao,
      conectadoDesde: a.conectadoDesde,
      ultimaAtividade: a.ultimaAtividade,
      versaoSessao: a.versaoSessao,
      ambiente: a.ambiente,
    },
    kpis: {
      empresasUtilizando: a.empresasUtilizando,
      mensagensHoje: a.mensagensHoje,
      mensagens30d: a.mensagens30d,
      disponibilidade: a.disponibilidade,
    },
    eventos: a.eventos,
  };
}

export interface OcorrenciaDoc {
  id: string;
  dataHoraIso: string;
  dataHora: string;
  usuario: string;
  mensagem: string;
  tipo: string;
}

export interface OcorrenciaListItem {
  id: string;
  dataHora: string;
  usuario: string;
  mensagem: string;
  tipo: string;
}

export interface OcorrenciaResumoOs {
  total: number;
}

export function mapOcorrenciaParaLista(doc: OcorrenciaDoc): OcorrenciaListItem {
  return {
    id: doc.id,
    dataHora: doc.dataHora,
    usuario: doc.usuario,
    mensagem: doc.mensagem,
    tipo: doc.tipo,
  };
}

/**
 * Resolve o ledger imutável de ponto (Portaria 671) numa visão efetiva, sem
 * nunca alterar os registros de origem.
 *
 * Porta a mesma decisão de produto que `lib/pwa/ponto/resolverLedger.ts` do
 * horautil já aplica. Vive aqui, e não no aparelho, de propósito: o app
 * consome o resultado pronto e nunca reimplementa estas regras — é uma
 * implementação a menos para divergir.
 *
 * - A `original` é o horário oficial.
 * - Um `ajuste` com alvo só troca o oficial DEPOIS de aprovado (`aplicado`);
 *   pendente, mantém o original e sinaliza.
 * - Um `ajuste` sem alvo é inclusão de batida esquecida: vira batida própria
 *   quando aprovado.
 * - Um `cancelamento` aplicado tira a original da visão, sem apagá-la.
 */
export type RegistroPonto = {
  id: string;
  /**
   * O id que o APARELHO gerou para a batida (`checklist-chassi.service.ts`
   * grava `legacyId: clientId` e um `id` novo). É por ele que o app reconhece
   * a própria batida na lista que volta — o `id` daqui é a PK do Postgres, que
   * o aparelho nunca viu. Sem isto o espelho mostra cada batida sincronizada
   * duas vezes, uma selada e outra como se tivesse sido cancelada.
   */
  legacyId: string | null;
  nsr: number;
  // Portaria 671 exige NSR e hash no CRPT. Sem declarar aqui, o campo viria
  // do Prisma em runtime e sumiria na tipagem — pior do que não ter.
  hash: string | null;
  tipo: string;
  timestampOriginal: string;
  operatorNome: string;
  operatorCpf: string | null;
  registro: string;
  refNsr: number | null;
  refId: string | null;
  aplicado: boolean;
  motivo: string | null;
  motivoReprovacao: string | null;
  createdAt: string;
};

export type BatidaEfetiva = RegistroPonto & {
  ajustePendente?: boolean;
  horarioAnterior?: string;
};

/** Um ajuste/cancelamento mira esta original? NSR preferido, id como reserva. */
function mira(ref: RegistroPonto, alvo: RegistroPonto): boolean {
  if (ref.refNsr != null) return ref.refNsr === alvo.nsr;
  if (ref.refId) return ref.refId === alvo.id;
  return false;
}

function ehInclusao(r: RegistroPonto): boolean {
  return r.registro === 'ajuste' && r.refNsr == null && !r.refId;
}

function porNsr(a: RegistroPonto, b: RegistroPonto): number {
  return a.nsr - b.nsr;
}

export function resolverLedger(registros: RegistroPonto[]): BatidaEfetiva[] {
  const originais: RegistroPonto[] = [];
  const ajustes: RegistroPonto[] = [];
  const cancelamentos: RegistroPonto[] = [];
  const inclusoes: RegistroPonto[] = [];

  for (const r of registros) {
    if (r.registro === 'cancelamento') cancelamentos.push(r);
    else if (ehInclusao(r)) inclusoes.push(r);
    else if (r.registro === 'ajuste') ajustes.push(r);
    else originais.push(r);
  }

  const efetivas: BatidaEfetiva[] = [];

  for (const o of originais) {
    if (cancelamentos.some((c) => c.aplicado && mira(c, o))) continue;

    const meus = ajustes.filter((a) => mira(a, o));
    const aplicados = meus.filter((a) => a.aplicado).sort(porNsr);
    // Ajuste já reprovado não é pendente — a original simplesmente prevalece.
    const pendentes = meus
      .filter((a) => !a.aplicado && !a.motivoReprovacao)
      .sort(porNsr);

    if (aplicados.length) {
      const corr = aplicados[aplicados.length - 1];
      efetivas.push({
        ...o,
        timestampOriginal: corr.timestampOriginal,
        horarioAnterior: o.timestampOriginal,
      });
    } else if (pendentes.length) {
      efetivas.push({ ...o, ajustePendente: true });
    } else {
      efetivas.push({ ...o });
    }
  }

  for (const inc of inclusoes) {
    if (!inc.aplicado) continue;
    efetivas.push({ ...inc });
  }

  return efetivas.sort((a, b) =>
    a.timestampOriginal.localeCompare(b.timestampOriginal),
  );
}

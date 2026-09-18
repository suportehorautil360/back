/**
 * Qual manual serve qual máquina.
 *
 * Um manual pode estar preso a uma máquina específica, valer para todas de um
 * modelo, valer para todas de um tipo, ou valer para a frota inteira. Isso
 * existe porque a alternativa — subir o mesmo PDF uma vez por máquina — faz o
 * arquivo do modelo virar doze linhas para atualizar quando o fabricante
 * revisa.
 *
 * Funções puras: sem Prisma, para o teste provar a regra sem banco.
 */

export interface ManualParaCasar {
  equipmentId: string | null;
  modelo: string | null;
  tipo: string | null;
}

export interface MaquinaParaCasar {
  id: string;
  modelo: string | null;
  tipo: string | null;
}

function igual(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Quão específico é este manual para esta máquina.
 *
 * Maior = mais específico. Serve para ordenar: o manual daquela máquina vem
 * antes do manual do modelo, que vem antes do procedimento geral da frota —
 * que é a ordem em que o mecânico quer encontrar.
 *
 * `null` quando o manual não serve a esta máquina.
 */
export function especificidade(
  manual: ManualParaCasar,
  maquina: MaquinaParaCasar,
): number | null {
  if (manual.equipmentId) {
    return manual.equipmentId === maquina.id ? 3 : null;
  }
  if (manual.modelo) {
    return igual(manual.modelo, maquina.modelo) ? 2 : null;
  }
  if (manual.tipo) {
    return igual(manual.tipo, maquina.tipo) ? 1 : null;
  }
  // Sem nenhum vínculo: procedimento geral, vale para a frota inteira.
  return 0;
}

export function serveAMaquina(
  manual: ManualParaCasar,
  maquina: MaquinaParaCasar,
): boolean {
  return especificidade(manual, maquina) !== null;
}

/**
 * Os manuais desta máquina, do mais específico para o mais geral. Empate
 * desempata pelo título, para a lista não dançar entre uma abertura e outra.
 */
export function ordenarParaMaquina<T extends ManualParaCasar & { titulo: string }>(
  manuais: T[],
  maquina: MaquinaParaCasar,
): T[] {
  return manuais
    .map((m) => ({ m, peso: especificidade(m, maquina) }))
    .filter((x): x is { m: T; peso: number } => x.peso !== null)
    .sort((a, b) => b.peso - a.peso || a.m.titulo.localeCompare(b.m.titulo, 'pt-BR'))
    .map((x) => x.m);
}

/**
 * Só letras/números/ponto/hífen/underscore, e nunca `.` ou `..` sozinho —
 * `..` é feito só de caracteres que a classe permite, então tem de ser
 * recusado à parte.
 */
function segmentoValido(segmento: string): boolean {
  if (segmento === '' || segmento === '.' || segmento === '..') return false;
  return /^[A-Za-z0-9._-]+$/.test(segmento);
}

/**
 * O caminho no bucket PRIVADO `manuais` pertence à empresa da sessão?
 *
 * Checar só o PREFIXO (`storagePath.startsWith(companyId + '/')`) não basta:
 * `empresa-1/../empresa-2/a.pdf` também começa por `empresa-1/`. Provado com
 * servidor HTTP local: o `..` sobrevive ao `createSignedUrl` do Supabase e é
 * normalizado pelo `fetch` do Node ANTES de o pedido sair do processo —
 * `.../manuais/empresa-1/../../ponto-selfies/empresa-1/2026/09/x.jpg` chega
 * ao destino como `.../ponto-selfies/empresa-1/2026/09/x.jpg`. Ou seja, o
 * `..` não escapa só da EMPRESA: escapa do BUCKET INTEIRO — e a chave de
 * `ponto-selfies` (selfie da batida, dado da Portaria 671) é derivável
 * (`${companyId}/${ano}/${mes}/${pontoId}.jpg`, ver `uploadSelfiePonto` em
 * `uploads.service.ts`).
 *
 * Por isso a checagem é por SEGMENTO, não por prefixo: o primeiro segmento
 * tem de ser exatamente o `companyId` (não só começar com ele — descarta
 * `empresa-10` quando a empresa é `empresa-1`); tem de haver pelo menos mais
 * um segmento depois; e cada um dos que vêm depois casa `segmentoValido` —
 * o que recusa `..`, segmento vazio (barra dupla) e barra a mais. O `%` do
 * caminho INTEIRO é recusado à parte, antes de sequer dividir por `/`: barra
 * a forma percent-encoded do mesmo ataque (`%2e%2e`), inclusive uma barra
 * codificada que reintroduziria um nível a mais depois da divisão.
 */
export function caminhoPertenceAEmpresa(
  storagePath: string,
  companyId: string,
): boolean {
  if (storagePath.includes('%')) return false;
  const segmentos = storagePath.split('/');
  if (segmentos.length < 2) return false;
  if (segmentos[0] !== companyId) return false;
  return segmentos.slice(1).every(segmentoValido);
}

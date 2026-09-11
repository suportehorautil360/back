import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Cerca de regressão para a exposição da API.
 *
 * Em 09/09/2026 o levantamento achou 132 das 197 rotas sem guard nenhum —
 * chamáveis por qualquer um na internet. A causa não foi descuido: cada guard
 * nasceu junto com o app que ele atende, e a superfície herdada do 360 nunca
 * entrou na lista de ninguém. O padrão do sistema é abrir e lembrar de fechar.
 *
 * Enquanto o guard global (`APP_GUARD`, fase 3 da proposta) não entra, este
 * teste segura o que dá para segurar: a lista abaixo é o que estava aberto
 * naquele dia, e ela só pode DIMINUIR.
 *
 * - Controller novo sem guard → o teste falha e diz para pôr o guard.
 * - Controller da lista que ganhou guard → o teste falha e manda tirar da
 *   lista, para o número não voltar a subir sem ninguém ver.
 *
 * Não é segurança: é uma trava de catraca. A segurança é o guard.
 */

const RAIZ = join(__dirname, '..');

/** Sem guard em 09/09/2026. Só remova linhas — nunca acrescente. */
const ABERTOS_CONHECIDOS = new Set([
  'modules/Tanks/entries/fuel-entries.controller.ts',
  'modules/Tanks/tank.controller.ts',
  'modules/abonos/abonos.controller.ts',
  'modules/allocations/allocations.controller.ts',
  'modules/checklist-chegada/checklist-chegada.controller.ts',
  'modules/checklist-devolucao/checklist-devolucao.controller.ts',
  'modules/checklists-registros/checklists-registros.controller.ts',
  'modules/checklists/checklists.controller.ts',
  'modules/configuracoes/configuracoes.controller.ts',
  'modules/emergencies/emergencies.controller.ts',
  'modules/escala/escala.controller.ts',
  'modules/feature-flags/feature-flags.controller.ts',
  'modules/fleetfuel/fleetfuel.controller.ts',
  'modules/funcionarios/funcionarios.controller.ts',
  'modules/garantias/garantias.controller.ts',
  'modules/insumos/insumos.controller.ts',
  'modules/movimentacoes/consumo-custo/consumo-custo.controller.ts',
  'modules/movimentacoes/creditos/creditos.controller.ts',
  'modules/movimentacoes/historico/historico.controller.ts',
  'modules/movimentacoes/lubrificacoes/lubrificacoes.controller.ts',
  'modules/movimentacoes/movimentacoes.controller.ts',
  'modules/movimentacoes/postos/postos.controller.ts',
  'modules/movimentacoes/reabastecimento/reabastecimento.controller.ts',
  'modules/notas-fiscais/notas-fiscais.controller.ts',
  'modules/notificacoes/notificacoes.controller.ts',
  'modules/oficinas/oficinas.controller.ts',
  'modules/os/orcamentos/orcamentos.controller.ts',
  'modules/planos-preventivos/planos-preventivos.controller.ts',
  'modules/revision/revision.controller.ts',
  'modules/risk-triage/risk-triage.controller.ts',
  'modules/solicitacoes-ponto/solicitacoes-ponto.controller.ts',
  'modules/work-front/work-front.controller.ts',
]);

function controllers(dir: string, achados: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) controllers(caminho, achados);
    else if (nome.endsWith('.controller.ts')) achados.push(caminho);
  }
  return achados;
}

function semGuard(): string[] {
  return controllers(join(RAIZ, 'modules'))
    .filter((c) => !readFileSync(c, 'utf8').includes('@UseGuards'))
    .map((c) => relative(RAIZ, c).split('\\').join('/'))
    .sort();
}

describe('cobertura de guards', () => {
  it('nenhum controller NOVO nasce sem guard', () => {
    const novos = semGuard().filter((c) => !ABERTOS_CONHECIDOS.has(c));

    expect(novos).toEqual([]);
  });

  it('controller que ganhou guard sai da lista', () => {
    // Sem isto a lista vira um teto que ninguém abaixa: o número de rotas
    // abertas poderia voltar a subir sem nenhum teste reclamar.
    const abertos = new Set(semGuard());
    const jaProtegidos = [...ABERTOS_CONHECIDOS].filter((c) => !abertos.has(c));

    expect(jaProtegidos).toEqual([]);
  });

  it('as rotas órfãs trancadas na fase 1 continuam trancadas', () => {
    // Não tinham chamador nenhum e eram as de maior estrago — a de aprovar
    // orçamento carimbava valor aprovado em OS de qualquer empresa.
    const abertos = new Set(semGuard());

    for (const critica of [
      'modules/os/solicitacoes/solicitacoes.controller.ts',
      'modules/financeiro/financeiro.controller.ts',
      'modules/cargos-permissao/cargos-permissao.controller.ts',
      'modules/parceiros/parceiros.controller.ts',
      'modules/clientes/clientes.controller.ts',
    ]) {
      expect(abertos.has(critica)).toBe(false);
    }
  });
});

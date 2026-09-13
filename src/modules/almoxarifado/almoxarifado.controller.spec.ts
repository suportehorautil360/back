import { INTERCEPTORS_METADATA } from '@nestjs/common/constants';
import { MODULO_COMERCIAL_KEY } from '../../common/modulo-comercial.decorator';
import { IdempotencyInterceptor } from '../../common/idempotency.interceptor';
import { AlmoxarifadoController } from './almoxarifado.controller';

/**
 * O gate de cada rota é a metadata que o `PainelGuard` lê — primeiro a da
 * rota, depois a da classe (`painel.guard.ts`, e `painel.guard.spec.ts` prova
 * essa precedência). Aqui se prova QUAL metadata cada rota carrega.
 */
describe('AlmoxarifadoController — gate por rota', () => {
  it('reservar exige o grupo de quem ABRE a OS (manutencao), não o do almoxarife', () => {
    // Fundação da F4: com o gate da classe, todo programador sem o grupo
    // `almoxarifado` levava 403 na reserva — a OS nascia em análise, sem falta
    // detectada e sem solicitação de compra.
    expect(Reflect.getMetadata(MODULO_COMERCIAL_KEY, AlmoxarifadoController.prototype.reservar))
      .toEqual({ featureKey: 'suprimentos', accessGroupKey: 'manutencao' });
  });

  it('as demais rotas de escrita continuam no gate da classe (almoxarifado)', () => {
    expect(Reflect.getMetadata(MODULO_COMERCIAL_KEY, AlmoxarifadoController))
      .toEqual({ featureKey: 'suprimentos', accessGroupKey: 'almoxarifado' });
    for (const rota of [
      'entrada', 'separar', 'liberar', 'entregar', 'cancelar',
      // F4: quem recebe do fornecedor e quem confere o estoque mínimo é o
      // almoxarife — o gate da classe basta.
      'receber', 'recebimentosPendentes', 'verificarEstoqueMinimo',
    ] as const) {
      expect(Reflect.getMetadata(MODULO_COMERCIAL_KEY, AlmoxarifadoController.prototype[rota]))
        .toBeUndefined();
    }
  });

  it('peça adicional é do grupo mecanica — quem pede é a bancada, não o almoxarife', () => {
    for (const rota of ['pedirPecaAdicional', 'pecasAdicionais'] as const) {
      expect(Reflect.getMetadata(MODULO_COMERCIAL_KEY, AlmoxarifadoController.prototype[rota]))
        .toEqual({ featureKey: 'suprimentos', accessGroupKey: 'mecanica' });
    }
  });

  it('toda rota que escreve saldo carrega a chave de idempotência; a verificação de mínimo não precisa', () => {
    const temInterceptor = (rota: keyof AlmoxarifadoController) =>
      ((Reflect.getMetadata(INTERCEPTORS_METADATA, AlmoxarifadoController.prototype[rota]) ?? []) as unknown[])
        .some((i) => i === IdempotencyInterceptor);
    for (const rota of ['reservar', 'entrada', 'separar', 'liberar', 'entregar', 'cancelar', 'receber', 'pedirPecaAdicional'] as const) {
      expect(temInterceptor(rota)).toBe(true);
    }
    // Idempotente por construção: o índice único parcial deixa existir no
    // máximo uma reposição automática aberta por peça e depósito.
    expect(temInterceptor('verificarEstoqueMinimo')).toBe(false);
  });
});

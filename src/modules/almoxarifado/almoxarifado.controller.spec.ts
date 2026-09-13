import { MODULO_COMERCIAL_KEY } from '../../common/modulo-comercial.decorator';
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
    for (const rota of ['entrada', 'separar', 'liberar', 'entregar', 'cancelar'] as const) {
      expect(Reflect.getMetadata(MODULO_COMERCIAL_KEY, AlmoxarifadoController.prototype[rota]))
        .toBeUndefined();
    }
  });
});

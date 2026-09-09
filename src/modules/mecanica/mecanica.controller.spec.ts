import { BadRequestException } from '@nestjs/common';
import { MecanicaController } from './mecanica.controller';
import type { PainelPayload, RequestComPainel } from '../../common/painel.guard';
import type { MecanicaService } from './mecanica.service';

const PAINEL: PainelPayload = {
  companyUserId: 'user-1',
  companyId: 'empresa-1',
  operatorId: 'op-1',
  companyRoleId: 'cargo-1',
  nomeExibicao: 'Carlos Mecânico',
};

function reqCom(painel: PainelPayload = PAINEL): RequestComPainel {
  return { painel } as RequestComPainel;
}

function servicoFalso() {
  return { listarBancada: jest.fn().mockResolvedValue([]) } as unknown as MecanicaService;
}

/**
 * Achado C2 da revisão final: o controller só lia `?minhas` — `?situacao`
 * chegava e era descartado em silêncio, e o painel (que chama
 * `/mecanica/os?situacao=Concluida` para o Histórico) recebia a mesma lista
 * da Bancada. Estes testes exercitam o CONTROLLER, não só o service: uma
 * regressão que voltasse a ignorar `?situacao` no controller não derrubaria
 * teste nenhum se a prova ficasse só no service.
 */
describe('MecanicaController.bancada — repasse de ?situacao', () => {
  it('repassa a situacao pedida para o service', async () => {
    const service = servicoFalso();
    const controller = new MecanicaController(service);

    await controller.bancada(reqCom(), undefined, 'Concluida');

    expect(service.listarBancada).toHaveBeenCalledWith(PAINEL, false, 'Concluida');
  });

  it('sem `?situacao`, repassa undefined — a Bancada continua trazendo tudo', async () => {
    const service = servicoFalso();
    const controller = new MecanicaController(service);

    await controller.bancada(reqCom());

    expect(service.listarBancada).toHaveBeenCalledWith(PAINEL, false, undefined);
  });

  it('rejeita situacao fora da lista — nem filtro silencioso, nem 500', async () => {
    const service = servicoFalso();
    const controller = new MecanicaController(service);

    await expect(
      controller.bancada(reqCom(), undefined, 'lixo'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.listarBancada).not.toHaveBeenCalled();
  });

  it('aceita as três situações válidas', async () => {
    const service = servicoFalso();
    const controller = new MecanicaController(service);

    for (const situacao of ['Aberta', 'EmAndamento', 'Concluida']) {
      await controller.bancada(reqCom(), undefined, situacao);
    }

    expect(service.listarBancada).toHaveBeenCalledTimes(3);
  });
});

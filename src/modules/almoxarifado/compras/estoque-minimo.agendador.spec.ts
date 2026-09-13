import { Logger } from '@nestjs/common';
import { EstoqueMinimoAgendador } from './estoque-minimo.agendador';
import { varrerEstoqueMinimo } from './estoque-minimo';

jest.mock('./estoque-minimo', () => ({ varrerEstoqueMinimo: jest.fn() }));

const varrer = varrerEstoqueMinimo as jest.MockedFunction<typeof varrerEstoqueMinimo>;

describe('EstoqueMinimoAgendador', () => {
  let logado: jest.SpyInstance;
  let erroLogado: jest.SpyInstance;
  beforeEach(() => {
    varrer.mockReset();
    logado = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    erroLogado = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    logado.mockRestore();
    erroLogado.mockRestore();
  });

  it('roda todo dia às 7h no fuso de Brasília', () => {
    // A chave é a que `@Cron` grava (`SCHEDULE_CRON_OPTIONS` de @nestjs/schedule).
    const opcoes = Reflect.getMetadata('SCHEDULE_CRON_OPTIONS', EstoqueMinimoAgendador.prototype.varrerDiariamente);
    expect(opcoes).toEqual(expect.objectContaining({ cronTime: '0 7 * * *', timeZone: 'America/Sao_Paulo' }));
  });

  it('varre com o Prisma injetado e registra o resumo', async () => {
    const prisma = { marca: 'prisma-injetado' };
    varrer.mockResolvedValue({ empresas: 2, verificados: 5, criadas: 1, falhas: 1 });

    await new EstoqueMinimoAgendador(prisma as never).varrerDiariamente();

    expect(varrer).toHaveBeenCalledWith(prisma);
    expect(logado).toHaveBeenCalledWith(
      'Estoque mínimo: 2 empresa(s), 5 peça(s) por depósito verificada(s), 1 solicitação(ões) criada(s), 1 falha(s).',
    );
  });

  it('falha da varredura vira log e não lança', async () => {
    varrer.mockRejectedValue(new Error('banco fora'));

    await expect(new EstoqueMinimoAgendador({} as never).varrerDiariamente()).resolves.toBeUndefined();

    expect(erroLogado).toHaveBeenCalledWith('Falha na varredura diária de estoque mínimo', expect.stringContaining('banco fora'));
  });
});

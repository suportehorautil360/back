/**
 * O que o operador relatou, trazido para a OS do mecânico.
 *
 * O mecânico pegava a ordem sabendo só o "defeito relatado" que alguém digitou
 * ao abri-la. Quem estava na máquina já tinha marcado item por item no
 * checklist dele, com o problema escrito — e esse texto se perdia entre uma
 * tela e outra.
 */
import { NotFoundException } from '@nestjs/common';

import { MecanicaService } from './mecanica.service';

const PAINEL = { companyId: 'c-1', operatorId: 'op-1' } as never;

function servico(opcoes: {
  os?: Record<string, unknown> | null;
  runs?: Record<string, unknown>[];
} = {}) {
  const findFirstOs = jest.fn(() =>
    Promise.resolve(
      opcoes.os === undefined
        ? { equipment: { chassi: 'S0R3CXTTET3635101' } }
        : opcoes.os,
    ),
  );
  const findManyRun = jest.fn(() => Promise.resolve(opcoes.runs ?? []));

  const prisma = {
    serviceOrder: { findFirst: findFirstOs },
    checklistRun: { findMany: findManyRun },
  };

  return {
    servico: new MecanicaService(prisma as never, {} as never),
    findFirstOs,
    findManyRun,
  };
}

describe('MecanicaService.relatosDoOperador', () => {
  it('recorta a empresa e a execução interna ao achar a OS', async () => {
    const { servico: s, findFirstOs } = servico();

    await s.relatosDoOperador(PAINEL, 'os-1');

    expect(findFirstOs.mock.calls[0][0].where).toEqual({
      id: 'os-1',
      companyId: 'c-1',
      execucao: 'interna',
    });
  });

  /**
   * `ChecklistRun` guarda um SNAPSHOT do equipamento (chassi, modelo, linha)
   * para tolerar mudança e remoção no cadastro depois — não há `equipmentId`
   * para casar.
   */
  it('casa pelo chassi da máquina, do mais recente para o mais antigo', async () => {
    const { servico: s, findManyRun } = servico();

    await s.relatosDoOperador(PAINEL, 'os-1');

    const arg = findManyRun.mock.calls[0][0];
    expect(arg.where).toEqual({
      companyId: 'c-1',
      chassi: 'S0R3CXTTET3635101',
    });
    expect(arg.orderBy).toEqual({ executedAt: 'desc' });
  });

  // Três, e não um: o mecânico reconhece um problema que se repete, e isso
  // muda o que ele vai procurar na máquina.
  it('traz os três mais recentes', async () => {
    const { servico: s, findManyRun } = servico();
    await s.relatosDoOperador(PAINEL, 'os-1');
    expect(findManyRun.mock.calls[0][0].take).toBe(3);
  });

  /**
   * As respostas inteiras trazem sessenta linhas de "conforme" e enterrariam
   * as três que importam. E `respostas`, `fotoHorimetro` e
   * `assinaturaOperador` são campos grandes (base64) que não têm por que
   * atravessar a rede até um aparelho no galpão.
   */
  it('seleciona só os itens reprovados, sem os campos pesados', async () => {
    const { servico: s, findManyRun } = servico();
    await s.relatosDoOperador(PAINEL, 'os-1');

    const select = findManyRun.mock.calls[0][0].select;
    expect(select.itensNao).toBe(true);
    expect(select.obs).toBe(true);
    expect(select.respostas).toBeUndefined();
    expect(select.fotoHorimetro).toBeUndefined();
    expect(select.assinaturaOperador).toBeUndefined();
  });

  // Casar por chassi vazio pegaria o checklist de qualquer outra máquina sem
  // chassi cadastrado — que é o pior resultado possível aqui.
  it('máquina sem chassi devolve vazio, sem consultar', async () => {
    const { servico: s, findManyRun } = servico({
      os: { equipment: { chassi: '   ' } },
    });

    expect(await s.relatosDoOperador(PAINEL, 'os-1')).toEqual([]);
    expect(findManyRun).not.toHaveBeenCalled();
  });

  it('OS sem equipamento vinculado devolve vazio', async () => {
    const { servico: s, findManyRun } = servico({ os: { equipment: null } });

    expect(await s.relatosDoOperador(PAINEL, 'os-1')).toEqual([]);
    expect(findManyRun).not.toHaveBeenCalled();
  });

  it('OS de outra empresa não é encontrada', async () => {
    const { servico: s } = servico({ os: null });

    await expect(s.relatosDoOperador(PAINEL, 'os-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

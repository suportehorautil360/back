import { ConflictException } from '@nestjs/common';
import { AlmoxarifadoService } from './almoxarifado.service';

const COMPANY = '11111111-1111-1111-1111-111111111111';
const REQ = '33333333-3333-3333-3333-333333333333';
const AUTOR = '44444444-4444-4444-4444-444444444444';

function montar(status: string, itens: unknown[]) {
  const chamadas: string[] = [];
  const tx = {
    $queryRaw: jest.fn(async () => { chamadas.push('LOCK'); return [{ saldo_reservado: '4', saldo_separado: '4' }]; }),
    $executeRaw: jest.fn(async (sql: { text?: string }) => {
      chamadas.push('UPDATE saldo');
      return 1;
    }),
    requisicaoMaterial: {
      findFirst: jest.fn().mockResolvedValue({
        id: REQ, companyId: COMPANY, status, serviceOrderId: 'os-1', depositoId: 'dep-1', itens,
      }),
      update: jest.fn(async () => { chamadas.push('UPDATE requisicao'); return {}; }),
    },
    requisicaoMaterialItem: {
      updateMany: jest.fn(async () => { chamadas.push('UPDATE itens'); return { count: 1 }; }),
      // Retrato "sem divergência": bate com `reservado()` abaixo. O teste de
      // discriminação sobrescreve isto por instância, quando quer provar que
      // a releitura importa.
      findUniqueOrThrow: jest.fn().mockResolvedValue({ quantidadeReservada: 4, quantidadeSeparada: 0 }),
    },
    serviceOrder: { updateMany: jest.fn(async () => ({ count: 1 })) },
  };
  const prisma = { $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) };
  return { servico: new AlmoxarifadoService(prisma as never), prisma, tx, chamadas };
}

const reservado = () => ({
  id: 'it-1', pecaId: 'p-1', quantidadeReservada: 4, quantidadeSeparada: 0,
  status: 'reservada', impeditivo: true,
});

describe('cancelarRequisicao', () => {
  it('devolve o reservado ao disponível', async () => {
    // É a razão de esta operação existir: sem ela, OS abandonada tranca peça.
    const { servico, chamadas } = montar('pendente', [reservado()]);
    await servico.cancelarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR,
      motivo: 'OS aberta por engano',
    });
    expect(chamadas[0]).toBe('LOCK');
    expect(chamadas).toContain('UPDATE saldo');
  });

  it('exige motivo — o CHECK do banco recusaria de qualquer forma', async () => {
    const { servico } = montar('pendente', [reservado()]);
    await expect(servico.cancelarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR, motivo: '   ',
    })).rejects.toThrow(/motivo/i);
  });

  it('requisição já entregue não é cancelada', async () => {
    // A peça já saiu do estoque; desfazer isso é devolução, e devolução é F5.
    const { servico } = montar('entregue', [reservado()]);
    await expect(servico.cancelarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR, motivo: 'x',
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it('devolve a quantidade RELIDA na transação, não a do retrato', async () => {
    // Semeia o banco falso divergindo do que o `findFirst` devolveu: uma
    // conferência concorrente separou 3 depois da leitura de fora. Devolver a
    // quantidade obsoleta criaria saldo que não existe na prateleira.
    const { servico, tx } = montar('pendente', [reservado()]);
    tx.requisicaoMaterialItem.findUniqueOrThrow = jest.fn().mockResolvedValue({
      quantidadeReservada: 4, quantidadeSeparada: 3,
    });

    await servico.cancelarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR, motivo: 'engano',
    });

    // O retrato dizia separada: 0; o banco diz 3. O UPDATE tem de citar 3.
    const sql = tx.$executeRaw.mock.calls[0][0];
    expect(sql.text).toMatch(/saldo_separado\s*=\s*saldo_separado\s*-/);
    expect(sql.values).toContain(3);
  });

  it('a OS volta a planejada — sem materiais, sem promessa', async () => {
    const { servico, tx } = montar('pendente', [reservado()]);
    await servico.cancelarRequisicao({
      companyId: COMPANY, requisicaoId: REQ, autorCompanyUserId: AUTOR, motivo: 'engano',
    });
    expect(tx.serviceOrder.updateMany.mock.calls[0][0].data.statusMateriais).toBe('planejada');
  });
});

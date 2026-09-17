import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CancelarTransferenciaDto, CriarTransferenciaDto, ReceberTransferenciaDto } from './transferencia.dto';

// `IsUUID()` exige o nibble de variante RFC4122 (4º grupo começando em
// 8/9/a/b) — "111...1" não é um UUID válido de verdade, só parece um.
const ORIGEM = '11111111-1111-4111-8111-111111111111';
const DESTINO = '22222222-2222-4222-8222-222222222222';
const PECA = '33333333-3333-4333-8333-333333333333';
const ITEM = '44444444-4444-4444-8444-444444444444';

describe('CriarTransferenciaDto', () => {
  it('aceita o corpo mínimo válido (sem observacao)', async () => {
    const dto = plainToInstance(CriarTransferenciaDto, {
      depositoOrigemId: ORIGEM,
      depositoDestinoId: DESTINO,
      itens: [{ pecaId: PECA, quantidade: 5 }],
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('aceita observacao quando presente', async () => {
    const dto = plainToInstance(CriarTransferenciaDto, {
      depositoOrigemId: ORIGEM,
      depositoDestinoId: DESTINO,
      itens: [{ pecaId: PECA, quantidade: 1.5 }],
      observacao: 'Reforço para a filial',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('REJEITA depositoOrigemId ou depositoDestinoId que não são UUID', async () => {
    const dto = plainToInstance(CriarTransferenciaDto, {
      depositoOrigemId: 'nao-e-uuid',
      depositoDestinoId: 'também-não',
      itens: [{ pecaId: PECA, quantidade: 1 }],
    });
    const erros = await validate(dto);
    const campos = erros.map((e) => e.property);
    expect(campos).toEqual(expect.arrayContaining(['depositoOrigemId', 'depositoDestinoId']));
  });

  // O DTO não confere origem !== destino — essa checagem é do ATO
  // (`criarTransferencia`, achado de domínio), não de forma. Não fabricar
  // aqui uma segunda regra que pudesse um dia divergir da do serviço.

  it('REJEITA lista de itens vazia', async () => {
    const dto = plainToInstance(CriarTransferenciaDto, {
      depositoOrigemId: ORIGEM, depositoDestinoId: DESTINO, itens: [],
    });
    const erros = await validate(dto);
    expect(erros.some((e) => e.property === 'itens')).toBe(true);
  });

  it('REJEITA mais de 200 itens — teto de sanidade do payload', async () => {
    const itens = Array.from({ length: 201 }, () => ({ pecaId: PECA, quantidade: 1 }));
    const dto = plainToInstance(CriarTransferenciaDto, {
      depositoOrigemId: ORIGEM, depositoDestinoId: DESTINO, itens,
    });
    const erros = await validate(dto);
    expect(erros.some((e) => e.property === 'itens')).toBe(true);
  });

  it('aceita exatamente 200 itens', async () => {
    const itens = Array.from({ length: 200 }, () => ({ pecaId: PECA, quantidade: 1 }));
    const dto = plainToInstance(CriarTransferenciaDto, {
      depositoOrigemId: ORIGEM, depositoDestinoId: DESTINO, itens,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('REJEITA quantidade zero, negativa ou NaN num item', async () => {
    for (const quantidade of [0, -1, NaN]) {
      const dto = plainToInstance(CriarTransferenciaDto, {
        depositoOrigemId: ORIGEM, depositoDestinoId: DESTINO,
        itens: [{ pecaId: PECA, quantidade }],
      });
      const erros = await validate(dto);
      // `ValidateNested` aninha o erro do item dentro de `itens[0]` —
      // confere que ele existe em algum nível, não só na raiz.
      const temErroDeQuantidade = JSON.stringify(erros).includes('quantidade');
      expect(temErroDeQuantidade).toBe(true);
    }
  });

  it('REJEITA quantidade com mais de 3 casas decimais num item', async () => {
    const dto = plainToInstance(CriarTransferenciaDto, {
      depositoOrigemId: ORIGEM, depositoDestinoId: DESTINO,
      itens: [{ pecaId: PECA, quantidade: 1.2345 }],
    });
    const erros = await validate(dto);
    expect(JSON.stringify(erros)).toContain('quantidade');
  });

  it('REJEITA quantidade acima do teto da coluna (NUMERIC(12,3)) — sem isto o ato estoura P2020 cru (500), não 400', async () => {
    const dto = plainToInstance(CriarTransferenciaDto, {
      depositoOrigemId: ORIGEM, depositoDestinoId: DESTINO,
      itens: [{ pecaId: PECA, quantidade: 1e9 }],
    });
    const erros = await validate(dto);
    expect(JSON.stringify(erros)).toContain('quantidade');
  });

  it('aceita quantidade exatamente no teto da coluna', async () => {
    const dto = plainToInstance(CriarTransferenciaDto, {
      depositoOrigemId: ORIGEM, depositoDestinoId: DESTINO,
      itens: [{ pecaId: PECA, quantidade: 999_999_999.999 }],
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('REJEITA pecaId de item que não é UUID', async () => {
    const dto = plainToInstance(CriarTransferenciaDto, {
      depositoOrigemId: ORIGEM, depositoDestinoId: DESTINO,
      itens: [{ pecaId: 'nao-e-uuid', quantidade: 1 }],
    });
    const erros = await validate(dto);
    expect(JSON.stringify(erros)).toContain('pecaId');
  });

  it('REJEITA observacao maior que 500 caracteres', async () => {
    const dto = plainToInstance(CriarTransferenciaDto, {
      depositoOrigemId: ORIGEM, depositoDestinoId: DESTINO,
      itens: [{ pecaId: PECA, quantidade: 1 }],
      observacao: 'x'.repeat(501),
    });
    const erros = await validate(dto);
    expect(erros.some((e) => e.property === 'observacao')).toBe(true);
  });
});

describe('ReceberTransferenciaDto', () => {
  it('aceita quantidadeRecebida zero — resultado possível (carga perdida)', async () => {
    const dto = plainToInstance(ReceberTransferenciaDto, {
      itens: [{ itemId: ITEM, quantidadeRecebida: 0 }],
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('aceita motivoDivergencia quando presente', async () => {
    const dto = plainToInstance(ReceberTransferenciaDto, {
      itens: [{ itemId: ITEM, quantidadeRecebida: 2, motivoDivergencia: 'Avaria no transporte' }],
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('REJEITA lista de itens vazia', async () => {
    const dto = plainToInstance(ReceberTransferenciaDto, { itens: [] });
    const erros = await validate(dto);
    expect(erros.some((e) => e.property === 'itens')).toBe(true);
  });

  it('REJEITA quantidadeRecebida negativa', async () => {
    const dto = plainToInstance(ReceberTransferenciaDto, {
      itens: [{ itemId: ITEM, quantidadeRecebida: -1 }],
    });
    const erros = await validate(dto);
    expect(JSON.stringify(erros)).toContain('quantidadeRecebida');
  });

  it('REJEITA itemId que não é UUID', async () => {
    const dto = plainToInstance(ReceberTransferenciaDto, {
      itens: [{ itemId: 'nao-e-uuid', quantidadeRecebida: 1 }],
    });
    const erros = await validate(dto);
    expect(JSON.stringify(erros)).toContain('itemId');
  });

  it('REJEITA quantidadeRecebida acima do teto da coluna (NUMERIC(12,3)) — sem isto o ato estoura P2020 cru (500), não 400', async () => {
    const dto = plainToInstance(ReceberTransferenciaDto, {
      itens: [{ itemId: ITEM, quantidadeRecebida: 1e9 }],
    });
    const erros = await validate(dto);
    expect(JSON.stringify(erros)).toContain('quantidadeRecebida');
  });

  it('aceita quantidadeRecebida exatamente no teto da coluna', async () => {
    const dto = plainToInstance(ReceberTransferenciaDto, {
      itens: [{ itemId: ITEM, quantidadeRecebida: 999_999_999.999 }],
    });
    expect(await validate(dto)).toHaveLength(0);
  });
});

describe('CancelarTransferenciaDto', () => {
  it('aceita motivo não vazio', async () => {
    const dto = plainToInstance(CancelarTransferenciaDto, { motivo: 'Pedido duplicado' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('REJEITA motivo vazio — há CHECK no banco', async () => {
    const dto = plainToInstance(CancelarTransferenciaDto, { motivo: '' });
    const erros = await validate(dto);
    expect(erros.some((e) => e.property === 'motivo')).toBe(true);
  });

  it('REJEITA motivo ausente', async () => {
    const dto = plainToInstance(CancelarTransferenciaDto, {});
    const erros = await validate(dto);
    expect(erros.some((e) => e.property === 'motivo')).toBe(true);
  });

  it('REJEITA motivo maior que 500 caracteres', async () => {
    const dto = plainToInstance(CancelarTransferenciaDto, { motivo: 'x'.repeat(501) });
    const erros = await validate(dto);
    expect(erros.some((e) => e.property === 'motivo')).toBe(true);
  });
});

import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { EntradaDto } from './entrada.dto';

// `IsUUID()` exige o nibble de variante RFC4122 (4º grupo começando em
// 8/9/a/b) — "111...1" não é um UUID válido de verdade, só parece um.
const PECA = '11111111-1111-4111-8111-111111111111';
const DEPOSITO = '22222222-2222-4222-8222-222222222222';

describe('EntradaDto', () => {
  it('aceita o corpo mínimo válido (sem custoUnit nem observacao)', async () => {
    const dto = plainToInstance(EntradaDto, {
      pecaId: PECA, depositoId: DEPOSITO, quantidade: 5,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('aceita custoUnit e observacao quando presentes', async () => {
    const dto = plainToInstance(EntradaDto, {
      pecaId: PECA, depositoId: DEPOSITO, quantidade: 12.5,
      custoUnit: 3.1234, observacao: 'Compra NF 4500',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('REJEITA pecaId ou depositoId que não são UUID', async () => {
    const dto = plainToInstance(EntradaDto, {
      pecaId: 'nao-e-uuid', depositoId: 'também-não', quantidade: 5,
    });
    const erros = await validate(dto);
    const campos = erros.map((e) => e.property);
    expect(campos).toEqual(expect.arrayContaining(['pecaId', 'depositoId']));
  });

  it('REJEITA quantidade zero, negativa ou NaN', async () => {
    // É exatamente o buraco que motivou os decorators: o guard manual do
    // serviço (`quantidade <= 0`) não pega `NaN`, porque toda comparação
    // com `NaN` é falsa — só a validação do DTO barra isso antes de somar
    // ao saldo físico.
    for (const quantidade of [0, -1, NaN]) {
      const dto = plainToInstance(EntradaDto, {
        pecaId: PECA, depositoId: DEPOSITO, quantidade,
      });
      const erros = await validate(dto);
      expect(erros.some((e) => e.property === 'quantidade')).toBe(true);
    }
  });

  it('REJEITA quantidade com mais de 3 casas decimais (saldo_fisico é Decimal(12,3))', async () => {
    const dto = plainToInstance(EntradaDto, {
      pecaId: PECA, depositoId: DEPOSITO, quantidade: 1.2345,
    });
    const erros = await validate(dto);
    expect(erros.some((e) => e.property === 'quantidade')).toBe(true);
  });

  it('REJEITA custoUnit negativo ou com mais de 4 casas decimais (custo_unit é Decimal(12,4))', async () => {
    const negativo = plainToInstance(EntradaDto, {
      pecaId: PECA, depositoId: DEPOSITO, quantidade: 1, custoUnit: -0.01,
    });
    expect((await validate(negativo)).some((e) => e.property === 'custoUnit')).toBe(true);

    const precisaoDemais = plainToInstance(EntradaDto, {
      pecaId: PECA, depositoId: DEPOSITO, quantidade: 1, custoUnit: 1.23456,
    });
    expect((await validate(precisaoDemais)).some((e) => e.property === 'custoUnit')).toBe(true);
  });

  it('REJEITA quantidade em string', async () => {
    const dto = plainToInstance(EntradaDto, {
      pecaId: PECA, depositoId: DEPOSITO, quantidade: '5' as unknown as number,
    });
    expect((await validate(dto)).some((e) => e.property === 'quantidade')).toBe(true);
  });
});

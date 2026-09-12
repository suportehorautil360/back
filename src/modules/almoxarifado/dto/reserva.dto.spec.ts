import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ReservarDto } from './reserva.dto';

// `IsUUID()` exige o nibble de variante RFC4122 (4º grupo começando em
// 8/9/a/b) — "222...2" não é um UUID válido de verdade, só parece um.
const DEPOSITO = '22222222-2222-4222-8222-222222222222';

describe('ReservarDto', () => {
  it('aceita categoriaPlanoId/cicloId no formato real do plano (não são UUID)', async () => {
    // "cat-1"/"c1" são os ids que o import do PDF gera dentro do Json de
    // `PlanoPreventivo.categorias` — exigir UUID aqui rejeitaria toda
    // reserva de verdade.
    const dto = plainToInstance(ReservarDto, {
      depositoId: DEPOSITO, categoriaPlanoId: 'cat-1', cicloId: 'c1',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('REJEITA depositoId que não é UUID', async () => {
    const dto = plainToInstance(ReservarDto, {
      depositoId: 'nao-e-uuid', categoriaPlanoId: 'cat-1', cicloId: 'c1',
    });
    const erros = await validate(dto);
    expect(erros.some((e) => e.property === 'depositoId')).toBe(true);
  });

  it('REJEITA categoriaPlanoId ou cicloId vazios', async () => {
    const dto = plainToInstance(ReservarDto, {
      depositoId: DEPOSITO, categoriaPlanoId: '', cicloId: '',
    });
    const erros = await validate(dto);
    const campos = erros.map((e) => e.property);
    expect(campos).toEqual(expect.arrayContaining(['categoriaPlanoId', 'cicloId']));
  });
});

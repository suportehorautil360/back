import { NotFoundException } from '@nestjs/common';
import {
  resolveEquipmentByPlateOrChassis,
  resolveEquipmentIdByPlateOrChassis,
} from './equipment.helper';

type Row = Record<string, unknown>;

/** Query fake: `.where().get()` devolve os rows da "empresa". */
function fakeQuery(rows: Row[]): never {
  const snap = { docs: rows.map((r) => ({ id: '', data: () => r })) };
  return {
    where: () => ({ get: () => Promise.resolve(snap) }),
  } as never;
}

describe('resolveEquipmentIdByPlateOrChassis', () => {
  it('retorna o id quando o equipamento está na empresa', async () => {
    const q = fakeQuery([{ id: 'eq-1', placa: 'ABC-1234' }]);
    await expect(
      resolveEquipmentIdByPlateOrChassis(q, 'pref-1', 'ABC-1234'),
    ).resolves.toBe('eq-1');
  });

  it('não encontrado → NotFound genérico, sem vazar a prefeitura', async () => {
    const q = fakeQuery([{ id: 'eq-1', placa: 'XYZ-0000' }]);
    await expect(
      resolveEquipmentIdByPlateOrChassis(q, 'pref-1', 'ABC-1234'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      resolveEquipmentIdByPlateOrChassis(q, 'pref-1', 'ABC-1234'),
    ).rejects.toThrow(/não encontrado/i);
    await expect(
      resolveEquipmentIdByPlateOrChassis(q, 'pref-1', 'ABC-1234'),
    ).rejects.not.toThrow(/Prefeitura do equipamento/);
  });
});

describe('resolveEquipmentByPlateOrChassis (id + capacidade)', () => {
  it('devolve a capacidade do tanque do equipamento', async () => {
    const q = fakeQuery([
      { id: 'eq-1', placa: 'ABC-1234', capacidadeTanque: 300 },
    ]);
    await expect(
      resolveEquipmentByPlateOrChassis(q, 'pref-1', 'ABC-1234'),
    ).resolves.toMatchObject({ id: 'eq-1', capacidadeTanque: 300 });
  });

  it('capacidade ausente/inválida → 0 (sem limite)', async () => {
    const q = fakeQuery([{ id: 'eq-1', placa: 'ABC-1234' }]);
    const r = await resolveEquipmentByPlateOrChassis(q, 'pref-1', 'ABC-1234');
    expect(r.capacidadeTanque).toBe(0);
  });
});

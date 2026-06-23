import { BadRequestException } from '@nestjs/common';
import {
  creditarTanque,
  creditarTanqueTx,
  debitarTanqueTx,
  ensureTankForComboio,
  tankStatus,
} from './tank-saldo.helper';

type AnyObj = Record<string, any>;

/** Firestore mínimo cujo `collection().doc()` devolve sempre o `doc` informado. */
function firestoreComDoc(doc: AnyObj): AnyObj {
  return { collection: jest.fn(() => ({ doc: jest.fn(() => doc) })) };
}

describe('tank-saldo.helper', () => {
  describe('tankStatus', () => {
    it('Critic quando <= 20%', () => {
      expect(tankStatus(100, 20).status).toBe('Critic');
    });
    it('Moderate quando <= 60%', () => {
      expect(tankStatus(100, 60).status).toBe('Moderate');
    });
    it('Normal quando > 60%', () => {
      expect(tankStatus(100, 61).status).toBe('Normal');
    });
    it('capacidade zero => 0% e Critic', () => {
      const r = tankStatus(0, 0);
      expect(r.percentage).toBe(0);
      expect(r.status).toBe('Critic');
    });
  });

  describe('creditarTanque', () => {
    it('soma via set merge no doc do comboio', async () => {
      const doc = { set: jest.fn().mockResolvedValue(undefined) };
      await creditarTanque(firestoreComDoc(doc) as never, 'comb-1', 50);
      expect(doc.set).toHaveBeenCalledTimes(1);
      const [payload, opts] = doc.set.mock.calls[0] as [
        Record<string, unknown>,
        unknown,
      ];
      expect(payload.comboioId).toBe('comb-1');
      expect(payload.currentVolume).toBeDefined();
      expect(opts).toEqual({ merge: true });
    });
    it('ignora litros <= 0', async () => {
      const doc = { set: jest.fn() };
      await creditarTanque(firestoreComDoc(doc) as never, 'comb-1', 0);
      expect(doc.set).not.toHaveBeenCalled();
    });
    it('ignora sem comboioId', async () => {
      const doc = { set: jest.fn() };
      await creditarTanque(firestoreComDoc(doc) as never, '', 10);
      expect(doc.set).not.toHaveBeenCalled();
    });
  });

  describe('debitarTanqueTx (travar negativo)', () => {
    function cenario(saldo: number | null) {
      const ref = { id: 'comb-1' };
      const snap =
        saldo === null
          ? { exists: false, data: () => undefined }
          : { exists: true, data: () => ({ currentVolume: saldo }) };
      const tx = { get: jest.fn().mockResolvedValue(snap), update: jest.fn() };
      return { tx, firestore: firestoreComDoc(ref) };
    }

    it('rejeita sem comboioId', async () => {
      const { tx, firestore } = cenario(100);
      await expect(
        debitarTanqueTx(tx as never, firestore as never, '', 10),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejeita quando o tanque não existe', async () => {
      const { tx, firestore } = cenario(null);
      await expect(
        debitarTanqueTx(tx as never, firestore as never, 'comb-1', 10),
      ).rejects.toThrow(/não encontrado/i);
    });

    it('rejeita saldo insuficiente (não deixa negativo)', async () => {
      const { tx, firestore } = cenario(5);
      await expect(
        debitarTanqueTx(tx as never, firestore as never, 'comb-1', 10),
      ).rejects.toThrow(/insuficiente/i);
      expect(tx.update).not.toHaveBeenCalled();
    });

    it('decrementa quando há saldo', async () => {
      const { tx, firestore } = cenario(100);
      await debitarTanqueTx(tx as never, firestore as never, 'comb-1', 30);
      expect(tx.update).toHaveBeenCalledTimes(1);
    });

    it('permite zerar exatamente (saldo == litros)', async () => {
      const { tx, firestore } = cenario(10);
      await debitarTanqueTx(tx as never, firestore as never, 'comb-1', 10);
      expect(tx.update).toHaveBeenCalledTimes(1);
    });

    it('ignora litros <= 0 (não lê nem escreve)', async () => {
      const { tx, firestore } = cenario(100);
      await debitarTanqueTx(tx as never, firestore as never, 'comb-1', 0);
      expect(tx.get).not.toHaveBeenCalled();
      expect(tx.update).not.toHaveBeenCalled();
    });
  });

  describe('creditarTanqueTx (travar capacidade)', () => {
    function cenario(opts: {
      currentVolume?: number;
      capacity?: number;
      existe?: boolean;
    }) {
      const { currentVolume, capacity, existe = true } = opts;
      const ref = { id: 'comb-1' };
      const snap = existe
        ? { exists: true, data: () => ({ currentVolume, capacity }) }
        : { exists: false, data: () => undefined };
      const tx = {
        get: jest.fn().mockResolvedValue(snap),
        update: jest.fn(),
        set: jest.fn(),
      };
      return { tx, firestore: firestoreComDoc(ref) };
    }

    it('rejeita sem comboioId', async () => {
      const { tx, firestore } = cenario({ currentVolume: 0, capacity: 100 });
      await expect(
        creditarTanqueTx(tx as never, firestore as never, '', 10),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('ignora litros <= 0 (não lê nem escreve)', async () => {
      const { tx, firestore } = cenario({ currentVolume: 0, capacity: 100 });
      await creditarTanqueTx(tx as never, firestore as never, 'comb-1', 0);
      expect(tx.get).not.toHaveBeenCalled();
      expect(tx.update).not.toHaveBeenCalled();
    });

    it('rejeita acima da capacidade (não escreve)', async () => {
      const { tx, firestore } = cenario({ currentVolume: 250, capacity: 300 });
      await expect(
        creditarTanqueTx(tx as never, firestore as never, 'comb-1', 100),
      ).rejects.toThrow(/capacidade/i);
      expect(tx.update).not.toHaveBeenCalled();
    });

    it('aceita encher exatamente até a capacidade', async () => {
      const { tx, firestore } = cenario({ currentVolume: 200, capacity: 300 });
      await creditarTanqueTx(tx as never, firestore as never, 'comb-1', 100);
      expect(tx.update).toHaveBeenCalledTimes(1);
    });

    it('aceita abaixo da capacidade', async () => {
      const { tx, firestore } = cenario({ currentVolume: 100, capacity: 300 });
      await creditarTanqueTx(tx as never, firestore as never, 'comb-1', 50);
      expect(tx.update).toHaveBeenCalledTimes(1);
    });

    it('capacidade 0 = sem limite (não trava)', async () => {
      const { tx, firestore } = cenario({ currentVolume: 100, capacity: 0 });
      await creditarTanqueTx(tx as never, firestore as never, 'comb-1', 9999);
      expect(tx.update).toHaveBeenCalledTimes(1);
    });

    it('capacidade ausente = sem limite (não trava)', async () => {
      const { tx, firestore } = cenario({ currentVolume: 100 });
      await creditarTanqueTx(tx as never, firestore as never, 'comb-1', 9999);
      expect(tx.update).toHaveBeenCalledTimes(1);
    });

    it('cria via set merge quando o tanque não existe', async () => {
      const { tx, firestore } = cenario({ existe: false });
      await creditarTanqueTx(tx as never, firestore as never, 'comb-1', 80);
      expect(tx.set).toHaveBeenCalledTimes(1);
      const [, payload, setOpts] = tx.set.mock.calls[0] as [
        unknown,
        Record<string, unknown>,
        unknown,
      ];
      expect(payload.comboioId).toBe('comb-1');
      expect(payload.currentVolume).toBeDefined();
      expect(setOpts).toEqual({ merge: true });
      expect(tx.update).not.toHaveBeenCalled();
    });
  });

  describe('ensureTankForComboio', () => {
    it('cria com volume zero quando não existe', async () => {
      const doc = {
        get: jest.fn().mockResolvedValue({ exists: false }),
        set: jest.fn().mockResolvedValue(undefined),
      };
      await ensureTankForComboio(firestoreComDoc(doc) as never, {
        id: 'comb-1',
        prefeituraId: 'pref-1',
        capacidadeTanque: 300,
        descricao: 'Comboio Scania',
        placa: 'ABC-1234',
      });
      expect(doc.set).toHaveBeenCalledTimes(1);
      const [payload, opts] = doc.set.mock.calls[0] as [
        Record<string, unknown>,
        unknown,
      ];
      expect(payload.currentVolume).toBe(0);
      expect(payload.capacity).toBe(300);
      expect(payload.comboioId).toBe('comb-1');
      expect(opts).toBeUndefined(); // criação é set sem merge
    });

    it('preserva o volume quando já existe (merge, sem currentVolume)', async () => {
      const doc = {
        get: jest.fn().mockResolvedValue({ exists: true }),
        set: jest.fn().mockResolvedValue(undefined),
      };
      await ensureTankForComboio(firestoreComDoc(doc) as never, {
        id: 'comb-1',
        capacidadeTanque: 500,
      });
      const [payload, opts] = doc.set.mock.calls[0] as [
        Record<string, unknown>,
        unknown,
      ];
      expect(payload.currentVolume).toBeUndefined();
      expect(payload.capacity).toBe(500);
      expect(opts).toEqual({ merge: true });
    });

    it('no-op sem id', async () => {
      const doc = { get: jest.fn(), set: jest.fn() };
      await ensureTankForComboio(firestoreComDoc(doc) as never, {});
      expect(doc.get).not.toHaveBeenCalled();
      expect(doc.set).not.toHaveBeenCalled();
    });
  });
});

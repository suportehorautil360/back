jest.mock('uuid', () => ({ v4: () => 'fixed-uuid' }));

import { FeatureFlagsService } from './feature-flags.service';
import { FirebaseService } from '../../config/firebase.service';

function makeFirestore(docs: { id?: string; data: () => unknown }[] = []) {
  const setDoc = jest.fn().mockResolvedValue(undefined);
  const updateDoc = jest.fn().mockResolvedValue(undefined);
  const getDocs = jest
    .fn()
    .mockResolvedValue({ empty: docs.length === 0, docs });
  const collection = jest.fn(() => ({
    where: jest.fn(() => ({ get: getDocs })),
    doc: jest.fn(() => ({ set: setDoc, update: updateDoc })),
  }));
  const firebaseService = {
    getFirestore: () => ({ collection }),
  } as unknown as FirebaseService;
  return { firebaseService, setDoc, updateDoc };
}

describe('FeatureFlagsService', () => {
  it('obter devolve {} quando não há flags', async () => {
    const { firebaseService } = makeFirestore([]);
    expect(await new FeatureFlagsService(firebaseService).obter('p')).toEqual(
      {},
    );
  });

  it('ativo é false por padrão (opt-in)', async () => {
    const { firebaseService } = makeFirestore([]);
    const ativo = await new FeatureFlagsService(firebaseService).ativo(
      'p',
      'ponto',
    );
    expect(ativo).toBe(false);
  });

  it('ativo é true quando a flag está marcada', async () => {
    const { firebaseService } = makeFirestore([
      { id: 'd1', data: () => ({ flags: { ponto: true } }) },
    ]);
    const ativo = await new FeatureFlagsService(firebaseService).ativo(
      'p',
      'ponto',
    );
    expect(ativo).toBe(true);
  });

  it('salvar cria quando não existe', async () => {
    const { firebaseService, setDoc } = makeFirestore([]);
    await new FeatureFlagsService(firebaseService).salvar({
      prefeituraId: 'p',
      flags: { ponto: true },
    });
    expect(setDoc).toHaveBeenCalledWith(
      expect.objectContaining({ prefeituraId: 'p', flags: { ponto: true } }),
    );
  });
});

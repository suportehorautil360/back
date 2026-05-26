jest.mock('uuid', () => ({ v4: () => 'fixed-uuid' }));

import { EscalaService } from './escala.service';
import { FirebaseService } from '../../config/firebase.service';
import { UpsertEscalaDto } from './dto/upsert-escala.dto';

function makeFirestore(docs: { id?: string; data: () => unknown }[] = []) {
  const setDoc = jest.fn().mockResolvedValue(undefined);
  const updateDoc = jest.fn().mockResolvedValue(undefined);
  const getDocs = jest.fn().mockResolvedValue({ empty: docs.length === 0, docs });
  const collection = jest.fn(() => ({
    where: jest.fn(() => ({ get: getDocs })),
    doc: jest.fn(() => ({ set: setDoc, update: updateDoc })),
  }));
  const firebaseService = {
    getFirestore: () => ({ collection }),
  } as unknown as FirebaseService;
  return { firebaseService, setDoc, updateDoc };
}

const dto: UpsertEscalaDto = {
  prefeituraId: 'pref-1',
  inicio: '08:00',
  fim: '18:00',
  diasSemana: [1, 2, 3, 4, 5],
  almocoMinutos: 75,
};

describe('EscalaService', () => {
  it('obter devolve null quando não há escala', async () => {
    const { firebaseService } = makeFirestore([]);
    const res = await new EscalaService(firebaseService).obter('pref-1');
    expect(res.data).toBeNull();
  });

  it('salvar cria quando não existe', async () => {
    const { firebaseService, setDoc, updateDoc } = makeFirestore([]);
    await new EscalaService(firebaseService).salvar(dto);
    expect(setDoc).toHaveBeenCalledWith(
      expect.objectContaining({ prefeituraId: 'pref-1', inicio: '08:00' }),
    );
    expect(updateDoc).not.toHaveBeenCalled();
  });

  it('salvar atualiza quando já existe', async () => {
    const { firebaseService, setDoc, updateDoc } = makeFirestore([
      { id: 'doc-1', data: () => ({ prefeituraId: 'pref-1' }) },
    ]);
    await new EscalaService(firebaseService).salvar(dto);
    expect(updateDoc).toHaveBeenCalledWith(
      expect.objectContaining({ fim: '18:00', almocoMinutos: 75 }),
    );
    expect(setDoc).not.toHaveBeenCalled();
  });
});

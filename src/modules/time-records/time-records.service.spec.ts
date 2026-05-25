jest.mock('uuid', () => ({ v4: () => 'fixed-uuid' }));

import { TimeRecordsService } from './time-records.service';
import { FirebaseService } from '../../config/firebase.service';
import { CreateTimeRecordDto } from './dto/create-time-record.dto';

function makeFirestore(docs: { data: () => unknown }[] = []) {
  const setDoc = jest.fn().mockResolvedValue(undefined);
  const getDocs = jest.fn().mockResolvedValue({ docs });
  const collection = jest.fn(() => ({
    where: jest.fn(() => ({ get: getDocs })),
    doc: jest.fn(() => ({ set: setDoc })),
  }));
  const firebaseService = {
    getFirestore: () => ({ collection }),
  } as unknown as FirebaseService;
  return { firebaseService, setDoc };
}

const dto: CreateTimeRecordDto = {
  name: 'João da Silva',
  photo: 'data:image/jpeg;base64,abc',
  prefeituraId: 'pref-1',
  timestampOriginal: '2026-05-25T13:05:00.000Z',
};

describe('TimeRecordsService', () => {
  it('grava a batida com id e createdAt', async () => {
    const { firebaseService, setDoc } = makeFirestore();
    const service = new TimeRecordsService(firebaseService);

    const res = await service.create(dto);

    expect(setDoc).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'João da Silva',
        prefeituraId: 'pref-1',
        timestampOriginal: '2026-05-25T13:05:00.000Z',
      }),
    );
    expect(res.data).toHaveProperty('createdAt');
  });

  it('lista vazia retorna [] (sem 404)', async () => {
    const { firebaseService } = makeFirestore([]);
    const service = new TimeRecordsService(firebaseService);

    const res = await service.findAllById('pref-1');
    expect(res.data).toEqual([]);
  });

  it('lista as batidas existentes', async () => {
    const { firebaseService } = makeFirestore([
      { data: () => ({ id: 't1', name: 'João' }) },
    ]);
    const service = new TimeRecordsService(firebaseService);

    const res = await service.findAllById('pref-1');
    expect(res.data).toHaveLength(1);
    expect(res.data[0]).toMatchObject({ name: 'João' });
  });
});

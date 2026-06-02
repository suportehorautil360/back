// uuid@14 é ESM puro e o Jest não transpila node_modules; mockamos o v4.
jest.mock('uuid', () => ({ v4: () => 'fixed-uuid' }));

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RevisionService } from './revision.service';
import { FirebaseService } from '../../config/firebase.service';
import { CreateRevisionDto } from './dto/create-revision.dto';

/**
 * Firestore falso: o service usa
 *   collection(name).where().get()  → consulta
 *   collection(name).doc().set()    → grava revisão
 *   collection(name).doc(id).update() → atualiza veículo
 */
function makeFirestore(vehicleSnap: {
  empty: boolean;
  docs: { id: string; data: () => unknown }[];
}) {
  const setDoc = jest.fn().mockResolvedValue(undefined);
  const updateDoc = jest.fn().mockResolvedValue(undefined);
  const getDocs = jest.fn().mockResolvedValue(vehicleSnap);
  const collection = jest.fn(() => ({
    where: jest.fn(() => ({ get: getDocs })),
    doc: jest.fn(() => ({ set: setDoc, update: updateDoc })),
  }));
  const firebaseService = {
    getFirestore: () => ({ collection }),
  } as unknown as FirebaseService;
  return { firebaseService, setDoc, updateDoc, getDocs };
}

const dto: CreateRevisionDto = {
  revisionDate: new Date('2026-05-25T00:00:00.000Z'),
  odometerReading: 15000,
  mechanicOrOfficeName: 'Oficina X',
  servicesDescription: 'Troca de óleo',
  revisionCost: 200,
  invoiceNumber: 'NF-1',
  prefeituraId: 'pref-1',
  vehicleId: 'veh-1',
};

// O service loga o erro antes de re-lançar; silenciamos para não poluir o CI.
beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => {
  jest.restoreAllMocks();
});

describe('RevisionService.complete', () => {
  it('grava revisão concluída e libera o veículo (recalcula leitura/última revisão)', async () => {
    const { firebaseService, setDoc, updateDoc } = makeFirestore({
      empty: false,
      docs: [{ id: 'doc-1', data: () => ({ currentMeter: 12000 }) }],
    });
    const service = new RevisionService(firebaseService);

    const res = await service.complete(dto);

    expect(setDoc).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'Concluída', odometerReading: 15000 }),
    );
    expect(updateDoc).toHaveBeenCalledWith(
      expect.objectContaining({
        currentMeter: 15000,
        lastRevisionOdometerReading: 15000,
        status: 'ativo',
      }),
    );
    expect(res.message).toMatch(/liberado/i);
  });

  it('lança 404 quando o veículo não existe', async () => {
    const { firebaseService, setDoc } = makeFirestore({
      empty: true,
      docs: [],
    });
    const service = new RevisionService(firebaseService);

    await expect(service.complete(dto)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('recusa leitura menor que a atual do veículo', async () => {
    const { firebaseService, updateDoc } = makeFirestore({
      empty: false,
      docs: [{ id: 'doc-1', data: () => ({ currentMeter: 20000 }) }],
    });
    const service = new RevisionService(firebaseService);

    await expect(service.complete(dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(updateDoc).not.toHaveBeenCalled();
  });
});

describe('RevisionService.create', () => {
  it('compara contra currentMeter (não o campo inexistente odometerReading)', async () => {
    // currentMeter alto e leitura abaixo dele → deve recusar.
    const { firebaseService } = makeFirestore({
      empty: false,
      docs: [
        {
          id: 'doc-1',
          data: () => ({ currentMeter: 50000, lastRevisionOdometerReading: 0 }),
        },
      ],
    });
    const service = new RevisionService(firebaseService);

    await expect(service.create(dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('exige leitura ao menos 1.000 maior que a última revisão', async () => {
    const { firebaseService } = makeFirestore({
      empty: false,
      docs: [
        {
          id: 'doc-1',
          data: () => ({
            currentMeter: 0,
            lastRevisionOdometerReading: 14500,
          }),
        },
      ],
    });
    const service = new RevisionService(firebaseService);

    // 15000 não é > 14500 + 1000 → recusa.
    await expect(service.create(dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

jest.mock('uuid', () => ({ v4: () => 'fixed-uuid' }));

import { NotFoundException } from '@nestjs/common';
import { VehiclesService } from './vehicles.service';
import { FirebaseService } from '../../config/firebase.service';

function makeFirestore(snap: {
  empty: boolean;
  docs: { id: string; data: () => unknown }[];
}) {
  const setDoc = jest.fn().mockResolvedValue(undefined);
  const getDocs = jest.fn().mockResolvedValue(snap);
  const collection = jest.fn(() => ({
    where: jest.fn(() => ({ get: getDocs })),
    doc: jest.fn(() => ({ set: setDoc })),
  }));
  const firebaseService = {
    getFirestore: () => ({ collection }),
  } as unknown as FirebaseService;
  return { firebaseService, setDoc };
}

beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => {
  jest.restoreAllMocks();
});

describe('VehiclesService.findAllByID', () => {
  it('propaga 404 (NotFound) quando a prefeitura não tem veículos', async () => {
    const { firebaseService } = makeFirestore({ empty: true, docs: [] });
    const service = new VehiclesService(firebaseService);

    // Regressão: o catch não pode converter o 404 em 500.
    await expect(service.findAllByID('pref-x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('retorna os veículos quando existem', async () => {
    const { firebaseService } = makeFirestore({
      empty: false,
      docs: [{ id: 'd1', data: () => ({ id: 'v1', name: 'HB20' }) }],
    });
    const service = new VehiclesService(firebaseService);

    const res = await service.findAllByID('pref-1');
    expect(res.data).toHaveLength(1);
    expect(res.data[0]).toMatchObject({ name: 'HB20' });
  });
});

describe('VehiclesService.create', () => {
  it('grava o veículo com status ativo', async () => {
    const { firebaseService, setDoc } = makeFirestore({ empty: true, docs: [] });
    const service = new VehiclesService(firebaseService);

    await service.create({
      name: 'HB20',
      plate: 'CAR-001',
      type: 'carro',
      year: 2021,
      currentMeter: 12000,
      brand: 'Hyundai',
      maintenanceInterval: 10000,
      maintenanceUnit: 'km',
      prefeituraId: 'pref-1',
      lastRevisionOdometerReading: 0,
    });

    expect(setDoc).toHaveBeenCalledWith(
      expect.objectContaining({ plate: 'CAR-001', status: 'ativo' }),
    );
  });
});

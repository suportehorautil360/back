jest.mock('uuid', () => ({ v4: () => 'fixed-uuid' }));

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { TimeRecordsService } from './time-records.service';
import { FirebaseService } from '../../config/firebase.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { CreateTimeRecordDto } from './dto/create-time-record.dto';

/** Cria o service com a flag de ponto ativa (default) ou não. */
function makeService(firebaseService: FirebaseService, pontoAtivo = true) {
  const featureFlags = {
    ativo: jest.fn().mockResolvedValue(pontoAtivo),
  } as unknown as FeatureFlagsService;
  return new TimeRecordsService(firebaseService, featureFlags);
}

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

const dto: CreateTimeRecordDto = {
  name: 'João da Silva',
  photo: 'data:image/jpeg;base64,abc',
  prefeituraId: 'pref-1',
  timestampOriginal: '2026-05-25T13:05:00.000Z',
  tipo: 'entrada',
};

describe('TimeRecordsService', () => {
  it('grava a batida com id e createdAt', async () => {
    const { firebaseService, setDoc } = makeFirestore();
    const service = makeService(firebaseService);

    const res = await service.create(dto);

    expect(setDoc).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'João da Silva',
        prefeituraId: 'pref-1',
        timestampOriginal: '2026-05-25T13:05:00.000Z',
        // 13:05Z em São Paulo (UTC-3) = 10:05.
        horaLocalBR: '25/05/2026 10:05',
        tipo: 'entrada',
        status: 'pendente',
      }),
    );
    expect(res.data).toHaveProperty('createdAt');
  });

  it('recusa a batida quando o ponto está desativado para a prefeitura', async () => {
    const { firebaseService, setDoc } = makeFirestore();
    const service = makeService(firebaseService, false);

    await expect(service.create(dto)).rejects.toBeInstanceOf(ForbiddenException);
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('aprovar marca status aprovado', async () => {
    const { firebaseService, updateDoc } = makeFirestore([
      { id: 'doc-1', data: () => ({ id: 't1' }) },
    ]);
    const service = makeService(firebaseService);

    await service.aprovar('t1');

    expect(updateDoc).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'aprovado' }),
    );
  });

  it('reprovar marca status reprovado + motivo', async () => {
    const { firebaseService, updateDoc } = makeFirestore([
      { id: 'doc-1', data: () => ({ id: 't1' }) },
    ]);
    const service = makeService(firebaseService);

    await service.reprovar('t1', 'Foto não confere');

    expect(updateDoc).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'reprovado',
        motivoReprovacao: 'Foto não confere',
      }),
    );
  });

  it('aprovar lança 404 quando a batida não existe', async () => {
    const { firebaseService } = makeFirestore([]);
    const service = makeService(firebaseService);
    await expect(service.aprovar('x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('atualiza o horário de uma batida existente', async () => {
    const { firebaseService, updateDoc } = makeFirestore([
      { id: 'doc-1', data: () => ({ id: 't1' }) },
    ]);
    const service = makeService(firebaseService);

    await service.update('t1', { timestampOriginal: '2026-05-25T12:00:00.000Z' });

    expect(updateDoc).toHaveBeenCalledWith(
      expect.objectContaining({ timestampOriginal: '2026-05-25T12:00:00.000Z' }),
    );
  });

  it('update lança 404 quando a batida não existe', async () => {
    const { firebaseService, updateDoc } = makeFirestore([]);
    const service = makeService(firebaseService);

    await expect(
      service.update('inexistente', {
        timestampOriginal: '2026-05-25T12:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(updateDoc).not.toHaveBeenCalled();
  });

  it('lista vazia retorna [] (sem 404)', async () => {
    const { firebaseService } = makeFirestore([]);
    const service = makeService(firebaseService);

    const res = await service.findAllById('pref-1');
    expect(res.data).toEqual([]);
  });

  it('lista as batidas existentes', async () => {
    const { firebaseService } = makeFirestore([
      { data: () => ({ id: 't1', name: 'João' }) },
    ]);
    const service = makeService(firebaseService);

    const res = await service.findAllById('pref-1');
    expect(res.data).toHaveLength(1);
    expect(res.data[0]).toMatchObject({ name: 'João' });
  });
});

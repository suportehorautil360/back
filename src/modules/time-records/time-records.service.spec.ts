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

/**
 * Mock do Firestore admin cobrindo `runTransaction` (usado pelo ledger) e as
 * leituras/escritas fora de transação.
 * - `docs`: o que `where(...).get()` retorna (batida-alvo de update/aprovar).
 * - `counter`: estado do contador NSR lido por `tx.get(nsrCounters/{pref})`.
 */
function makeFirestore(
  docs: { id?: string; data: () => unknown }[] = [],
  counter?: { ultimo?: number; ultimoHash?: string },
) {
  const txSets: { col: string; data: Record<string, unknown> }[] = [];
  const updateDoc = jest.fn().mockResolvedValue(undefined);
  const setDoc = jest.fn().mockResolvedValue(undefined);
  const getDocs = jest
    .fn()
    .mockResolvedValue({ empty: docs.length === 0, docs });

  const makeDocRef = (col: string, id?: string) => ({
    _col: col,
    _id: id,
    set: setDoc,
    update: updateDoc,
  });
  const collection = jest.fn((name: string) => ({
    where: jest.fn(() => ({ get: getDocs })),
    doc: jest.fn((id?: string) => makeDocRef(name, id)),
  }));

  const counterSnap = { exists: counter !== undefined, data: () => counter };

  const runTransaction = jest.fn(
    async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        get: jest.fn(async (ref: { _col: string }) => {
          if (ref._col === 'nsrCounters') return counterSnap;
          return { empty: docs.length === 0, docs };
        }),
        set: jest.fn(
          (ref: { _col: string }, data: Record<string, unknown>) => {
            txSets.push({ col: ref._col, data });
          },
        ),
      };
      return fn(tx);
    },
  );

  const firebaseService = {
    getFirestore: () => ({ collection, runTransaction }),
  } as unknown as FirebaseService;

  /** Apenas os registros gravados na coleção de batidas (ignora o contador). */
  const recordWrites = () => txSets.filter((w) => w.col === 'timeRecords');
  return { firebaseService, setDoc, updateDoc, recordWrites };
}

const dto: CreateTimeRecordDto = {
  name: 'João da Silva',
  photo: 'data:image/jpeg;base64,abc',
  prefeituraId: 'pref-1',
  timestampOriginal: '2026-05-25T13:05:00.000Z',
  tipo: 'entrada',
};

describe('TimeRecordsService', () => {
  it('grava a marcação ORIGINAL com NSR, hash e horaLocalBR', async () => {
    const { firebaseService, recordWrites } = makeFirestore();
    const service = makeService(firebaseService);

    const res = await service.create(dto);

    const writes = recordWrites();
    expect(writes).toHaveLength(1);
    expect(writes[0].data).toEqual(
      expect.objectContaining({
        name: 'João da Silva',
        prefeituraId: 'pref-1',
        timestampOriginal: '2026-05-25T13:05:00.000Z',
        // 13:05Z em São Paulo (UTC-3) = 10:05.
        horaLocalBR: '25/05/2026 10:05',
        tipo: 'entrada',
        registro: 'original',
        nsr: 1, // contador vazio → começa em 1
        hashAnterior: '',
      }),
    );
    expect(writes[0].data.hash).toEqual(expect.any(String));
    expect(res.data).toHaveProperty('createdAt');
  });

  it('NSR é sequencial por prefeitura (continua do contador)', async () => {
    const { firebaseService, recordWrites } = makeFirestore([], {
      ultimo: 41,
      ultimoHash: 'abc123',
    });
    const service = makeService(firebaseService);

    await service.create(dto);

    expect(recordWrites()[0].data).toEqual(
      expect.objectContaining({ nsr: 42, hashAnterior: 'abc123' }),
    );
  });

  it('recusa a batida quando o ponto está desativado para a prefeitura', async () => {
    const { firebaseService, recordWrites } = makeFirestore();
    const service = makeService(firebaseService, false);

    await expect(service.create(dto)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(recordWrites()).toHaveLength(0);
  });

  it('correção cria um AJUSTE e NÃO altera a batida original', async () => {
    const { firebaseService, updateDoc, recordWrites } = makeFirestore(
      [
        {
          id: 'doc-1',
          data: () => ({
            id: 't1',
            prefeituraId: 'pref-1',
            name: 'João',
            tipo: 'entrada',
            nsr: 3,
          }),
        },
      ],
      { ultimo: 9, ultimoHash: 'h9' },
    );
    const service = makeService(firebaseService);

    await service.update('t1', {
      timestampOriginal: '2026-05-25T12:00:00.000Z',
      motivo: 'Esqueci de bater',
    });

    // Original intacta: nenhum update foi chamado.
    expect(updateDoc).not.toHaveBeenCalled();
    // Novo registro de ajuste, pendente, apontando para a original.
    expect(recordWrites()[0].data).toEqual(
      expect.objectContaining({
        registro: 'ajuste',
        refNsr: 3,
        refId: 't1',
        aplicado: false,
        timestampOriginal: '2026-05-25T12:00:00.000Z',
        motivo: 'Esqueci de bater',
        nsr: 10,
      }),
    );
  });

  it('correção lança 404 quando a batida não existe', async () => {
    const { firebaseService, recordWrites } = makeFirestore([]);
    const service = makeService(firebaseService);

    await expect(
      service.update('inexistente', {
        timestampOriginal: '2026-05-25T12:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(recordWrites()).toHaveLength(0);
  });

  it('aprovar aplica o ajuste (aplicado=true)', async () => {
    const { firebaseService, updateDoc } = makeFirestore([
      { id: 'doc-1', data: () => ({ id: 'a1', registro: 'ajuste' }) },
    ]);
    const service = makeService(firebaseService);

    await service.aprovar('a1');

    expect(updateDoc).toHaveBeenCalledWith(
      expect.objectContaining({ aplicado: true, motivoReprovacao: null }),
    );
  });

  it('reprovar marca o ajuste como não aplicado + motivo', async () => {
    const { firebaseService, updateDoc } = makeFirestore([
      { id: 'doc-1', data: () => ({ id: 'a1', registro: 'ajuste' }) },
    ]);
    const service = makeService(firebaseService);

    await service.reprovar('a1', 'Sem comprovante');

    expect(updateDoc).toHaveBeenCalledWith(
      expect.objectContaining({
        aplicado: false,
        motivoReprovacao: 'Sem comprovante',
      }),
    );
  });

  it('aprovar/reprovar a marcação ORIGINAL é proibido (403)', async () => {
    const { firebaseService, updateDoc } = makeFirestore([
      { id: 'doc-1', data: () => ({ id: 't1', registro: 'original' }) },
    ]);
    const service = makeService(firebaseService);

    await expect(service.aprovar('t1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.reprovar('t1', 'x')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(updateDoc).not.toHaveBeenCalled();
  });

  it('aprovar lança 404 quando o registro não existe', async () => {
    const { firebaseService } = makeFirestore([]);
    const service = makeService(firebaseService);
    await expect(service.aprovar('x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
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

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { FirebaseService } from '../../config/firebase.service';
import type { UploadsService } from '../uploads/uploads.service';
import { NotasFiscaisService } from './notas-fiscais.service';
import * as parser from './helpers/parse-danfe-pdf.helper';

// ---------------------------------------------------------------------------
// Firestore em memória (apenas o subconjunto usado pelo service).
// ---------------------------------------------------------------------------

type Doc = Record<string, unknown>;
type Filter = [string, string, unknown];

class FakeDocRef {
  constructor(
    private readonly coll: Map<string, Doc>,
    readonly id: string,
  ) {}
  get() {
    const data = this.coll.get(this.id);
    return Promise.resolve({
      id: this.id,
      exists: data !== undefined,
      data: () => data,
    });
  }
  set(data: Doc) {
    this.coll.set(this.id, { ...data });
    return Promise.resolve();
  }
  update(patch: Doc) {
    const cur = this.coll.get(this.id);
    if (!cur) return Promise.reject(new Error('doc inexistente'));
    this.coll.set(this.id, { ...cur, ...patch });
    return Promise.resolve();
  }
}

class FakeQuery {
  constructor(
    protected coll: Map<string, Doc>,
    protected filters: Filter[] = [],
    protected limitN?: number,
  ) {}
  where(field: string, op: string, value: unknown): FakeQuery {
    return new FakeQuery(this.coll, [...this.filters, [field, op, value]], this.limitN);
  }
  limit(n: number): FakeQuery {
    return new FakeQuery(this.coll, this.filters, n);
  }
  get() {
    let entries = [...this.coll.entries()].filter(([, data]) =>
      this.filters.every(([f, , v]) => data[f] === v),
    );
    if (this.limitN != null) entries = entries.slice(0, this.limitN);
    const docs = entries.map(([id, data]) => ({ id, data: () => data }));
    return Promise.resolve({ empty: docs.length === 0, docs });
  }
}

class FakeCollection extends FakeQuery {
  doc(id?: string): FakeDocRef {
    return new FakeDocRef(this.coll, id ?? `auto-${Math.random()}`);
  }
}

function makeService() {
  const store = new Map<string, Doc>();
  const firebase = {
    getFirestore: () => ({ collection: () => new FakeCollection(store) }),
  } as unknown as FirebaseService;
  const uploads = {
    uploadNotaFiscalPdf: jest.fn(async () => 'https://cdn/exemplo.pdf'),
  } as unknown as UploadsService;
  const service = new NotasFiscaisService(firebase, uploads);
  return { service, store, uploads };
}

const DEMO_POSTO_PDF = join(
  __dirname,
  'fixtures',
  'danfe_posto_combustivel_demo.pdf',
);

const DEMO_POSTO_EXPECTED = join(
  __dirname,
  'fixtures',
  'danfe_posto_combustivel_demo.expected.json',
);

function pdf(): Express.Multer.File {
  return {
    buffer: Buffer.from('%PDF-1.4 fake'),
    size: 13,
    mimetype: 'application/pdf',
    originalname: 'nota.pdf',
  } as unknown as Express.Multer.File;
}

function demoPostoPdf(): Express.Multer.File {
  const buffer = readFileSync(DEMO_POSTO_PDF);
  return {
    buffer,
    size: buffer.length,
    mimetype: 'application/pdf',
    originalname: 'danfe_posto_combustivel_demo.pdf',
  } as unknown as Express.Multer.File;
}

const VALOR_POSTO = 3420;

const PARSED: parser.ParsedDanfeData = {
  description: 'OLEO DIESEL S10',
  category: 'combustivel',
  documentType: 'nfe-55',
  number: '000512',
  issuerName: 'Distribuidora Petro Ltda',
  issuedAt: '2026-06-03T00:00:00.000Z',
  accessKey: '1'.repeat(44),
  value: 3420,
  parseCompleteness: 'completo',
};

beforeEach(() => {
  jest.spyOn(parser, 'parseDanfePdf').mockResolvedValue(PARSED);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('NotasFiscaisService — PDF demo posto (integração)', () => {
  const fixtureParsed = JSON.parse(
    readFileSync(DEMO_POSTO_EXPECTED, 'utf8'),
  ) as parser.ParsedDanfeData;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(parser, 'parseDanfePdf').mockResolvedValue(fixtureParsed);
  });

  it('uploadPorPosto persiste campos do danfe_posto_combustivel_demo.pdf', async () => {
    const { service, uploads } = makeService();

    const nota = await service.uploadPorPosto({
      postoId: 'posto-demo',
      prefeituraId: 'pref-demo',
      value: '250,50',
      file: demoPostoPdf(),
    });

    expect(nota).toMatchObject({
      postoId: 'posto-demo',
      prefeituraId: 'pref-demo',
      status: 'aprovada',
      accessKey: fixtureParsed.accessKey,
      value: 250.5,
      documentType: fixtureParsed.documentType,
      parseCompleteness: fixtureParsed.parseCompleteness,
    });
    expect(uploads.uploadNotaFiscalPdf).toHaveBeenCalledWith(
      'posto-posto-demo',
      expect.any(String),
      expect.objectContaining({
        mimetype: 'application/pdf',
        originalname: 'danfe_posto_combustivel_demo.pdf',
      }),
    );
  });
});

describe('NotasFiscaisService — fluxo do posto', () => {
  it('exige valor informado no upload do posto', async () => {
    const { service } = makeService();
    await expect(
      service.uploadPorPosto({ postoId: 'posto-1', value: '', file: pdf() }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('grava a nota do posto já aprovada (sem fluxo de conferência no 360)', async () => {
    const { service, uploads } = makeService();

    const nota = await service.uploadPorPosto({
      postoId: 'posto-1',
      prefeituraId: 'pref-1',
      value: VALOR_POSTO,
      file: pdf(),
    });

    expect(nota.postoId).toBe('posto-1');
    expect(nota.prefeituraId).toBe('pref-1');
    expect(nota.status).toBe('aprovada');
    expect(nota.value).toBe(3420);
    expect(nota.category).toBe('combustivel');
    expect(nota.fileUrl).toBe('https://cdn/exemplo.pdf');
    // O path de upload usa o prefixo do posto, não a oficina.
    expect(uploads.uploadNotaFiscalPdf).toHaveBeenCalledWith(
      'posto-posto-1',
      expect.any(String),
      expect.objectContaining({ mimetype: 'application/pdf' }),
    );
  });

  it('rejeita nota duplicada (mesmo posto + chave de acesso)', async () => {
    const { service } = makeService();
    await service.uploadPorPosto({ postoId: 'posto-1', value: VALOR_POSTO, file: pdf() });
    await expect(
      service.uploadPorPosto({ postoId: 'posto-1', value: VALOR_POSTO, file: pdf() }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('postos diferentes podem ter a mesma chave (sem conflito)', async () => {
    const { service } = makeService();
    await service.uploadPorPosto({ postoId: 'posto-1', value: VALOR_POSTO, file: pdf() });
    await expect(
      service.uploadPorPosto({ postoId: 'posto-2', value: VALOR_POSTO, file: pdf() }),
    ).resolves.toMatchObject({ postoId: 'posto-2' });
  });

  it('listarPorPosto traz só as notas daquele posto', async () => {
    const { service } = makeService();
    await service.uploadPorPosto({ postoId: 'posto-1', value: VALOR_POSTO, file: pdf() });
    jest
      .spyOn(parser, 'parseDanfePdf')
      .mockResolvedValue({ ...PARSED, accessKey: '2'.repeat(44) });
    await service.uploadPorPosto({ postoId: 'posto-2', value: VALOR_POSTO, file: pdf() });

    const { data } = await service.listarPorPosto('posto-1');
    expect(data).toHaveLength(1);
    expect(data[0].postoId).toBe('posto-1');
  });
});

describe('NotasFiscaisService — listagem por prefeitura (360)', () => {
  it('retorna só notas de posto (ignora as de oficina)', async () => {
    const { service, store } = makeService();
    // Nota de oficina (mesma prefeitura) não deve aparecer.
    store.set('of-1', {
      id: 'of-1',
      oficinaId: 'of-x',
      prefeituraId: 'pref-1',
      status: 'pendente',
      createdAt: '2026-06-01T00:00:00.000Z',
    });
    await service.uploadPorPosto({
      postoId: 'posto-1',
      prefeituraId: 'pref-1',
      value: VALOR_POSTO,
      file: pdf(),
    });

    const { data } = await service.listarCombustivelPorPrefeitura('pref-1');
    expect(data).toHaveLength(1);
    expect(data[0].postoId).toBe('posto-1');
  });
});

describe('NotasFiscaisService — atualizarStatus', () => {
  it('recusa status inválido', async () => {
    const { service } = makeService();
    await expect(service.atualizarStatus('x', 'invalido')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('404 quando a nota não existe', async () => {
    const { service } = makeService();
    await expect(
      service.atualizarStatus('nao-existe', 'aprovada'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('aprova uma nota existente', async () => {
    const { service } = makeService();
    const criada = await service.uploadPorPosto({
      postoId: 'posto-1',
      value: VALOR_POSTO,
      file: pdf(),
    });
    const { data } = await service.atualizarStatus(criada.id, 'aprovada');
    expect(data.status).toBe('aprovada');
  });
});

describe('NotasFiscaisService — fluxo da oficina', () => {
  it('exige valor informado no upload da oficina', async () => {
    const { service } = makeService();
    await expect(
      service.upload({ oficinaId: 'of-1', value: '', file: pdf() }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('grava nota da oficina com valor informado e status pendente', async () => {
    const { service } = makeService();

    const nota = await service.upload({
      oficinaId: 'of-1',
      prefeituraId: 'pref-1',
      value: '1.250,50',
      file: pdf(),
    });

    expect(nota.oficinaId).toBe('of-1');
    expect(nota.prefeituraId).toBe('pref-1');
    expect(nota.status).toBe('pendente');
    expect(nota.value).toBe(1250.5);
  });
});

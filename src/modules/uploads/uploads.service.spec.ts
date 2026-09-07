import {
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { UploadsService } from './uploads.service';

const uploadMock = jest.fn();
const getPublicUrlMock = jest.fn();
const fromMock = jest.fn(() => ({
  upload: uploadMock,
  getPublicUrl: getPublicUrlMock,
}));
const listBucketsMock = jest.fn();
const createBucketMock = jest.fn();

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    storage: {
      from: fromMock,
      listBuckets: listBucketsMock,
      createBucket: createBucketMock,
    },
  })),
}));

jest.mock('../../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

jest.mock('../../common/prisma/company-resolver', () => ({
  resolverCompanyId: jest.fn(),
}));

import { resolverCompanyId } from '../../common/prisma/company-resolver';

const resolveCompany = jest.mocked(resolverCompanyId);
const PRISMA = {} as ConstructorParameters<typeof UploadsService>[0];

describe('UploadsService', () => {
  const ENV_ORIGINAL = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...ENV_ORIGINAL,
      SUPABASE_URL: 'https://exemplo.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'chave-teste',
    };
    uploadMock.mockResolvedValue({ error: null });
    getPublicUrlMock.mockImplementation((path: string) => ({
      data: { publicUrl: `https://cdn.exemplo/${path}` },
    }));
    listBucketsMock.mockResolvedValue({ data: [], error: null });
    createBucketMock.mockResolvedValue({ error: null });
    resolveCompany.mockResolvedValue('company-1');
  });

  afterAll(() => {
    process.env = ENV_ORIGINAL;
  });

  it('responde 503 quando o Supabase não está configurado', async () => {
    delete process.env.SUPABASE_URL;
    const service = new UploadsService(PRISMA);
    await expect(
      service.uploadChecklistFotos('chk-1', [
        { nome: 'horimetro', buffer: Buffer.from('x'), mimetype: 'image/jpeg' },
      ]),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('sobe cada foto no bucket e devolve as URLs públicas na ordem', async () => {
    const service = new UploadsService(PRISMA);
    const urls = await service.uploadChecklistFotos('chk-1', [
      { nome: 'horimetro', buffer: Buffer.from('a'), mimetype: 'image/jpeg' },
      { nome: 'item-3', buffer: Buffer.from('b'), mimetype: 'image/png' },
    ]);
    expect(urls).toEqual([
      'https://cdn.exemplo/chk-1/horimetro.jpg',
      'https://cdn.exemplo/chk-1/item-3.png',
    ]);
    expect(uploadMock).toHaveBeenCalledTimes(2);
    expect(uploadMock).toHaveBeenCalledWith(
      'chk-1/horimetro.jpg',
      expect.any(Buffer),
      expect.objectContaining({ contentType: 'image/jpeg', upsert: true }),
    );
  });

  it('sanitiza o nome do arquivo (sem path traversal ou caracteres soltos)', async () => {
    const service = new UploadsService(PRISMA);
    await service.uploadChecklistFotos('chk../2', [
      {
        nome: '../etc/passwd',
        buffer: Buffer.from('a'),
        mimetype: 'image/jpeg',
      },
    ]);
    const path = (uploadMock.mock.calls[0] as string[])[0];
    expect(path).not.toContain('..');
    expect(path).toMatch(/^[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+\.jpg$/);
  });

  it('falha com 500 quando o upload retorna erro', async () => {
    uploadMock.mockResolvedValue({ error: { message: 'bucket inexistente' } });
    const service = new UploadsService(PRISMA);
    await expect(
      service.uploadChecklistFotos('chk-1', [
        { nome: 'horimetro', buffer: Buffer.from('a'), mimetype: 'image/jpeg' },
      ]),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  /**
   * Monta um UploadsService novo sobre os mesmos mocks do client Supabase
   * usados acima, expondo os três métodos de storage que os testes de
   * uploadSelfiePonto precisam inspecionar.
   */
  function servicoComStorageMockado() {
    const service = new UploadsService(PRISMA);
    const storage = {
      createBucket: createBucketMock,
      upload: uploadMock,
      listBuckets: listBucketsMock,
    };
    return { service, storage, upload: uploadMock };
  }

  describe('uploadSelfiePonto', () => {
    const AGORA = new Date('2026-09-06T12:00:00.000Z');

    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(AGORA);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('resolve o companyId no servidor a partir do prefeituraId, nunca do corpo', async () => {
      // A policy de RLS do bucket confere o 1º segmento da chave contra o
      // company_id da sessão — aceitar um companyId pronto da requisição
      // deixaria qualquer um escrever sob a pasta de outra empresa.
      const { service } = servicoComStorageMockado();
      await service.uploadSelfiePonto('prefeitura-1', 'ponto-1', {
        buffer: Buffer.from('x'),
        mimetype: 'image/jpeg',
      });
      expect(resolveCompany).toHaveBeenCalledWith(PRISMA, 'prefeitura-1');
    });

    it('lança NotFoundException quando a empresa não é encontrada', async () => {
      resolveCompany.mockResolvedValue(null);
      const { service } = servicoComStorageMockado();
      await expect(
        service.uploadSelfiePonto('prefeitura-inexistente', 'ponto-1', {
          buffer: Buffer.from('x'),
          mimetype: 'image/jpeg',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejeita pontoId vazio mesmo sem passar pelo controller', async () => {
      const { service } = servicoComStorageMockado();
      await expect(
        service.uploadSelfiePonto('prefeitura-1', '  ', {
          buffer: Buffer.from('x'),
          mimetype: 'image/jpeg',
        }),
      ).rejects.toThrow('pontoId é obrigatório.');
    });

    it('monta a chave como {companyId}/{ano}/{mes}/{pontoId}.ext, igual ao montarChave do horautil', async () => {
      const { service, upload } = servicoComStorageMockado();
      const chave = await service.uploadSelfiePonto('prefeitura-1', 'ponto-1', {
        buffer: Buffer.from('x'),
        mimetype: 'image/jpeg',
      });
      expect(chave).toBe('company-1/2026/09/ponto-1.jpg');
      expect(chave).not.toMatch(/^https?:/);
      const path = (upload.mock.calls[0] as string[])[0];
      expect(path).toBe('company-1/2026/09/ponto-1.jpg');
    });

    it('usa o ano e o mês em UTC, não no fuso local', async () => {
      // 31/dez 23h em UTC-3 (Brasil) ainda é dia 1º de janeiro em UTC — o
      // horautil grava por UTC (`getUTCFullYear`/`getUTCMonth`), e a chave
      // aqui tem que bater com a de lá para caírem na mesma pasta.
      jest.setSystemTime(new Date('2026-12-31T23:30:00.000-03:00'));
      const { service } = servicoComStorageMockado();
      const chave = await service.uploadSelfiePonto('prefeitura-1', 'ponto-1', {
        buffer: Buffer.from('x'),
        mimetype: 'image/jpeg',
      });
      expect(chave).toBe('company-1/2027/01/ponto-1.jpg');
    });

    it('não recria o bucket quando ele já existe (privado por migration, não por este código)', async () => {
      // Em produção o bucket "ponto-selfies" já existe via migration do
      // horautil (RLS privado desde a criação). Este mock reflete essa
      // realidade: `listBuckets` já o encontra, então `ensureBucket` nunca
      // chama `createBucket` — a privacidade não vem deste código.
      listBucketsMock.mockResolvedValue({
        data: [{ name: 'ponto-selfies' }],
        error: null,
      });
      const { service, storage } = servicoComStorageMockado();
      await service.uploadSelfiePonto('prefeitura-1', 'ponto-1', {
        buffer: Buffer.from('x'),
        mimetype: 'image/jpeg',
      });
      expect(storage.createBucket).not.toHaveBeenCalled();
    });

    it('no fallback em que o bucket ainda não existe, cria como privado', async () => {
      // Só chega aqui se a migration nunca rodou (ambiente novo, por ex.).
      // `listBuckets` mockado como lista vazia simula esse caso.
      const { service, storage } = servicoComStorageMockado();
      await service.uploadSelfiePonto('prefeitura-1', 'ponto-1', {
        buffer: Buffer.from('x'),
        mimetype: 'image/jpeg',
      });
      expect(storage.createBucket).toHaveBeenCalledWith(
        'ponto-selfies',
        expect.objectContaining({ public: false }),
      );
    });

    it('sobrescreve o mesmo objeto no reenvio', async () => {
      // Caminho determinístico é o que torna o upload idempotente sem chave
      // de idempotência — mesmo truque do checklist.
      const { service, upload } = servicoComStorageMockado();
      await service.uploadSelfiePonto('prefeitura-1', 'ponto-1', {
        buffer: Buffer.from('a'),
        mimetype: 'image/jpeg',
      });
      await service.uploadSelfiePonto('prefeitura-1', 'ponto-1', {
        buffer: Buffer.from('b'),
        mimetype: 'image/jpeg',
      });
      expect(upload).toHaveBeenNthCalledWith(
        1,
        'company-1/2026/09/ponto-1.jpg',
        expect.anything(),
        expect.objectContaining({ upsert: true }),
      );
      expect(upload).toHaveBeenNthCalledWith(
        2,
        'company-1/2026/09/ponto-1.jpg',
        expect.anything(),
        expect.objectContaining({ upsert: true }),
      );
    });

    it('não deixa o pontoId nem o companyId escaparem da pasta', async () => {
      resolveCompany.mockResolvedValue('../../etc');
      const { service, upload } = servicoComStorageMockado();
      await service.uploadSelfiePonto('prefeitura-1', '../../etc/passwd', {
        buffer: Buffer.from('x'),
        mimetype: 'image/jpeg',
      });
      const path = (upload.mock.calls[0] as string[])[0];
      expect(path).not.toContain('..');
    });
  });
});

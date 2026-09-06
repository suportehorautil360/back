import {
  InternalServerErrorException,
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
  });

  afterAll(() => {
    process.env = ENV_ORIGINAL;
  });

  it('responde 503 quando o Supabase não está configurado', async () => {
    delete process.env.SUPABASE_URL;
    const service = new UploadsService();
    await expect(
      service.uploadChecklistFotos('chk-1', [
        { nome: 'horimetro', buffer: Buffer.from('x'), mimetype: 'image/jpeg' },
      ]),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('sobe cada foto no bucket e devolve as URLs públicas na ordem', async () => {
    const service = new UploadsService();
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
    const service = new UploadsService();
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
    const service = new UploadsService();
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
    const service = new UploadsService();
    const storage = {
      createBucket: createBucketMock,
      upload: uploadMock,
      listBuckets: listBucketsMock,
    };
    return { service, storage, upload: uploadMock };
  }

  describe('uploadSelfiePonto', () => {
    it('cria o bucket de selfies como PRIVADO', async () => {
      // O rosto de uma pessoa amarrado ao CPF dela não pode ficar num bucket
      // que devolve URL pública, como o de fotos de checklist.
      const { service, storage } = servicoComStorageMockado();
      await service.uploadSelfiePonto('ponto-1', {
        buffer: Buffer.from('x'),
        mimetype: 'image/jpeg',
      });
      expect(storage.createBucket).toHaveBeenCalledWith(
        'ponto-selfies',
        expect.objectContaining({ public: false }),
      );
    });

    it('devolve a CHAVE, não uma URL', async () => {
      const { service } = servicoComStorageMockado();
      const chave = await service.uploadSelfiePonto('ponto-1', {
        buffer: Buffer.from('x'),
        mimetype: 'image/jpeg',
      });
      expect(chave).toBe('ponto-1/selfie.jpg');
      expect(chave).not.toMatch(/^https?:/);
    });

    it('sobrescreve o mesmo objeto no reenvio', async () => {
      // Caminho determinístico é o que torna o upload idempotente sem chave
      // de idempotência — mesmo truque do checklist.
      const { service, upload } = servicoComStorageMockado();
      await service.uploadSelfiePonto('ponto-1', {
        buffer: Buffer.from('a'),
        mimetype: 'image/jpeg',
      });
      await service.uploadSelfiePonto('ponto-1', {
        buffer: Buffer.from('b'),
        mimetype: 'image/jpeg',
      });
      expect(upload).toHaveBeenNthCalledWith(
        1,
        'ponto-1/selfie.jpg',
        expect.anything(),
        expect.objectContaining({ upsert: true }),
      );
      expect(upload).toHaveBeenNthCalledWith(
        2,
        'ponto-1/selfie.jpg',
        expect.anything(),
        expect.objectContaining({ upsert: true }),
      );
    });

    it('não deixa o pontoId escapar da pasta', async () => {
      const { service, upload } = servicoComStorageMockado();
      await service.uploadSelfiePonto('../../etc/passwd', {
        buffer: Buffer.from('x'),
        mimetype: 'image/jpeg',
      });
      const path = (upload.mock.calls[0] as string[])[0];
      expect(path).not.toContain('..');
    });
  });
});

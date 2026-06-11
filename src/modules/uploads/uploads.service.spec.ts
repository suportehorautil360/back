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

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ storage: { from: fromMock } })),
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
});

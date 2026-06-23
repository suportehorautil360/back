import { BadRequestException } from '@nestjs/common';
import { resolveUploadFolder, sanitizarPathSegmento } from './upload-path.helper';

describe('upload-path.helper', () => {
  it('usa checklistId quando informado', () => {
    expect(
      resolveUploadFolder({ checklistId: 'uuid-abc-123' }),
    ).toBe('uuid-abc-123');
  });

  it('monta pasta oficina + os', () => {
    expect(
      resolveUploadFolder({
        oficinaId: 'of-1',
        os: 'OS-2026-004',
      }),
    ).toBe('of-1/OS-2026-004');
  });

  it('exige checklistId ou oficinaId', () => {
    expect(() => resolveUploadFolder({})).toThrow(BadRequestException);
  });

  it('sanitiza caracteres inválidos', () => {
    expect(sanitizarPathSegmento('../hack')).toBe('-hack');
  });
});

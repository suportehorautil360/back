import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { RegistrarManualDto } from './registrar-manual.dto';

const CORPO_MINIMO = {
  storagePath: 'empresa-1/1737000000-abc.pdf',
  mimetype: 'application/pdf',
  tamanhoBytes: 40 * 1024 * 1024,
  titulo: 'Manual da PC200',
};

describe('RegistrarManualDto', () => {
  it('aceita o corpo mínimo válido', async () => {
    const dto = plainToInstance(RegistrarManualDto, CORPO_MINIMO);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('aceita categoria, equipamentoId, modelo e tipo quando presentes', async () => {
    const dto = plainToInstance(RegistrarManualDto, {
      ...CORPO_MINIMO,
      categoria: 'Elétrico',
      equipamentoId: 'eq-1',
      modelo: 'CAT 320D',
      tipo: 'Escavadeira',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  /**
   * Este é o piso que faltava um teste: sem ele, tirar o `@IsPositive()` do
   * campo deixava a suíte inteira verde — o service também ganhou o mesmo
   * piso, mas só o DTO protege quem entra pelo HTTP antes do `ValidationPipe`
   * chamar o service.
   */
  it('REJEITA tamanhoBytes zero, negativo ou NaN', async () => {
    for (const tamanhoBytes of [0, -1, -5 * 1024 * 1024, NaN]) {
      const dto = plainToInstance(RegistrarManualDto, { ...CORPO_MINIMO, tamanhoBytes });
      const erros = await validate(dto);
      expect(erros.some((e) => e.property === 'tamanhoBytes')).toBe(true);
    }
  });

  it('REJEITA storagePath vazio ou ausente', async () => {
    const { storagePath: _semUso, ...semStoragePath } = CORPO_MINIMO;
    const dto = plainToInstance(RegistrarManualDto, semStoragePath);
    const erros = await validate(dto);
    expect(erros.some((e) => e.property === 'storagePath')).toBe(true);
  });

  it('REJEITA titulo ausente', async () => {
    const { titulo: _semUso, ...semTitulo } = CORPO_MINIMO;
    const dto = plainToInstance(RegistrarManualDto, semTitulo);
    const erros = await validate(dto);
    expect(erros.some((e) => e.property === 'titulo')).toBe(true);
  });

  it('REJEITA mimetype ausente', async () => {
    const { mimetype: _semUso, ...semMimetype } = CORPO_MINIMO;
    const dto = plainToInstance(RegistrarManualDto, semMimetype);
    const erros = await validate(dto);
    expect(erros.some((e) => e.property === 'mimetype')).toBe(true);
  });
});

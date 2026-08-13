import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ChecklistLoginConfigDto } from './checklist-login-config.dto';

describe('ChecklistLoginConfigDto', () => {
  it('aceita cpfSenha=true, chassi=false', async () => {
    const dto = plainToInstance(ChecklistLoginConfigDto, {
      cpfSenha: true,
      chassi: false,
    });
    expect(await validate(dto)).toHaveLength(0);
  });
  it('aceita ambos true', async () => {
    const dto = plainToInstance(ChecklistLoginConfigDto, {
      cpfSenha: true,
      chassi: true,
    });
    expect(await validate(dto)).toHaveLength(0);
  });
  it('REJEITA ambos false', async () => {
    const dto = plainToInstance(ChecklistLoginConfigDto, {
      cpfSenha: false,
      chassi: false,
    });
    const erros = await validate(dto);
    expect(erros.length).toBeGreaterThan(0);
    expect(JSON.stringify(erros)).toMatch(/pelo menos um/i);
  });
  it('REJEITA valores não-booleanos', async () => {
    const dto = plainToInstance(ChecklistLoginConfigDto, {
      cpfSenha: 'sim',
      chassi: 1,
    });
    expect((await validate(dto)).length).toBeGreaterThan(0);
  });
});

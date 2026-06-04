import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AfdService } from './afd.service';
import { FirebaseService } from '../../config/firebase.service';

/** Mock do Firestore: roteia por nome de coleção. */
function makeFirebase(
  empresa: Record<string, unknown> | undefined,
  timeRecords: Record<string, unknown>[],
) {
  const collection = jest.fn((name: string) => {
    if (name === 'configuracoes') {
      return {
        doc: () => ({ get: async () => ({ data: () => ({ empresa }) }) }),
      };
    }
    // timeRecords
    return {
      where: () => ({
        get: async () => ({ docs: timeRecords.map((d) => ({ data: () => d })) }),
      }),
    };
  });
  return {
    getFirestore: () => ({ collection }),
  } as unknown as FirebaseService;
}

const config = { get: () => undefined } as unknown as ConfigService;

const empresaOk = { razaoSocial: 'ABC Ltda.', cnpj: '11.222.333/0001-81' };

describe('AfdService', () => {
  it('barra (400) quando o empregador está incompleto', async () => {
    const svc = new AfdService(makeFirebase({ razaoSocial: '' }, []), config);
    await expect(svc.gerar('pref-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('gera o AFD com as marcações original ordenadas por NSR', async () => {
    const svc = new AfdService(
      makeFirebase(empresaOk, [
        {
          registro: 'original',
          nsr: 2,
          timestampOriginal: '2026-05-25T18:00:00Z',
          cpf: '12345678901',
          createdAt: '2026-05-25T18:00:00Z',
        },
        {
          registro: 'original',
          nsr: 1,
          timestampOriginal: '2026-05-25T11:00:00Z',
          cpf: '12345678901',
          createdAt: '2026-05-25T11:00:00Z',
        },
        // ajuste deve ser ignorado no AFD (é tratamento → AEJ).
        {
          registro: 'ajuste',
          nsr: 3,
          timestampOriginal: '2026-05-25T12:00:00Z',
          cpf: '12345678901',
          createdAt: '2026-05-25T12:00:00Z',
        },
      ]),
      config,
    );

    const r = await svc.gerar('pref-1');
    expect(r.totalMarcacoes).toBe(2); // ajuste fora
    const linhas = r.conteudo.split('\r\n');
    expect(linhas[1].slice(0, 9)).toBe('000000001');
    expect(linhas[2].slice(0, 9)).toBe('000000002');
    expect(linhas[1][9]).toBe('7'); // tipo 7
  });

  it('filtra por período (de/ate) na data local da marcação', async () => {
    const svc = new AfdService(
      makeFirebase(empresaOk, [
        {
          registro: 'original',
          nsr: 1,
          timestampOriginal: '2026-05-10T11:00:00Z',
          cpf: '12345678901',
          createdAt: '2026-05-10T11:00:00Z',
        },
        {
          registro: 'original',
          nsr: 2,
          timestampOriginal: '2026-05-25T11:00:00Z',
          cpf: '12345678901',
          createdAt: '2026-05-25T11:00:00Z',
        },
      ]),
      config,
    );

    const r = await svc.gerar('pref-1', '2026-05-20', '2026-05-31');
    expect(r.totalMarcacoes).toBe(1);
  });
});

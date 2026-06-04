import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AejService } from './aej.service';
import { FirebaseService } from '../../config/firebase.service';

function makeFirebase(
  empresa: Record<string, unknown> | undefined,
  escala: Record<string, unknown> | null,
  timeRecords: Record<string, unknown>[],
) {
  const collection = jest.fn((name: string) => {
    if (name === 'configuracoes') {
      return {
        doc: () => ({ get: async () => ({ data: () => ({ empresa }) }) }),
      };
    }
    if (name === 'escalas') {
      return {
        where: () => ({
          get: async () => ({
            empty: !escala,
            docs: escala ? [{ data: () => escala }] : [],
          }),
        }),
      };
    }
    return {
      where: () => ({
        get: async () => ({ docs: timeRecords.map((d) => ({ data: () => d })) }),
      }),
    };
  });
  return { getFirestore: () => ({ collection }) } as unknown as FirebaseService;
}

const config = { get: () => undefined } as unknown as ConfigService;
const empresaOk = { razaoSocial: 'ABC Ltda.', cnpj: '11.222.333/0001-81' };
const escalaOk = { inicio: '08:00', fim: '18:00', almocoMinutos: 60 };

function orig(nsr: number, over: Record<string, unknown> = {}) {
  return {
    id: `o${nsr}`,
    registro: 'original',
    nsr,
    tipo: 'entrada',
    timestampOriginal: '2026-05-25T11:00:00Z',
    cpf: '12345678901',
    name: 'João',
    ...over,
  };
}

describe('AejService', () => {
  it('barra (400) quando o empregador está incompleto', async () => {
    const svc = new AejService(
      makeFirebase({ razaoSocial: '' }, null, []),
      config,
    );
    await expect(svc.gerar('pref-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('gera o AEJ com vínculo e horário contratual (tipo 04)', async () => {
    const svc = new AejService(
      makeFirebase(empresaOk, escalaOk, [orig(1)]),
      config,
    );
    const r = await svc.gerar('pref-1');
    const linhas = r.conteudo.split('\r\n');
    expect(linhas.some((l) => l.startsWith('03'))).toBe(true); // vínculo
    const h = linhas.find((l) => l.startsWith('04'))!.split('|');
    expect(h[1]).toBe('PADRAO');
    expect(h[2]).toBe('540'); // 10h − 60min almoço = 540 min
    expect(h[3]).toBe('0800');
    expect(h[4]).toBe('1800');
    expect(r.totalMarcacoes).toBe(1);
    expect(r.assinado).toBe(false);
  });

  it('filtra por período (de/ate)', async () => {
    const svc = new AejService(
      makeFirebase(empresaOk, null, [
        orig(1, { timestampOriginal: '2026-05-10T11:00:00Z' }),
        orig(2, { timestampOriginal: '2026-05-25T11:00:00Z' }),
      ]),
      config,
    );
    const r = await svc.gerar('pref-1', '2026-05-20', '2026-05-31');
    expect(r.totalMarcacoes).toBe(1);
  });
});

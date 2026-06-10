import { AlertasService, type FlagsAlertas } from './alertas.service';

/**
 * Firestore falso: cada coleção devolve os docs informados, ignorando o
 * `.where()` (os testes já passam só docs da prefeitura alvo).
 */
function makeFirebase(data: {
  equipamentos?: unknown[];
  operadores?: unknown[];
  tanks?: unknown[];
}) {
  const docsFor = (name: string) =>
    ((data as Record<string, unknown[]>)[name] ?? []).map((d) => ({
      data: () => d,
    }));
  const db = {
    collection: (name: string) => ({
      where: () => ({
        get: () => Promise.resolve({ docs: docsFor(name) }),
      }),
    }),
  };
  return { getFirestore: () => db } as never;
}

const mail = { habilitado: () => false, enviar: jest.fn() } as never;
const TODAS: FlagsAlertas = { revisao: true, cnh: true, tanque: true };

function emDias(dias: number): string {
  const d = new Date(Date.now() + dias * 86_400_000);
  return d.toISOString().slice(0, 10);
}

describe('AlertasService.coletar', () => {
  it('detecta revisão vencida (uso >= intervalo) e calcula o excedente', async () => {
    const fb = makeFirebase({
      equipamentos: [
        {
          prefeituraId: 'p1',
          descricao: 'Trator',
          placa: 'ABC-1234',
          medicaoAtual: 1200,
          ultimaRevisao: 0,
          intervaloRevisao: 1000,
          unidadeRevisao: 'h',
        },
        {
          prefeituraId: 'p1',
          descricao: 'Em dia',
          medicaoAtual: 500,
          ultimaRevisao: 0,
          intervaloRevisao: 1000,
        },
      ],
    });
    const r = await new AlertasService(fb, mail).coletar('p1', TODAS);
    expect(r.revisoes).toHaveLength(1);
    expect(r.revisoes[0].descricao).toBe('Trator');
    expect(r.revisoes[0].excedente).toBe(200);
  });

  it('ignora equipamento inativo', async () => {
    const fb = makeFirebase({
      equipamentos: [
        {
          prefeituraId: 'p1',
          status: 'inativo',
          medicaoAtual: 5000,
          ultimaRevisao: 0,
          intervaloRevisao: 1000,
        },
      ],
    });
    const r = await new AlertasService(fb, mail).coletar('p1', TODAS);
    expect(r.revisoes).toHaveLength(0);
  });

  it('detecta CNH a vencer em <= 30 dias e ignora as longe/sem CNH', async () => {
    const fb = makeFirebase({
      operadores: [
        {
          prefeituraId: 'p1',
          nome: 'João',
          cnhValidade: emDias(10),
          cnhCategoria: 'D',
        },
        { prefeituraId: 'p1', nome: 'Vencida', cnhValidade: emDias(-5) },
        { prefeituraId: 'p1', nome: 'Longe', cnhValidade: emDias(200) },
        { prefeituraId: 'p1', nome: 'SemCnh' },
      ],
    });
    const r = await new AlertasService(fb, mail).coletar('p1', TODAS);
    expect(r.cnhs.map((c) => c.nome).sort()).toEqual(['João', 'Vencida']);
  });

  it('detecta tanque <= 20% e calcula o percentual', async () => {
    const fb = makeFirebase({
      tanks: [
        { prefeituraId: 'p1', name: 'T1', capacity: 1000, currentVolume: 150 },
        { prefeituraId: 'p1', name: 'T2', capacity: 1000, currentVolume: 800 },
      ],
    });
    const r = await new AlertasService(fb, mail).coletar('p1', TODAS);
    expect(r.tanques.map((t) => t.nome)).toEqual(['T1']);
    expect(r.tanques[0].percentual).toBe(15);
  });

  it('respeita as flags desligadas', async () => {
    const fb = makeFirebase({
      tanks: [
        { prefeituraId: 'p1', name: 'T1', capacity: 1000, currentVolume: 50 },
      ],
    });
    const r = await new AlertasService(fb, mail).coletar('p1', {
      revisao: true,
      cnh: true,
      tanque: false,
    });
    expect(r.tanques).toHaveLength(0);
  });
});

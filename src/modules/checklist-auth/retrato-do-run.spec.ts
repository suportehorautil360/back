/**
 * O retrato das perguntas, no caminho do login por CHASSI.
 *
 * `checklist_runs` guardava as respostas mas não a lista de itens, e a
 * auditoria reconstruía o enunciado pela `ChecklistDefinition` de mesma
 * categoria na hora de exibir. Como `respostas` é chaveado por POSIÇÃO,
 * inserir um item no meio da definição deslocava todas as respostas
 * seguintes — o "não" de "Freios" aparecendo sob "Espelhos".
 *
 * Este é o caminho do operador sem credencial (o chassi identifica uma
 * máquina, não uma pessoa). O outro caminho, com sessão, grava por PostgREST.
 * Os dois precisam gravar o retrato: metade das execuções perderia o
 * documento, e perderia em silêncio.
 */
import { ChecklistChassiService } from './checklist-chassi.service';

const RETRATO = [
  { ordem: 1, texto: 'Freios testados', severidade: 'impeditivo' },
  { ordem: 2, texto: 'Espelhos limpos', severidade: 'normal' },
];

/** O que este arquivo precisa enxergar do `upsert` — o resto não importa. */
type UpsertDoRun = {
  create: { itens?: unknown; definitionLegacyId?: string | null };
  update: { itens?: unknown; definitionLegacyId?: string | null };
};

function servico() {
  const upsert = jest.fn((args: UpsertDoRun) => {
    void args;
    return Promise.resolve({});
  });
  const prisma = {
    // O serviço confere que o chassi é da empresa antes de gravar — sem
    // equipamento, nem chega ao upsert que este arquivo prova.
    equipment: {
      findFirst: jest.fn(() =>
        Promise.resolve({
          id: '22222222-2222-2222-2222-222222222222',
          chassi: 'ESC-014',
          companyId: '11111111-1111-1111-1111-111111111111',
        }),
      ),
    },
    checklistRun: { upsert },
    company: {
      findFirst: jest.fn(() =>
        Promise.resolve({
          id: '11111111-1111-1111-1111-111111111111',
          legacyId: null,
        }),
      ),
    },
  };
  return {
    servico: new ChecklistChassiService(prisma as never),
    upsert,
  };
}

function dto(extra: Record<string, unknown> = {}) {
  return {
    id: '33333333-3333-3333-3333-333333333333',
    prefeituraId: '11111111-1111-1111-1111-111111111111',
    operador: 'Jefferson',
    chassis: 'ESC-014',
    categoria: 'Escavadeira',
    respostas: { '1': { v: 'nao' }, '2': { v: 'sim' } },
    dataHoraIso: '2026-09-11T12:00:00.000Z',
    ...extra,
  } as never;
}

describe('ChecklistChassiService.salvarChecklistRun — retrato', () => {
  it('grava as perguntas junto com as respostas', async () => {
    const { servico: s, upsert } = servico();

    await s.salvarChecklistRun(dto({ itens: RETRATO }));

    expect(upsert.mock.calls[0][0].create.itens).toEqual(RETRATO);
  });

  it('grava qual documento foi preenchido', async () => {
    const { servico: s, upsert } = servico();

    await s.salvarChecklistRun(dto({ definitionLegacyId: 'escavadeira' }));

    expect(upsert.mock.calls[0][0].create.definitionLegacyId).toBe(
      'escavadeira',
    );
  });

  /**
   * O reenvio é normal: o id nasce no aparelho e o envio se repete quando a
   * rede volta. O update tem de carregar o retrato também — senão a primeira
   * gravação o guarda e a segunda o deixa para trás.
   */
  it('o reenvio atualiza o retrato, não só a primeira gravação', async () => {
    const { servico: s, upsert } = servico();

    await s.salvarChecklistRun(dto({ itens: RETRATO }));

    expect(upsert.mock.calls[0][0].update.itens).toEqual(RETRATO);
  });

  /**
   * Um app antigo, que ainda não manda `itens`, não pode APAGAR o retrato de
   * uma execução já gravada — é justamente o dado que não dá para recuperar
   * depois. `undefined` deixa a coluna como está; `null` a zeraria.
   */
  it('app antigo sem retrato não apaga o que já foi gravado', async () => {
    const { servico: s, upsert } = servico();

    await s.salvarChecklistRun(dto());

    expect(upsert.mock.calls[0][0].create.itens).toBeUndefined();
  });
});

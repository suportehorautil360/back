import { especificidade, ordenarParaMaquina, serveAMaquina } from './manual';

const escavadeira = { id: 'eq-1', modelo: 'CAT 320D', tipo: 'Escavadeira' };
const manual = (p: Partial<Parameters<typeof especificidade>[0]> = {}) => ({
  equipmentId: null,
  modelo: null,
  tipo: null,
  ...p,
});

describe('especificidade', () => {
  it('manual daquela máquina é o mais específico', () => {
    expect(especificidade(manual({ equipmentId: 'eq-1' }), escavadeira)).toBe(3);
  });

  it('manual do modelo vem depois', () => {
    expect(especificidade(manual({ modelo: 'CAT 320D' }), escavadeira)).toBe(2);
  });

  it('manual do tipo vem depois do modelo', () => {
    expect(especificidade(manual({ tipo: 'Escavadeira' }), escavadeira)).toBe(1);
  });

  it('sem vínculo, vale para a frota inteira', () => {
    expect(especificidade(manual(), escavadeira)).toBe(0);
  });

  it('manual de OUTRA máquina não serve', () => {
    expect(especificidade(manual({ equipmentId: 'eq-9' }), escavadeira)).toBeNull();
    expect(serveAMaquina(manual({ modelo: 'CAT 950' }), escavadeira)).toBe(false);
  });

  it('vínculo de máquina manda mesmo com modelo preenchido', () => {
    // Preso a uma máquina é preso a ela, ponto — senão o manual "daquela"
    // escavadeira apareceria em todas as do mesmo modelo.
    const preso = manual({ equipmentId: 'eq-9', modelo: 'CAT 320D' });
    expect(especificidade(preso, escavadeira)).toBeNull();
  });

  it('compara ignorando caixa e espaço', () => {
    expect(especificidade(manual({ modelo: '  cat 320d ' }), escavadeira)).toBe(2);
  });

  it('máquina sem modelo não casa manual de modelo', () => {
    expect(especificidade(manual({ modelo: 'CAT 320D' }), { ...escavadeira, modelo: null })).toBeNull();
  });
});

describe('ordenarParaMaquina', () => {
  it('do mais específico para o mais geral', () => {
    // É a ordem em que o mecânico quer encontrar: o manual da máquina dele
    // antes do procedimento geral da frota.
    const lista = [
      { titulo: 'Procedimento geral', ...manual() },
      { titulo: 'Manual do modelo', ...manual({ modelo: 'CAT 320D' }) },
      { titulo: 'Manual desta máquina', ...manual({ equipmentId: 'eq-1' }) },
      { titulo: 'De outra máquina', ...manual({ equipmentId: 'eq-9' }) },
    ];

    expect(ordenarParaMaquina(lista, escavadeira).map((m) => m.titulo)).toEqual([
      'Manual desta máquina',
      'Manual do modelo',
      'Procedimento geral',
    ]);
  });

  it('empate desempata pelo título, para a lista não dançar', () => {
    const lista = [
      { titulo: 'Zelador', ...manual() },
      { titulo: 'Abastecimento', ...manual() },
    ];

    expect(ordenarParaMaquina(lista, escavadeira).map((m) => m.titulo)).toEqual([
      'Abastecimento',
      'Zelador',
    ]);
  });
});

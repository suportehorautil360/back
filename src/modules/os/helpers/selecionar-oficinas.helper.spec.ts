import type { OficinaAtiva } from '../os.types';

import {

  filtrarOficinasElegiveis,

  selecionarOficinas,

} from './selecionar-oficinas.helper';



const oficinas: OficinaAtiva[] = [

  { id: '1', nome: 'A', especialidade: 'Amarela' },

  { id: '2', nome: 'B', especialidade: 'Amarela' },

  { id: '3', nome: 'C', especialidade: 'Amarela' },

  { id: '4', nome: 'D', especialidade: 'Amarela' },

  { id: '5', nome: 'E', especialidade: 'Pesada' },

];



describe('filtrarOficinasElegiveis', () => {

  it('retorna vazio quando não há oficinas', () => {

    expect(filtrarOficinasElegiveis([], 'Amarela')).toEqual([]);

  });



  it('filtra por linha sem fallback', () => {

    const result = filtrarOficinasElegiveis(oficinas, 'Amarela');

    expect(result).toHaveLength(4);

    expect(result.every((o) => o.especialidade === 'Amarela')).toBe(true);

  });



  it('retorna vazio quando linha não tem match', () => {

    expect(filtrarOficinasElegiveis(oficinas, 'Verde')).toEqual([]);

  });



  it('filtra por segmento e linha', () => {

    const pool = [

      {

        id: '1',

        nome: 'A',

        especialidade: 'Amarela',

        segmentosAtuacao: ['Carro leve'],

      },

      {

        id: '2',

        nome: 'B',

        especialidade: 'Amarela',

        segmentosAtuacao: ['Máquinas linha amarela'],

      },

      {

        id: '3',

        nome: 'C',

        especialidade: 'Amarela',

        segmentosAtuacao: ['Máquinas linha amarela'],

      },

    ];

    const result = filtrarOficinasElegiveis(

      pool,

      'Amarela',

      'Máquinas linha amarela',

    );

    expect(result.map((o) => o.id)).toEqual(['2', '3']);

  });



  it('exclui oficina sem segmento quando equipamento tem segmento', () => {

    const pool = [

      { id: '1', nome: 'A', especialidade: 'Amarela' },

      {

        id: '2',

        nome: 'B',

        especialidade: 'Amarela',

        segmentosAtuacao: ['Máquinas linha amarela'],

      },

    ];

    expect(

      filtrarOficinasElegiveis(pool, 'Amarela', 'Máquinas linha amarela'),

    ).toEqual([pool[1]]);

  });

});



describe('selecionarOficinas', () => {

  it('retorna vazio quando não há oficinas', () => {

    expect(selecionarOficinas([], 'Amarela')).toEqual([]);

  });



  it('sem max retorna todas as compatíveis', () => {
    const result = selecionarOficinas(oficinas, 'Amarela');
    expect(result).toHaveLength(4);
    expect(result.every((o) => o.especialidade === 'Amarela')).toBe(true);
  });

  it('limita quando max informado', () => {

    const result = selecionarOficinas(oficinas, 'Amarela', 3);

    expect(result).toHaveLength(3);

    expect(result.every((o) => o.especialidade === 'Amarela')).toBe(true);

  });



  it('retorna 1 oficina quando só há uma compatível', () => {

    const result = selecionarOficinas(oficinas, 'Pesada', 3);

    expect(result).toHaveLength(1);

    expect(result[0].id).toBe('5');

  });



  it('retorna vazio quando linha não tem match', () => {

    expect(selecionarOficinas(oficinas, 'Verde', 3)).toEqual([]);

  });



  it('sorteia apenas entre oficinas do segmento', () => {

    const pool = [

      {

        id: '1',

        nome: 'A',

        especialidade: 'Amarela',

        segmentosAtuacao: ['Carro leve'],

      },

      {

        id: '2',

        nome: 'B',

        especialidade: 'Amarela',

        segmentosAtuacao: ['Máquinas linha amarela'],

      },

      {

        id: '3',

        nome: 'C',

        especialidade: 'Amarela',

        segmentosAtuacao: ['Máquinas linha amarela'],

      },

      {

        id: '4',

        nome: 'D',

        especialidade: 'Amarela',

        segmentosAtuacao: ['Máquinas linha amarela'],

      },

    ];

    const result = selecionarOficinas(pool, 'Amarela', 3, 'Máquinas linha amarela');

    expect(

      result.every((o) =>

        o.segmentosAtuacao?.includes('Máquinas linha amarela'),

      ),

    ).toBe(true);

  });

});


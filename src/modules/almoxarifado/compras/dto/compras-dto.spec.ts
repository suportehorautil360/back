import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import { MotivoDto } from './motivo.dto';
import { CriarOrdemDto, EditarOrdemDto, SubstituirItensDto } from './ordem-compra.dto';
import { CriarSolicitacaoDto } from './solicitacao-compra.dto';

// `IsUUID()` exige o nibble de variante RFC4122 — ver `entrada.dto.spec.ts`.
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';

/** Caminho de cada campo recusado, inclusive dentro de listas ("itens.0.quantidade"). */
async function recusados(classe: new () => object, corpo: object): Promise<string[]> {
  const caminhos = (erros: ValidationError[], prefixo = ''): string[] =>
    erros.flatMap((e) => [
      ...(e.constraints ? [`${prefixo}${e.property}`] : []),
      ...caminhos(e.children ?? [], `${prefixo}${e.property}.`),
    ]);
  return caminhos(await validate(plainToInstance(classe, corpo)));
}

describe('CriarSolicitacaoDto', () => {
  const valido = () => ({
    depositoId: U1, prioridade: 'alta', justificativa: 'Reposição da oficina volante',
    itens: [{ pecaId: U2, quantidade: 2.5 }],
  });

  it('aceita o corpo válido', async () => {
    expect(await recusados(CriarSolicitacaoDto, valido())).toEqual([]);
  });

  it('recusa prioridade de reposição (é da automática) e justificativa curta', async () => {
    expect(await recusados(CriarSolicitacaoDto, { ...valido(), prioridade: 'reposicao' })).toContain('prioridade');
    expect(await recusados(CriarSolicitacaoDto, { ...valido(), justificativa: 'ab' })).toContain('justificativa');
  });

  it('recusa lista de itens vazia', async () => {
    expect(await recusados(CriarSolicitacaoDto, { ...valido(), itens: [] })).toContain('itens');
  });

  it('recusa quantidade zero, negativa, com 4 casas ou em string, e peça que não é UUID', async () => {
    for (const quantidade of [0, -1, 1.2345, '5']) {
      expect(await recusados(CriarSolicitacaoDto, { ...valido(), itens: [{ pecaId: U2, quantidade }] }))
        .toContain('itens.0.quantidade');
    }
    expect(await recusados(CriarSolicitacaoDto, { ...valido(), itens: [{ pecaId: 'x', quantidade: 1 }] }))
      .toContain('itens.0.pecaId');
  });
});

describe('MotivoDto', () => {
  it('exige de 3 a 500 caracteres', async () => {
    expect(await recusados(MotivoDto, { motivo: 'Fornecedor sem estoque' })).toEqual([]);
    expect(await recusados(MotivoDto, { motivo: 'ab' })).toContain('motivo');
    expect(await recusados(MotivoDto, { motivo: 'a'.repeat(501) })).toContain('motivo');
    expect(await recusados(MotivoDto, {})).toContain('motivo');
  });
});

describe('CriarOrdemDto', () => {
  it('aceita o mínimo e a data ISO válida', async () => {
    expect(await recusados(CriarOrdemDto, { partnerId: U1, depositoId: U2 })).toEqual([]);
    expect(await recusados(CriarOrdemDto, { partnerId: U1, depositoId: U2, previsaoEntrega: '2026-09-30' })).toEqual([]);
  });

  it('recusa data que não existe no calendário e fornecedor que não é UUID', async () => {
    expect(await recusados(CriarOrdemDto, { partnerId: U1, depositoId: U2, previsaoEntrega: '2026-02-30' }))
      .toContain('previsaoEntrega');
    expect(await recusados(CriarOrdemDto, { partnerId: 'x', depositoId: U2 })).toContain('partnerId');
  });
});

describe('EditarOrdemDto', () => {
  it('aceita corpo vazio e null explícito nos campos que a coluna aceita nulos', async () => {
    expect(await recusados(EditarOrdemDto, {})).toEqual([]);
    expect(await recusados(EditarOrdemDto, { condicaoPagamento: null, previsaoEntrega: null, observacao: null })).toEqual([]);
  });

  it('recusa partnerId null — a coluna é NOT NULL', async () => {
    expect(await recusados(EditarOrdemDto, { partnerId: null })).toContain('partnerId');
  });
});

describe('SubstituirItensDto', () => {
  const linha = (extra: object = {}) => ({
    pecaId: U1, valorUnit: 12.5, origens: [{ solicitacaoCompraItemId: U2, quantidade: 2 }], ...extra,
  });

  it('aceita lista vazia (limpa o rascunho) e a linha válida', async () => {
    expect(await recusados(SubstituirItensDto, { itens: [] })).toEqual([]);
    expect(await recusados(SubstituirItensDto, { itens: [linha()] })).toEqual([]);
  });

  it('recusa valor unitário negativo ou com 5 casas', async () => {
    expect(await recusados(SubstituirItensDto, { itens: [linha({ valorUnit: -0.01 })] })).toContain('itens.0.valorUnit');
    expect(await recusados(SubstituirItensDto, { itens: [linha({ valorUnit: 1.23456 })] })).toContain('itens.0.valorUnit');
  });

  it('recusa linha sem origem e origem com quantidade zero', async () => {
    expect(await recusados(SubstituirItensDto, { itens: [linha({ origens: [] })] })).toContain('itens.0.origens');
    expect(
      await recusados(SubstituirItensDto, {
        itens: [linha({ origens: [{ solicitacaoCompraItemId: U2, quantidade: 0 }] })],
      }),
    ).toContain('itens.0.origens.0.quantidade');
  });
});

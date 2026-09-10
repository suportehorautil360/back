/**
 * A API do 360 legado fala do plano ÚNICO da prefeitura.
 *
 * O plano passou a ser um por MODELO de máquina (migration
 * `20260910120000_plano_preventivo_por_modelo`), e a migration reetiquetou o
 * plano único de cada empresa como "Geral". Estes testes prendem esse
 * endereço: apontar para outro lugar faria o portal legado abrir vazio numa
 * empresa que sempre teve plano.
 */
import { NotFoundException } from '@nestjs/common';

import { PlanosPreventivosService } from './planos-preventivos.service';

const findUnique = jest.fn();
const upsert = jest.fn();
const findFirstCliente = jest.fn();

function servico() {
  const prisma = {
    planoPreventivo: { findUnique, upsert },
    cliente: { findFirst: findFirstCliente, findUnique: findFirstCliente },
    company: { findFirst: findFirstCliente, findUnique: findFirstCliente },
  };
  return new PlanosPreventivosService(prisma as never);
}

const COMPANY_ID = '11111111-1111-1111-1111-111111111111';
const PREFEITURA = 'rio-claro';

beforeEach(() => {
  jest.clearAllMocks();
  findFirstCliente.mockResolvedValue({ id: COMPANY_ID, companyId: COMPANY_ID });
  findUnique.mockResolvedValue(null);
  upsert.mockResolvedValue({
    categorias: [],
    updatedAt: new Date('2026-09-10T12:00:00Z'),
  });
});

describe('PlanosPreventivosService — o plano legado é o modelo "Geral"', () => {
  it('lê pela chave composta, no modelo Geral', async () => {
    findUnique.mockResolvedValue({
      categorias: [],
      updatedAt: new Date('2026-09-10T12:00:00Z'),
    });

    await servico().obter(PREFEITURA);

    expect(findUnique).toHaveBeenCalledWith({
      where: { companyId_modelo: { companyId: COMPANY_ID, modelo: 'Geral' } },
    });
  });

  it('grava no mesmo endereço, criando com o modelo preenchido', async () => {
    await servico().restaurarPadrao(PREFEITURA);

    const arg = upsert.mock.calls[0][0];
    expect(arg.where).toEqual({
      companyId_modelo: { companyId: COMPANY_ID, modelo: 'Geral' },
    });
    // `modelo` é obrigatório na criação — sem ele o upsert só falharia na
    // empresa que ainda não tem plano, que é o caminho menos exercitado.
    expect(arg.create.modelo).toBe('Geral');
  });

  it('empresa sem plano continua devolvendo 404, e não um plano vazio', async () => {
    await expect(servico().obter(PREFEITURA)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

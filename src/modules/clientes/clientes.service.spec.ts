import { NotFoundException } from '@nestjs/common';
import { ClientesService } from './clientes.service';
import { FirebaseService } from '../../config/firebase.service';
import { ChecklistLoginConfigDto } from './dto/checklist-login-config.dto';

interface FirestoreStub {
  docExists?: boolean;
  updateMock?: jest.Mock;
  getMock?: jest.Mock;
}

function makeFirestore({
  docExists = true,
  updateMock = jest.fn().mockResolvedValue(undefined),
  getMock = jest.fn(),
}: FirestoreStub = {}) {
  const firebase = {
    getFirestore: () => ({
      collection: (name: string) => {
        if (name === 'clientes') {
          return {
            doc: jest.fn(() => ({
              get: getMock.mockResolvedValue({
                exists: docExists,
                data: () => ({ id: 'cli_1', nome: 'Cliente Teste' }),
              }),
              update: updateMock,
            })),
          };
        }
        return {};
      },
    }),
  } as unknown as FirebaseService;

  return { firebase, updateMock, getMock };
}

beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe('ClientesService.atualizarChecklistLoginConfig', () => {
  it('faz update no doc do cliente com o campo checklistLogin', async () => {
    const { firebase, updateMock } = makeFirestore();
    const service = new ClientesService(firebase);
    const dto: ChecklistLoginConfigDto = { cpfSenha: true, chassi: true };

    await service.atualizarChecklistLoginConfig('cli_1', dto);

    expect(updateMock).toHaveBeenCalledWith({
      checklistLogin: { cpfSenha: true, chassi: true },
    });
  });

  it('lança NotFoundException se o documento não existe', async () => {
    const { firebase } = makeFirestore({ docExists: false });
    const service = new ClientesService(firebase);
    const dto: ChecklistLoginConfigDto = { cpfSenha: true, chassi: false };

    await expect(
      service.atualizarChecklistLoginConfig('naoExiste', dto),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejeita com NotFoundException se cliente não é encontrado (mesma coisa)', async () => {
    const { firebase } = makeFirestore({
      docExists: false,
    });
    const service = new ClientesService(firebase);
    const dto: ChecklistLoginConfigDto = { cpfSenha: true, chassi: false };

    await expect(
      service.atualizarChecklistLoginConfig('id_fantasma', dto),
    ).rejects.toThrow(NotFoundException);
  });
});

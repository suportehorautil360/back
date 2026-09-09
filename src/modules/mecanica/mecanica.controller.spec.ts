import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MecanicaController } from './mecanica.controller';
import type {
  PainelPayload,
  RequestComPainel,
} from '../../common/painel.guard';
import type { MecanicaService } from './mecanica.service';
import type { UploadsService } from '../uploads/uploads.service';

const PAINEL: PainelPayload = {
  companyUserId: 'user-1',
  companyId: 'empresa-1',
  operatorId: 'op-1',
  companyRoleId: 'cargo-1',
  nomeExibicao: 'Carlos Mecânico',
};

function reqCom(painel: PainelPayload = PAINEL): RequestComPainel {
  return { painel } as RequestComPainel;
}

function servicoFalso(
  overrides: Partial<Record<keyof MecanicaService, unknown>> = {},
) {
  return {
    listarBancada: jest.fn().mockResolvedValue([]),
    detalhe: jest.fn().mockResolvedValue({ id: 'os-1' }),
    adicionarFoto: jest.fn().mockResolvedValue({ id: 'foto-1' }),
    ...overrides,
  } as unknown as MecanicaService;
}

function uploadsFalso(
  overrides: Partial<Record<keyof UploadsService, unknown>> = {},
) {
  return {
    uploadOsFoto: jest
      .fn()
      .mockResolvedValue('https://cdn.exemplo/os-fotos/os-1/foto.jpg'),
    ...overrides,
  } as unknown as UploadsService;
}

function arquivo(
  overrides: Partial<Express.Multer.File> = {},
): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'foto.jpg',
    encoding: '7bit',
    mimetype: 'image/jpeg',
    size: 1024,
    buffer: Buffer.from('conteudo-fake'),
    destination: '',
    filename: '',
    path: '',
    stream: undefined as never,
    ...overrides,
  };
}

/**
 * Achado C2 da revisão final: o controller só lia `?minhas` — `?situacao`
 * chegava e era descartado em silêncio, e o painel (que chama
 * `/mecanica/os?situacao=Concluida` para o Histórico) recebia a mesma lista
 * da Bancada. Estes testes exercitam o CONTROLLER, não só o service: uma
 * regressão que voltasse a ignorar `?situacao` no controller não derrubaria
 * teste nenhum se a prova ficasse só no service.
 */
describe('MecanicaController.bancada — repasse de ?situacao', () => {
  it('repassa a situacao pedida para o service', async () => {
    const service = servicoFalso();
    const controller = new MecanicaController(service, uploadsFalso());

    await controller.bancada(reqCom(), undefined, 'Concluida');

    expect(service.listarBancada).toHaveBeenCalledWith(
      PAINEL,
      false,
      'Concluida',
    );
  });

  it('sem `?situacao`, repassa undefined — a Bancada continua trazendo tudo', async () => {
    const service = servicoFalso();
    const controller = new MecanicaController(service, uploadsFalso());

    await controller.bancada(reqCom());

    expect(service.listarBancada).toHaveBeenCalledWith(
      PAINEL,
      false,
      undefined,
    );
  });

  it('rejeita situacao fora da lista — nem filtro silencioso, nem 500', async () => {
    const service = servicoFalso();
    const controller = new MecanicaController(service, uploadsFalso());

    await expect(
      controller.bancada(reqCom(), undefined, 'lixo'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.listarBancada).not.toHaveBeenCalled();
  });

  it('aceita as três situações válidas', async () => {
    const service = servicoFalso();
    const controller = new MecanicaController(service, uploadsFalso());

    for (const situacao of ['Aberta', 'EmAndamento', 'Concluida']) {
      await controller.bancada(reqCom(), undefined, situacao);
    }

    expect(service.listarBancada).toHaveBeenCalledTimes(3);
  });
});

/**
 * `uploadFoto` é a rota nova: sobe o arquivo pro Storage e grava o
 * ServiceOrderFoto na MESMA chamada. Os testes abaixo provam, nesta ordem:
 * tipo de arquivo, tamanho, posse da OS (antes do upload — pra não deixar
 * arquivo órfão no Storage quando a OS é inválida) e o caminho feliz.
 */
describe('MecanicaController.uploadFoto', () => {
  it('recusa sem arquivo', async () => {
    const service = servicoFalso();
    const uploads = uploadsFalso();
    const controller = new MecanicaController(service, uploads);

    await expect(
      controller.uploadFoto(reqCom(), 'os-1', undefined as never, undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.detalhe).not.toHaveBeenCalled();
    expect(uploads.uploadOsFoto).not.toHaveBeenCalled();
  });

  it('recusa arquivo que não é imagem', async () => {
    const service = servicoFalso();
    const uploads = uploadsFalso();
    const controller = new MecanicaController(service, uploads);

    await expect(
      controller.uploadFoto(
        reqCom(),
        'os-1',
        arquivo({ mimetype: 'application/pdf' }),
        undefined,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.detalhe).not.toHaveBeenCalled();
    expect(uploads.uploadOsFoto).not.toHaveBeenCalled();
  });

  it('recusa arquivo maior que o limite de negócio', async () => {
    const service = servicoFalso();
    const uploads = uploadsFalso();
    const controller = new MecanicaController(service, uploads);

    await expect(
      controller.uploadFoto(
        reqCom(),
        'os-1',
        arquivo({ size: 6 * 1024 * 1024 }),
        undefined,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.detalhe).not.toHaveBeenCalled();
    expect(uploads.uploadOsFoto).not.toHaveBeenCalled();
  });

  /**
   * A checagem de posse (via `service.detalhe`, o mesmo caminho que toda
   * escrita do módulo usa) tem que rodar ANTES do upload pro Storage. Se a
   * ordem se inverter, uma OS de outra empresa ou de pregão só seria barrada
   * DEPOIS de o arquivo já estar salvo no bucket — arquivo órfão, que é
   * exatamente o problema de fazer em duas chamadas separadas, só que dentro
   * de uma única rota.
   */
  it('recusa upload em OS de outra empresa/pregão SEM subir o arquivo', async () => {
    const service = servicoFalso({
      detalhe: jest
        .fn()
        .mockRejectedValue(new NotFoundException('OS não encontrada.')),
    });
    const uploads = uploadsFalso();
    const controller = new MecanicaController(service, uploads);

    await expect(
      controller.uploadFoto(
        reqCom(),
        'os-de-outra-empresa',
        arquivo(),
        undefined,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(uploads.uploadOsFoto).not.toHaveBeenCalled();
  });

  it('sobe o arquivo e grava a foto com a URL devolvida pelo Storage', async () => {
    const service = servicoFalso();
    const uploads = uploadsFalso({
      uploadOsFoto: jest
        .fn()
        .mockResolvedValue('https://cdn.exemplo/os-fotos/os-1/x.jpg'),
    });
    const controller = new MecanicaController(service, uploads);
    const foto = arquivo({ mimetype: 'image/png' });

    const resultado = await controller.uploadFoto(
      reqCom(),
      'os-1',
      foto,
      '  antes do reparo  ',
    );

    expect(service.detalhe).toHaveBeenCalledWith(PAINEL, 'os-1');
    expect(uploads.uploadOsFoto).toHaveBeenCalledWith('os-1', {
      buffer: foto.buffer,
      mimetype: 'image/png',
    });
    expect(service.adicionarFoto).toHaveBeenCalledWith(
      PAINEL,
      'os-1',
      'https://cdn.exemplo/os-fotos/os-1/x.jpg',
      'antes do reparo',
    );
    expect(resultado).toEqual({ id: 'foto-1' });
  });

  it('sem legenda, grava com legenda nula', async () => {
    const service = servicoFalso();
    const uploads = uploadsFalso();
    const controller = new MecanicaController(service, uploads);

    await controller.uploadFoto(reqCom(), 'os-1', arquivo(), undefined);

    expect(service.adicionarFoto).toHaveBeenCalledWith(
      PAINEL,
      'os-1',
      expect.any(String),
      null,
    );
  });
});

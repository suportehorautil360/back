import { INestApplication, ValidationPipe, NotFoundException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { ChecklistAuthController } from '../src/modules/checklist-auth/checklist-auth.controller';
import { ChecklistChassiService } from '../src/modules/checklist-auth/checklist-chassi.service';

describe('ChecklistAuthController (e2e)', () => {
  let app: INestApplication<App>;

  const resolverChassi = jest.fn();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [ChecklistAuthController],
      providers: [
        {
          provide: ChecklistChassiService,
          useValue: { resolverChassi },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /checklist/resolver-chassi', () => {
    it('should return 200 with empresa/máquina data on valid chassi', async () => {
      resolverChassi.mockResolvedValue({
        empresaId: 'empresa-1',
        empresaNome: 'Empresa Teste',
        idMaquina: 'maquina-1',
        chassi: 'ABC123DEF456',
      });

      const res = await request(app.getHttpServer())
        .post('/checklist/resolver-chassi')
        .send({ chassi: 'ABC123DEF456' })
        .expect(200);

      expect(res.body.empresaId).toBe('empresa-1');
      expect(res.body.empresaNome).toBe('Empresa Teste');
      expect(res.body.idMaquina).toBe('maquina-1');
      expect(res.body.chassi).toBe('ABC123DEF456');
      expect(resolverChassi).toHaveBeenCalledWith('ABC123DEF456');
    });

    it('should return 404 when chassi is not found', async () => {
      resolverChassi.mockRejectedValue(
        new NotFoundException('Chassi não encontrado.'),
      );

      await request(app.getHttpServer())
        .post('/checklist/resolver-chassi')
        .send({ chassi: 'INVALIDO123' })
        .expect(404);
    });

    it('should return 409 when chassi is linked to multiple companies', async () => {
      resolverChassi.mockRejectedValue(
        new ConflictException('Chassi vinculado a múltiplas empresas com login habilitado.'),
      );

      await request(app.getHttpServer())
        .post('/checklist/resolver-chassi')
        .send({ chassi: 'ABC123DEF456' })
        .expect(409);
    });

    it('should return 400 when chassi is missing', async () => {
      await request(app.getHttpServer())
        .post('/checklist/resolver-chassi')
        .send({})
        .expect(400);
    });

    it('should return 400 when chassi is not a string', async () => {
      await request(app.getHttpServer())
        .post('/checklist/resolver-chassi')
        .send({ chassi: 123 })
        .expect(400);
    });
  });
});

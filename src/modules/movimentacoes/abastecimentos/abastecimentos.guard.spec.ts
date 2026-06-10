import { BadRequestException } from '@nestjs/common';
import { AbastecimentosService } from './abastecimentos.service';
import type { CreateAbastecimentoDto } from './dto/create-abastecimento.dto';

// O guard roda ANTES de tocar o Firestore, então um stub vazio basta.
const firebase = { getFirestore: () => ({}) } as never;

function dto(
  over: Partial<CreateAbastecimentoDto> = {},
): CreateAbastecimentoDto {
  return {
    prefeituraId: 'p1',
    plateOrChassis: 'ABC-1234',
    liters: 10,
    measurementType: 'horimetro',
    currentReading: 5,
    latitude: 0,
    longitude: 0,
    ...over,
  };
}

describe('AbastecimentosService.create — guard de obrigatórios', () => {
  const svc = new AbastecimentosService(firebase);

  it('rejeita litros <= 0', async () => {
    await expect(svc.create(dto({ liters: 0 }))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejeita sem placa/chassi', async () => {
    await expect(
      svc.create(dto({ plateOrChassis: '' })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita sem leitura válida', async () => {
    await expect(
      svc.create(dto({ currentReading: undefined as unknown as number })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

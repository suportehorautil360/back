import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { creditarTanquePrisma } from '../../../common/prisma/tank-saldo-prisma.helper';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateFuelEntryDto } from '../dto/create-fuel-entry.dto';

@Injectable()
export class FuelEntriesService {
  constructor(private readonly prisma: PrismaService) {}

  async createEntry(createDto: CreateFuelEntryDto) {
    const volume = Number(createDto.volume);
    if (!Number.isFinite(volume) || volume <= 0) {
      throw new BadRequestException('Volume inválido.');
    }

    await creditarTanquePrisma(this.prisma, createDto.tankId, volume);

    return { success: true, id: randomUUID() };
  }
}

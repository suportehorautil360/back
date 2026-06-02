import { PartialType } from '@nestjs/swagger';
import { CreateEquipamentoDto } from './create-equipamento.dto';

/** Atualização parcial — qualquer subconjunto dos campos do equipamento. */
export class UpdateEquipamentoDto extends PartialType(CreateEquipamentoDto) {}

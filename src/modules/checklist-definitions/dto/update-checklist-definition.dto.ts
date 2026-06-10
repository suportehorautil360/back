import { PartialType } from '@nestjs/swagger';
import { CreateChecklistDefinitionDto } from './create-checklist-definition.dto';

/** Atualização parcial de uma definição de checklist. */
export class UpdateChecklistDefinitionDto extends PartialType(
  CreateChecklistDefinitionDto,
) {}

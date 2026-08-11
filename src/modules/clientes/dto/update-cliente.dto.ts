import { Type } from 'class-transformer';
import { IsOptional, ValidateNested } from 'class-validator';
import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateClienteDto, CreateContratoDto } from './create-cliente.dto';
import { ChecklistLoginConfigDto } from './checklist-login-config.dto';

/** Contrato em atualização — todos os campos opcionais (merge parcial). */
export class UpdateContratoDto extends PartialType(CreateContratoDto) {}

/**
 * Atualização parcial de cliente — qualquer subconjunto dos campos. Usado tanto
 * pela edição completa no admin quanto pela edição dos dados da empresa na tela
 * de Configurações da prefeitura (que envia só nome/uf/cnpj/caepf/cidade/whatsapp
 * + contrato.emailContratante). Remove o `contrato` do base (que é obrigatório)
 * e o readiciona como parcial.
 */
export class UpdateClienteDto extends PartialType(
  OmitType(CreateClienteDto, ['contrato'] as const),
) {
  contrato?: UpdateContratoDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ChecklistLoginConfigDto)
  checklistLogin?: ChecklistLoginConfigDto;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const FUEL_OPTIONS = [
  'Reserva',
  '1/4',
  '1/2',
  '3/4',
  'Cheio',
] as const;

export const OLD_PART_DESTINATION_OPTIONS = [
  'Descarte ecológico',
  'Devolvida ao cliente',
] as const;

export class ChecklistDevolucaoStateItemDto {
  @ApiProperty({ example: 'ok', description: 'ok | anomaly | na' })
  @IsString()
  status!: string;

  @ApiPropertyOptional({ description: 'URL da foto (obrigatória se anomaly)' })
  @IsOptional()
  @IsString()
  photo?: string;
}

export class ChecklistDevolucaoModuleItemDto {
  @ApiProperty({ example: 'ok', description: 'ok | anomaly | na' })
  @IsString()
  status!: string;
}

export class ChecklistDevolucaoIdentificationDto {
  @ApiProperty({
    example: 'OS-2026-047',
    description:
      'Protocolo da O.S. já existente. Opcional se enviar protocolo/os na raiz ou solicitacaoOsId.',
  })
  @IsOptional()
  @IsString()
  os?: string;

  @ApiPropertyOptional({ example: 'OS-2026-047', description: 'Alias de os' })
  @IsOptional()
  @IsString()
  protocolo?: string;

  @ApiProperty({ example: '2026-06-20' })
  @IsString()
  date!: string;

  @ApiProperty({ example: '16:40' })
  @IsString()
  time!: string;

  @ApiProperty({ example: 'Sany SYL956H' })
  @IsString()
  brandModel!: string;

  @ApiProperty({ example: 'ABC-1234' })
  @IsString()
  platePrefix!: string;

  @ApiProperty({ example: '42330' })
  @IsString()
  currentKm!: string;

  @ApiProperty({ example: '6890,2' })
  @IsString()
  hourMeter!: string;

  @ApiProperty({ description: 'Condutor (entrega)' })
  @IsString()
  driver!: string;

  @ApiProperty()
  @IsString()
  technicalResponsible!: string;

  @ApiProperty({ enum: FUEL_OPTIONS, example: '1/2' })
  @IsString()
  @IsIn([...FUEL_OPTIONS])
  fuel!: string;
}

export class ChecklistDevolucaoPartItemDto {
  @ApiProperty()
  @IsString()
  description!: string;

  @ApiProperty()
  @IsString()
  partNumber!: string;

  @ApiProperty()
  @IsString()
  brand!: string;

  @ApiProperty({ enum: OLD_PART_DESTINATION_OPTIONS })
  @IsString()
  @IsIn([...OLD_PART_DESTINATION_OPTIONS])
  oldPartDestination!: string;

  @ApiPropertyOptional({ description: 'URL após upload (foto peça nova)' })
  @IsOptional()
  @IsString()
  newPhoto?: string;

  @ApiPropertyOptional({ description: 'URL após upload (foto peça substituída)' })
  @IsOptional()
  @IsString()
  replacedPhoto?: string;
}

export class ChecklistDevolucaoPartsDto {
  @ApiProperty({ type: [ChecklistDevolucaoPartItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChecklistDevolucaoPartItemDto)
  items!: ChecklistDevolucaoPartItemDto[];
}

export class ChecklistDevolucaoServiceItemDto {
  @ApiProperty({ description: 'Sistema / componente' })
  @IsString()
  systemComponent!: string;

  @ApiProperty()
  @IsString()
  initialDiagnosis!: string;

  @ApiProperty({ description: 'Ação técnica executada' })
  @IsString()
  technicalAction!: string;

  @ApiProperty()
  @IsString()
  technician!: string;

  @ApiProperty({ example: '2.5', description: 'Tempo H/H' })
  @IsString()
  manHours!: string;
}

export class ChecklistDevolucaoServicesDto {
  @ApiProperty({ type: [ChecklistDevolucaoServiceItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChecklistDevolucaoServiceItemDto)
  items!: ChecklistDevolucaoServiceItemDto[];
}

export class ChecklistDevolucaoClosingDto {
  @ApiProperty({ description: 'Inventário de bordo conferido' })
  @IsBoolean()
  inventoryChecked!: boolean;

  @ApiProperty()
  @IsString()
  driverSignature!: string;

  @ApiProperty()
  @IsString()
  workshopSignature!: string;
}

export class CreateChecklistDevolucaoDto {
  @ApiPropertyOptional({
    description:
      'UUID gerado no front (mesmo usado no upload de fotos). Se omitido, o back gera.',
  })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiPropertyOptional({
    example: 'CHD-2026-0001',
    description: 'Gerado automaticamente se omitido',
  })
  @IsOptional()
  @IsString()
  number?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  oficinaId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  parceiroId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  prefeituraId?: string;

  @ApiPropertyOptional({ description: 'ID em solicitacoesOS' })
  @IsOptional()
  @IsString()
  solicitacaoOsId?: string;

  @ApiPropertyOptional({ description: 'ID em ordensServico (orçamento aprovado)' })
  @IsOptional()
  @IsString()
  ordemServicoId?: string;

  @ApiPropertyOptional({
    example: 'OS-2026-047',
    description: 'Protocolo da O.S. (alternativa a identification.os)',
  })
  @IsOptional()
  @IsString()
  protocolo?: string;

  @ApiPropertyOptional({
    example: 'OS-2026-047',
    description: 'Alias do protocolo da O.S. na raiz do body',
  })
  @IsOptional()
  @IsString()
  os?: string;

  @ValidateNested()
  @Type(() => ChecklistDevolucaoIdentificationDto)
  identification!: ChecklistDevolucaoIdentificationDto;

  @ApiProperty({
    example: {
      limpezaInterna: { status: 'ok' },
      limpezaExterna: { status: 'anomaly', photo: 'https://...' },
    },
    description: 'Estado geral — 15 itens fixos no front',
  })
  @IsObject()
  generalState!: Record<string, ChecklistDevolucaoStateItemDto>;

  @ApiProperty({
    example: {
      sistemaHidraulico: { status: 'ok' },
      laminaConcha: { status: 'na' },
    },
    description: 'Módulos linha amarela / rodoviário / agrícola',
  })
  @IsObject()
  modules!: Record<string, ChecklistDevolucaoModuleItemDto>;

  @ValidateNested()
  @Type(() => ChecklistDevolucaoPartsDto)
  parts!: ChecklistDevolucaoPartsDto;

  @ValidateNested()
  @Type(() => ChecklistDevolucaoServicesDto)
  services!: ChecklistDevolucaoServicesDto;

  @ValidateNested()
  @Type(() => ChecklistDevolucaoClosingDto)
  closing!: ChecklistDevolucaoClosingDto;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsObject,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class ChecklistChegadaItemDto {
  @ApiProperty({ example: 'ok', description: 'ok | anomaly | na | vazio' })
  @IsString()
  status!: string;

  @ApiPropertyOptional({ description: 'URL da foto (após upload)' })
  @IsOptional()
  @IsString()
  photo?: string;
}

export class ChecklistChegadaIdentificationDto {
  @ApiProperty({ example: 'OS-2026-004' })
  @IsString()
  @MinLength(1)
  os!: string;

  @ApiProperty({ example: '2026-06-16' })
  @IsString()
  entryDate!: string;

  @ApiProperty({ example: '14:30' })
  @IsString()
  time!: string;

  @ApiProperty()
  @IsString()
  responsible!: string;

  @ApiProperty()
  @IsString()
  client!: string;

  @ApiProperty()
  @IsString()
  brandModel!: string;

  @ApiProperty()
  @IsString()
  platePrefix!: string;

  @ApiProperty()
  @IsString()
  km!: string;

  @ApiProperty()
  @IsString()
  hourMeter!: string;

  @ApiProperty({ example: '1/2' })
  @IsString()
  fuel!: string;
}

export class ChecklistChegadaPhotosDto {
  @ApiPropertyOptional({ description: 'URL da foto frontal' })
  @IsOptional()
  @IsString()
  frontal?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  lateralDireita?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  traseira?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  lateralEsquerda?: string;
}

export class ChecklistChegadaTermDto {
  @ApiProperty()
  @IsString()
  symptoms!: string;

  @ApiProperty()
  @IsString()
  clientSignature!: string;

  @ApiProperty()
  @IsString()
  workshopSignature!: string;
}

export class CreateChecklistChegadaDto {
  @ApiPropertyOptional({
    description:
      'UUID gerado no front (mesmo usado no upload de fotos). Se omitido, o back gera.',
  })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiPropertyOptional({
    example: 'CHE-2026-0001',
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

  @ApiPropertyOptional({
    description: 'ID do documento em solicitacoesOS (retorno do POST /os/solicitacoes)',
  })
  @IsOptional()
  @IsString()
  solicitacaoOsId?: string;

  @ValidateNested()
  @Type(() => ChecklistChegadaIdentificationDto)
  identification!: ChecklistChegadaIdentificationDto;

  @ValidateNested()
  @Type(() => ChecklistChegadaPhotosDto)
  photos!: ChecklistChegadaPhotosDto;

  @ApiProperty({
    example: {
      vidros: { status: 'ok' },
      retrovisores: { status: 'anomaly', photo: 'https://...' },
    },
  })
  @IsObject()
  inspection!: Record<string, ChecklistChegadaItemDto>;

  @ApiProperty({
    example: {
      hidraulico: { status: 'ok' },
      laminaConcha: { status: 'ok' },
    },
  })
  @IsObject()
  blocks!: Record<string, ChecklistChegadaItemDto>;

  @ValidateNested()
  @Type(() => ChecklistChegadaTermDto)
  term!: ChecklistChegadaTermDto;
}

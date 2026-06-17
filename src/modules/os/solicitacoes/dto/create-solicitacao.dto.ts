import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { OS_SERVICE_TYPES } from '../../os.types';
import type { OsServiceType } from '../../os.types';

export class CreateSolicitacaoDto {
  @ApiProperty({ example: 'pref-001' })
  @IsString()
  @IsNotEmpty()
  prefeituraId!: string;

  @ApiProperty({
    description: 'Equipment id (field `id` or Firestore document id).',
    example: 'equip-uuid',
  })
  @IsString()
  @IsNotEmpty()
  equipmentId!: string;

  @ApiProperty({ example: 'João Silva' })
  @IsString()
  @IsNotEmpty()
  operator!: string;

  @ApiProperty({
    description: 'Problem description / defect report.',
    example: 'Hydraulic box leaking',
  })
  @IsString()
  @IsNotEmpty()
  report!: string;

  @ApiPropertyOptional({
    enum: OS_SERVICE_TYPES,
    description:
      'Maintenance kind: `corrective` (breakdown/repair) or `preventive` (scheduled). ' +
      'Legacy `C` / `P` are also accepted. Default: `corrective`.',
    example: 'corrective',
  })
  @IsOptional()
  @IsIn([...OS_SERVICE_TYPES, 'C', 'P', 'c', 'p'])
  serviceType?: OsServiceType | 'C' | 'P' | 'c' | 'p';

  /** @deprecated Prefer `serviceType`. Still accepted for backward compatibility. */
  @ApiPropertyOptional({
    enum: ['C', 'P', 'corrective', 'preventive'],
    deprecated: true,
    description: 'Use `serviceType` instead.',
  })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({
    description: 'Scheduled date (YYYY-MM-DD).',
    example: '2026-06-14',
  })
  @IsOptional()
  @IsString()
  scheduledDate?: string;
}

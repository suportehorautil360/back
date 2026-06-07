import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';
import { CREDIT_TYPE_OPTIONS } from '../creditos.types';
import type { CreditType } from '../creditos.types';

export class CreateCreditoDto {
  @ApiProperty({ example: 'pref-001' })
  @IsString()
  @IsNotEmpty()
  prefeituraId!: string;

  @ApiProperty({
    enum: CREDIT_TYPE_OPTIONS,
    description: 'Allocation target: equipment or work front.',
    example: 'equipment',
  })
  @IsIn(CREDIT_TYPE_OPTIONS)
  type!: CreditType;

  @ApiPropertyOptional({
    description:
      'Required when type = equipment. Equipment plate or chassis (chassis is most common).',
    example: '9BWZZZ377VT004251',
  })
  @ValidateIf((dto: CreateCreditoDto) => dto.type === 'equipment')
  @IsString()
  @IsNotEmpty()
  plateOrChassis?: string;

  @ApiPropertyOptional({
    description: 'Required when type = workFront.',
    example: 'work-front-uuid',
  })
  @ValidateIf((dto: CreateCreditoDto) => dto.type === 'workFront')
  @IsString()
  @IsNotEmpty()
  workFrontId?: string;

  @ApiProperty({ description: 'Credit amount in BRL.', example: 2000 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @ApiProperty({ example: 'Financeiro' })
  @IsString()
  @IsNotEmpty()
  responsible!: string;

  @ApiPropertyOptional({
    example: 'Monthly forecast for project X',
  })
  @IsOptional()
  @IsString()
  observation?: string;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const EXIGENCIAS_FOTO = ['nao', 'se_nao_conforme', 'sempre'] as const;
export const EXIGENCIAS_OS = ['exige_os', 'opcional', 'avulso'] as const;

export class ItemDoChecklistDto {
  @ApiProperty({ description: 'Posição dentro do grupo — é o número que o mecânico cita.' })
  @IsInt()
  @Min(1)
  numero!: number;

  @ApiProperty({ description: 'O que deve ser verificado.' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  descricao!: string;

  @ApiPropertyOptional({
    description: 'Item não obrigatório pode ficar sem resposta e não trava a conclusão.',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  obrigatorio?: boolean;

  @ApiPropertyOptional({
    enum: EXIGENCIAS_FOTO,
    description: 'Quando a foto deixa de ser opcional e vira condição para fechar o item.',
    default: 'nao',
  })
  @IsOptional()
  @IsIn(EXIGENCIAS_FOTO)
  foto?: (typeof EXIGENCIAS_FOTO)[number];

  @ApiPropertyOptional({
    description:
      'Reprovar este item é grave. A criticidade vem daqui, marcada por quem conhece a ' +
      'máquina — nunca adivinhada por palavra no texto.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  impeditivo?: boolean;
}

export class GrupoDoChecklistDto {
  @ApiPropertyOptional({ description: 'Código do grupo, como no sistema atual (29, 30, 31…).' })
  @IsOptional()
  @IsInt()
  @Min(0)
  codigo?: number;

  @ApiProperty({ description: 'Nome da seção. Checklist sem seção usa um grupo só.' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nome!: string;

  @ApiProperty({ type: [ItemDoChecklistDto] })
  @IsArray()
  @ArrayNotEmpty({ message: 'Todo grupo precisa de ao menos um item.' })
  @ValidateNested({ each: true })
  @Type(() => ItemDoChecklistDto)
  itens!: ItemDoChecklistDto[];
}

/**
 * O checklist que a empresa cria.
 *
 * `codigo` é obrigatório e imutável na prática: é por ele que o mecânico
 * conversa com o encarregado. Trocar o código de um checklist em uso é como
 * renomear uma rua — quem já sabia o caminho se perde.
 */
export class ChecklistModeloDto {
  @ApiProperty({ description: 'O número que o mecânico decora e cita.', example: 57 })
  @IsInt()
  @Min(1)
  codigo!: number;

  @ApiProperty({ example: 'CORRETIVA - MAQ. ESTEIRA' })
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  nome!: string;

  @ApiPropertyOptional({ description: 'Corretiva, Preventiva, Avarias, Embarque…' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  familia?: string;

  @ApiPropertyOptional({ description: 'Esteira, Pneus, Caminhões, Grades…' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  tipoMaquina?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Casa o checklist com a máquina. Vazio vale para qualquer uma.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];

  @ApiProperty({ type: [GrupoDoChecklistDto] })
  @IsArray()
  @ArrayNotEmpty({ message: 'O checklist precisa de ao menos um grupo.' })
  @ValidateNested({ each: true })
  @Type(() => GrupoDoChecklistDto)
  grupos!: GrupoDoChecklistDto[];

  @ApiPropertyOptional({
    enum: EXIGENCIAS_OS,
    description:
      'Corretiva só existe com serviço acontecendo; avaria de desembarque não abre OS.',
    default: 'opcional',
  })
  @IsOptional()
  @IsIn(EXIGENCIAS_OS)
  exigeOs?: (typeof EXIGENCIAS_OS)[number];

  @ApiPropertyOptional({
    description: 'Assinatura de quem recebe a máquina, além do mecânico.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  exigeAssinaturaRecebedor?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}

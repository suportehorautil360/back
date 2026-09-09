import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class IniciarChecklistDto {
  @ApiProperty({ description: 'Modelo de checklist da empresa.' })
  @IsString()
  modeloId!: string;

  @ApiProperty()
  @IsString()
  equipamentoId!: string;

  @ApiPropertyOptional({
    description: 'A OS de onde o checklist nasceu. Obrigatório quando o modelo exige.',
  })
  @IsOptional()
  @IsString()
  serviceOrderId?: string;
}

/**
 * Respostas de UM grupo: `itemId → { valor, observacao?, fotos? }`.
 *
 * Validado como objeto solto de propósito — a forma de cada resposta é
 * conferida contra o modelo no serviço, que é quem sabe quais itens existem
 * naquela seção. Um DTO rígido aqui duplicaria essa checagem e divergiria dela.
 */
export class RespostasDoGrupoDto {
  @ApiProperty({ description: 'Id da seção dentro do modelo.' })
  @IsString()
  grupoId!: string;

  @ApiProperty({
    description: 'itemId → { valor: conforme|nao_conforme|na, observacao?, fotos? }',
    example: { 'g29-i1': { valor: 'nao_conforme', observacao: 'Mangueira furada' } },
  })
  @IsObject()
  respostas!: Record<string, { valor?: string; observacao?: string; fotos?: string[] }>;
}

export class ConcluirChecklistDto {
  @ApiProperty({ description: 'Assinatura do mecânico (URL no Storage).' })
  @IsString()
  assinaturaExecutante!: string;

  @ApiPropertyOptional({
    description: 'Assinatura de quem recebe a máquina. Exigida nas transferências.',
  })
  @IsOptional()
  @IsString()
  assinaturaRecebedor?: string;

  @ApiPropertyOptional({ description: 'Nome de quem recebeu — traço anônimo não prova nada.' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  recebedorNome?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  recebedorDocumento?: string;
}

export class CancelarChecklistDto {
  @ApiProperty({ description: 'Por que parou. É o que o gestor lê depois.' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  motivo!: string;
}

export class FotoDoItemDto {
  @ApiProperty()
  @IsString()
  itemId!: string;

  @ApiProperty({ description: 'URL da foto já no Storage.' })
  @IsString()
  url!: string;
}

export const STATUS_EXECUCAO = ['aberta', 'concluida', 'cancelada'] as const;

export class FiltroExecucoesDto {
  @ApiPropertyOptional({ enum: STATUS_EXECUCAO })
  @IsOptional()
  @IsIn(STATUS_EXECUCAO)
  status?: (typeof STATUS_EXECUCAO)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  ignorado?: string[];
}

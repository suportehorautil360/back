import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ListNotasFiscaisPrefeituraQueryDto } from './dto/list-notas-fiscais-prefeitura-query.dto';
import { NotasFiscaisService } from './notas-fiscais.service';

const MAX_PDF_BYTES = 10 * 1024 * 1024;

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function resolveContextIds(params: {
  pathOficinaId: string;
  bodyOficinaId?: string;
  parceiroId?: string;
  prefeituraId?: string;
  headerParceiroId?: string;
  headerPrefeituraId?: string;
}) {
  const oficinaId = texto(params.pathOficinaId) || texto(params.bodyOficinaId);
  if (!oficinaId) {
    throw new BadRequestException('oficinaId inválido.');
  }

  if (
    params.bodyOficinaId &&
    params.pathOficinaId &&
    texto(params.bodyOficinaId) !== texto(params.pathOficinaId)
  ) {
    throw new BadRequestException(
      'oficinaId do path não confere com o enviado no formulário.',
    );
  }

  return {
    oficinaId,
    parceiroId:
      texto(params.parceiroId) || texto(params.headerParceiroId) || undefined,
    prefeituraId:
      texto(params.prefeituraId) ||
      texto(params.headerPrefeituraId) ||
      undefined,
  };
}

@ApiTags('notas-fiscais')
@Controller('notas-fiscais')
export class NotasFiscaisController {
  constructor(private readonly service: NotasFiscaisService) {}

  @Post('oficina/:oficinaId')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_PDF_BYTES } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Enviar PDF de nota fiscal (DANFE)',
    description:
      'Recebe apenas o PDF e contexto da oficina. O backend extrai chave, valor, emitente e demais campos.',
  })
  @ApiParam({ name: 'oficinaId' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'oficinaId'],
      properties: {
        file: { type: 'string', format: 'binary' },
        oficinaId: { type: 'string' },
        parceiroId: { type: 'string' },
        prefeituraId: { type: 'string' },
        solicitacaoOsId: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Nota fiscal enviada.' })
  async upload(
    @Param('oficinaId') pathOficinaId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('oficinaId') bodyOficinaId?: string,
    @Body('parceiroId') parceiroId?: string,
    @Body('prefeituraId') prefeituraId?: string,
    @Body('solicitacaoOsId') solicitacaoOsId?: string,
    @Headers('x-parceiro-id') headerParceiroId?: string,
    @Headers('x-prefeitura-id') headerPrefeituraId?: string,
  ) {
    const context = resolveContextIds({
      pathOficinaId,
      bodyOficinaId,
      parceiroId,
      prefeituraId,
      headerParceiroId,
      headerPrefeituraId,
    });

    const data = await this.service.upload({
      ...context,
      solicitacaoOsId: texto(solicitacaoOsId) || undefined,
      file,
    });

    return {
      data,
      message: 'Nota fiscal enviada com sucesso.',
    };
  }

  @Get('prefeitura/:prefeituraId/oficinas')
  @ApiOperation({
    summary: 'Listar NF das oficinas (O.S.)',
    description:
      'Retorna NF-e/NFC-e anexadas pelas oficinas, com nome da oficina, protocolo da O.S. e resumo agregado.',
  })
  @ApiParam({ name: 'prefeituraId' })
  @ApiQuery({ name: 'busca', required: false })
  @ApiQuery({ name: 'oficinaId', required: false })
  @ApiQuery({ name: 'status', required: false, example: 'pendente' })
  @ApiQuery({ name: 'startDate', required: false, example: '2026-06-01' })
  @ApiQuery({ name: 'endDate', required: false, example: '2026-06-30' })
  listarOficinasPorPrefeitura(
    @Param('prefeituraId') prefeituraId: string,
    @Query() query: ListNotasFiscaisPrefeituraQueryDto,
  ) {
    return this.service.listarOficinasPorPrefeitura(prefeituraId, query);
  }

  @Get('oficina/:oficinaId')
  @ApiOperation({ summary: 'Listar notas fiscais da oficina' })
  @ApiParam({ name: 'oficinaId' })
  listar(@Param('oficinaId') oficinaId: string) {
    return this.service.listarPorOficina(oficinaId);
  }

  @Post('posto/:postoId')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_PDF_BYTES } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Enviar PDF de nota fiscal de combustível (posto)',
    description:
      'Recebe o PDF da DANFE (NF-e mod. 55) ou NFC-e (mod. 65). O backend extrai chave, valor, emitente, data e tipo.',
  })
  @ApiParam({ name: 'postoId' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        prefeituraId: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Nota fiscal enviada.' })
  async uploadPosto(
    @Param('postoId') postoId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('prefeituraId') prefeituraId?: string,
    @Headers('x-prefeitura-id') headerPrefeituraId?: string,
  ) {
    const data = await this.service.uploadPorPosto({
      postoId,
      prefeituraId: texto(prefeituraId) || texto(headerPrefeituraId) || undefined,
      file,
    });
    return { data, message: 'Nota fiscal enviada com sucesso.' };
  }

  @Get('posto/:postoId')
  @ApiOperation({ summary: 'Listar notas fiscais de combustível do posto' })
  @ApiParam({ name: 'postoId' })
  listarPosto(@Param('postoId') postoId: string) {
    return this.service.listarPorPosto(postoId);
  }

  @Get('prefeitura/:prefeituraId/combustivel')
  @ApiOperation({
    summary: 'Listar notas fiscais de combustível dos postos da prefeitura',
  })
  @ApiParam({ name: 'prefeituraId' })
  listarCombustivelPorPrefeitura(@Param('prefeituraId') prefeituraId: string) {
    return this.service.listarCombustivelPorPrefeitura(prefeituraId);
  }

  @Patch(':id/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Aprovar/rejeitar uma nota fiscal (gestor)' })
  @ApiParam({ name: 'id' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['status'],
      properties: {
        status: { type: 'string', enum: ['pendente', 'aprovada', 'rejeitada'] },
      },
    },
  })
  atualizarStatus(@Param('id') id: string, @Body('status') status: string) {
    return this.service.atualizarStatus(id, status);
  }
}

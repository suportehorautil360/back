import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
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

  @Get('oficina/:oficinaId')
  @ApiOperation({ summary: 'Listar notas fiscais da oficina' })
  @ApiParam({ name: 'oficinaId' })
  listar(@Param('oficinaId') oficinaId: string) {
    return this.service.listarPorOficina(oficinaId);
  }
}

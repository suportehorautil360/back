import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { UploadsService } from './uploads.service';

const MAX_FOTOS = 12;
const MAX_BYTES_POR_FOTO = 5 * 1024 * 1024;

@ApiTags('uploads')
@Controller('uploads')
export class UploadsController {
  constructor(private readonly service: UploadsService) {}

  @Post('checklist-fotos')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FilesInterceptor('fotos', MAX_FOTOS, {
      limits: { fileSize: MAX_BYTES_POR_FOTO },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Subir fotos de um checklist para o Supabase Storage',
    description:
      'Recebe as fotos em multipart (campo "fotos", até 12 arquivos de 5MB) e devolve as URLs públicas na mesma ordem. O nome original de cada arquivo identifica a foto (ex.: horimetro.jpg, item-3.jpg).',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['checklistId', 'fotos'],
      properties: {
        checklistId: { type: 'string' },
        fotos: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
        },
      },
    },
  })
  @ApiOkResponse({ description: 'URLs públicas das fotos enviadas.' })
  async checklistFotos(
    @Body('checklistId') checklistId: string,
    @UploadedFiles() fotos: Express.Multer.File[],
  ) {
    if (!checklistId?.trim()) {
      throw new BadRequestException('Informe o checklistId.');
    }
    if (!fotos?.length) {
      throw new BadRequestException(
        'Envie ao menos uma foto no campo "fotos".',
      );
    }
    const invalida = fotos.find((f) => !f.mimetype?.startsWith('image/'));
    if (invalida) {
      throw new BadRequestException(
        `Arquivo "${invalida.originalname}" não é uma imagem.`,
      );
    }
    const urls = await this.service.uploadChecklistFotos(
      checklistId.trim(),
      fotos.map((f) => ({
        nome: f.originalname.replace(/\.[a-zA-Z0-9]+$/, ''),
        buffer: f.buffer,
        mimetype: f.mimetype,
      })),
    );
    return { data: urls, message: 'ok' };
  }
}

import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import {
  FileFieldsInterceptor,
  FileInterceptor,
} from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { UploadsService } from './uploads.service';
import { resolveUploadFolder } from './helpers/upload-path.helper';

const MAX_FOTOS = 12;
const MAX_BYTES_POR_FOTO = 5 * 1024 * 1024;

function mergeUploadedFiles(files: {
  fotos?: Express.Multer.File[];
  file?: Express.Multer.File[];
}): Express.Multer.File[] {
  return [...(files.fotos ?? []), ...(files.file ?? [])];
}

function assertImagens(fotos: Express.Multer.File[]): void {
  const invalida = fotos.find((f) => !f.mimetype?.startsWith('image/'));
  if (invalida) {
    throw new BadRequestException(
      `Arquivo "${invalida.originalname}" não é uma imagem.`,
    );
  }
}

function nomeFromFile(file: Express.Multer.File, fallback = 'foto'): string {
  return file.originalname.replace(/\.[a-zA-Z0-9]+$/, '') || fallback;
}

@ApiTags('uploads')
@Controller('uploads')
export class UploadsController {
  constructor(private readonly service: UploadsService) {}

  @Post('checklist-fotos')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'fotos', maxCount: MAX_FOTOS },
        { name: 'file', maxCount: MAX_FOTOS },
      ],
      { limits: { fileSize: MAX_BYTES_POR_FOTO } },
    ),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Subir fotos de um checklist para o Supabase Storage',
    description:
      'Multipart com campo "fotos" (várias) ou "file" (uma ou várias). ' +
      'Até 12 imagens de 5MB. Devolve URLs públicas na ordem enviada.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        checklistId: {
          type: 'string',
          description: 'UUID gerado no front antes de salvar (recomendado)',
        },
        oficinaId: { type: 'string' },
        os: {
          type: 'string',
          description: 'Protocolo da O.S. (ex.: OS-2026-004) — pasta no bucket',
        },
        fotos: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
        },
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiOkResponse({ description: 'URLs públicas das fotos enviadas.' })
  async checklistFotos(
    @Body('checklistId') checklistId: string | undefined,
    @Body('oficinaId') oficinaId: string | undefined,
    @Body('os') os: string | undefined,
    @UploadedFiles()
    files: { fotos?: Express.Multer.File[]; file?: Express.Multer.File[] },
  ) {
    const pasta = resolveUploadFolder({ checklistId, oficinaId, os });
    const fotos = mergeUploadedFiles(files);
    if (!fotos.length) {
      throw new BadRequestException(
        'Envie ao menos uma foto nos campos "fotos" ou "file".',
      );
    }
    assertImagens(fotos);
    const urls = await this.service.uploadChecklistFotos(
      pasta,
      fotos.map((f) => ({
        nome: nomeFromFile(f),
        buffer: f.buffer,
        mimetype: f.mimetype,
      })),
    );
    return { data: urls, message: 'ok' };
  }

  @Post('foto')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_BYTES_POR_FOTO } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Subir uma foto (campo "file")',
    description:
      'Após POST /checklist-chegada, envie checklistId = id retornado. ' +
      'Alternativa: oficinaId + os (protocolo) antes de existir checklist.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        checklistId: {
          type: 'string',
          description: 'UUID gerado no front antes do POST /checklist-chegada',
        },
        oficinaId: { type: 'string' },
        os: { type: 'string', example: 'OS-2026-004' },
        nome: {
          type: 'string',
          example: 'frontal',
          description: 'Identificador da foto (default: nome do arquivo)',
        },
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  async uploadFoto(
    @Body('checklistId') checklistId: string | undefined,
    @Body('oficinaId') oficinaId: string | undefined,
    @Body('os') os: string | undefined,
    @Body('nome') nome: string | undefined,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const pasta = resolveUploadFolder({ checklistId, oficinaId, os });
    if (!file) {
      throw new BadRequestException('Envie a imagem no campo "file".');
    }
    assertImagens([file]);
    const label = (nome?.trim() || nomeFromFile(file)).replace(
      /\.[a-zA-Z0-9]+$/,
      '',
    );
    const [url] = await this.service.uploadChecklistFotos(pasta, [
      {
        nome: label,
        buffer: file.buffer,
        mimetype: file.mimetype,
      },
    ]);
    return { data: { url }, message: 'ok' };
  }

  @Post('abastecimento-foto')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_BYTES_POR_FOTO } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Subir foto de abastecimento manual (medidor ou cupom)',
    description:
      'Envie abastecimentoId (uuid gerado no app) e nome (medidor | cupom).',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'abastecimentoId'],
      properties: {
        abastecimentoId: {
          type: 'string',
          description: 'UUID gerado no app antes de registrar o abastecimento',
        },
        nome: {
          type: 'string',
          example: 'medidor',
          description: 'Identificador da foto (medidor | cupom)',
        },
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  async uploadAbastecimentoFoto(
    @Body('abastecimentoId') abastecimentoId: string | undefined,
    @Body('nome') nome: string | undefined,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const pasta = resolveUploadFolder({ abastecimentoId });
    if (!file) {
      throw new BadRequestException('Envie a imagem no campo "file".');
    }
    assertImagens([file]);
    const label = (nome?.trim() || nomeFromFile(file)).replace(
      /\.[a-zA-Z0-9]+$/,
      '',
    );
    const [url] = await this.service.uploadChecklistFotos(pasta, [
      {
        nome: label,
        buffer: file.buffer,
        mimetype: file.mimetype,
      },
    ]);
    return { data: { url }, message: 'ok' };
  }
}

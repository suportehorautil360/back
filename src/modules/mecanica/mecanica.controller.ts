import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PainelGuard, type RequestComPainel } from '../../common/painel.guard';
import { ModuloComercial } from '../../common/modulo-comercial.decorator';
import {
  EXTENSOES,
  LIMITE_BYTES_FOTO_OS,
  UploadsService,
} from '../uploads/uploads.service';
import { MecanicaService } from './mecanica.service';
import type { SituacaoOs } from './mecanica.service';
import {
  EditarApontamentoDto,
  LancarApontamentoDto,
} from './dto/apontamento.dto';
import { FotoDto, OcorrenciaDto, PecaDto } from './dto/anexos.dto';
import { LaudoDto } from './dto/laudo.dto';

const SITUACOES_VALIDAS: readonly SituacaoOs[] = [
  'Aberta',
  'EmAndamento',
  'Concluida',
];

/**
 * `?situacao` é opcional — sem ela, a Bancada devolve tudo. Quando vem, só os
 * três valores da coluna são aceitos: nem vira filtro silencioso (que faria a
 * query devolver uma lista vazia sem avisar por quê) nem estoura 500.
 */
function validarSituacao(situacao?: string): SituacaoOs | undefined {
  if (situacao === undefined) return undefined;
  if (!SITUACOES_VALIDAS.includes(situacao as SituacaoOs)) {
    throw new BadRequestException(
      `situacao inválida: use ${SITUACOES_VALIDAS.join(', ')}.`,
    );
  }
  return situacao as SituacaoOs;
}

/**
 * Teto do multer SEMPRE acima de `LIMITE_BYTES_FOTO_OS`: se fossem iguais, um
 * arquivo pouco maior nunca chegaria ao handler — o multer rejeitaria antes
 * com um 413 cru, sem a mensagem amigável que `validarFotoOs` devolve em 400.
 */
const TETO_MULTER_FOTO_OS = LIMITE_BYTES_FOTO_OS + 3 * 1024 * 1024;

/**
 * Tipo e tamanho da foto de OS — a mesma dupla de checagem que
 * `UploadsController` já faz para as outras fotos do back, lida daqui em vez
 * de reinventada: `EXTENSOES` (tipos aceitos) e `LIMITE_BYTES_FOTO_OS`
 * (teto de negócio) vêm do `UploadsService`.
 */
function validarFotoOs(file?: Express.Multer.File): Express.Multer.File {
  if (!file) {
    throw new BadRequestException('Envie a foto no campo "file".');
  }
  if (!EXTENSOES[file.mimetype]) {
    throw new BadRequestException('Envie uma imagem (jpeg, png ou webp).');
  }
  if (file.size > LIMITE_BYTES_FOTO_OS) {
    const limiteMb = LIMITE_BYTES_FOTO_OS / (1024 * 1024);
    throw new BadRequestException(
      `Imagem muito grande. Envie um arquivo de até ${limiteMb}MB.`,
    );
  }
  return file;
}

@ApiTags('mecanica')
@Controller('mecanica')
@UseGuards(PainelGuard)
@ModuloComercial('mecanica', 'mecanica')
export class MecanicaController {
  constructor(
    private readonly service: MecanicaService,
    private readonly uploads: UploadsService,
  ) {}

  /**
   * Quem é o portador do token, na visão deste módulo.
   *
   * Existe para o app de campo: depois do login no Supabase ele tem o token,
   * mas não sabe a empresa nem o nome do mecânico — nada disso vem no JWT, e
   * derivar no cliente exigiria confiar em claim que o cliente escolhe.
   *
   * Fica atrás do mesmo `@ModuloComercial` das outras rotas de propósito: se
   * a empresa não contratou Mecânica ou o cargo não libera, a recusa acontece
   * no login, com a mensagem certa, em vez de o app entrar e quebrar na
   * primeira tela.
   */
  @Get('eu')
  @ApiOperation({ summary: 'Identidade do usuário do token neste módulo' })
  eu(@Req() req: RequestComPainel) {
    const { companyId, operatorId, nomeExibicao } = req.painel;
    return { companyId, operatorId, nome: nomeExibicao };
  }

  @Get('os')
  @ApiOperation({
    summary:
      'Bancada: OS internas da empresa do token. `situacao` filtra (ex.: Histórico usa Concluida).',
  })
  async bancada(
    @Req() req: RequestComPainel,
    @Query('minhas') minhas?: string,
    @Query('situacao') situacao?: string,
  ) {
    return this.service.listarBancada(
      req.painel,
      minhas === 'true',
      validarSituacao(situacao),
    );
  }

  @Get('os/:id')
  @ApiOperation({ summary: 'Detalhe de uma OS interna' })
  async detalhe(@Req() req: RequestComPainel, @Param('id') id: string) {
    return this.service.detalhe(req.painel, id);
  }

  @Post('os/:id/assumir')
  @ApiOperation({ summary: 'Assumir a OS — grava o responsável' })
  async assumir(@Req() req: RequestComPainel, @Param('id') id: string) {
    return this.service.assumir(req.painel, id);
  }

  @Post('os/:id/apontamentos/iniciar')
  @ApiOperation({ summary: 'Iniciar apontamento (fim em aberto)' })
  async iniciar(@Req() req: RequestComPainel, @Param('id') id: string) {
    return this.service.iniciarApontamento(req.painel, id);
  }

  @Post('apontamentos/:id/parar')
  @ApiOperation({ summary: 'Parar o apontamento aberto' })
  async parar(@Req() req: RequestComPainel, @Param('id') id: string) {
    return this.service.pararApontamento(req.painel, id);
  }

  @Post('os/:id/apontamentos')
  @ApiOperation({ summary: 'Lançar apontamento com início e fim' })
  async lancar(
    @Req() req: RequestComPainel,
    @Param('id') id: string,
    @Body() dto: LancarApontamentoDto,
  ) {
    return this.service.lancarApontamento(
      req.painel,
      id,
      new Date(dto.inicio),
      new Date(dto.fim),
      dto.observacao ?? null,
    );
  }

  @Patch('apontamentos/:id')
  @ApiOperation({ summary: 'Editar um apontamento do próprio mecânico' })
  async editar(
    @Req() req: RequestComPainel,
    @Param('id') id: string,
    @Body() dto: EditarApontamentoDto,
  ) {
    return this.service.editarApontamento(
      req.painel,
      id,
      new Date(dto.inicio),
      dto.fim ? new Date(dto.fim) : null,
      dto.observacao ?? null,
    );
  }

  @Delete('apontamentos/:id')
  @ApiOperation({ summary: 'Remover um apontamento do próprio mecânico' })
  async remover(@Req() req: RequestComPainel, @Param('id') id: string) {
    return this.service.removerApontamento(req.painel, id);
  }

  @Post('os/:id/pecas')
  @ApiOperation({ summary: 'Registrar peça consumida na OS' })
  async adicionarPeca(
    @Req() req: RequestComPainel,
    @Param('id') id: string,
    @Body() dto: PecaDto,
  ) {
    return this.service.adicionarPeca(req.painel, id, {
      descricao: dto.descricao,
      quantidade: dto.quantidade,
      valorUnit: dto.valorUnit,
      codigo: dto.codigo ?? null,
      marca: dto.marca ?? null,
      unidade: dto.unidade ?? null,
    });
  }

  @Post('os/:id/fotos')
  @ApiOperation({ summary: 'Anexar foto (URL do Storage) à OS' })
  async adicionarFoto(
    @Req() req: RequestComPainel,
    @Param('id') id: string,
    @Body() dto: FotoDto,
  ) {
    return this.service.adicionarFoto(
      req.painel,
      id,
      dto.url,
      dto.legenda ?? null,
    );
  }

  @Post('os/:id/fotos/upload')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: TETO_MULTER_FOTO_OS } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Subir o arquivo da foto e anexar à OS numa única operação',
    description:
      'Multipart com campo "file" (imagem) e "legenda" opcional. Sobe pro ' +
      'Storage e grava o ServiceOrderFoto na mesma chamada: nunca duas ' +
      'requisições separadas (upload depois POST da URL), que deixariam ' +
      'arquivo órfão no Storage se a segunda falhasse.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        legenda: { type: 'string' },
      },
    },
  })
  async uploadFoto(
    @Req() req: RequestComPainel,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('legenda') legenda: string | undefined,
  ) {
    const foto = validarFotoOs(file);
    // Valida a posse da OS ANTES de subir pro Storage: se o upload viesse
    // primeiro, uma OS de outra empresa (ou de pregão) deixaria o arquivo
    // órfão no bucket assim que `adicionarFoto` recusasse a gravação.
    await this.service.detalhe(req.painel, id);
    const url = await this.uploads.uploadOsFoto(id, {
      buffer: foto.buffer,
      mimetype: foto.mimetype,
    });
    return this.service.adicionarFoto(
      req.painel,
      id,
      url,
      legenda?.trim() || null,
    );
  }

  @Post('os/:id/ocorrencias')
  @ApiOperation({ summary: 'Registrar ocorrência na timeline da OS' })
  async adicionarOcorrencia(
    @Req() req: RequestComPainel,
    @Param('id') id: string,
    @Body() dto: OcorrenciaDto,
  ) {
    return this.service.adicionarOcorrencia(req.painel, id, dto.mensagem);
  }

  @Put('os/:id/laudo')
  @ApiOperation({ summary: 'Gravar ou editar o laudo técnico da OS' })
  async salvarLaudo(
    @Req() req: RequestComPainel,
    @Param('id') id: string,
    @Body() dto: LaudoDto,
  ) {
    return this.service.salvarLaudo(req.painel, id, {
      causa: dto.causa,
      servicoFeito: dto.servicoFeito,
      pendencias: dto.pendencias ?? null,
    });
  }

  @Post('os/:id/concluir')
  @ApiOperation({ summary: 'Concluir a OS — exige laudo e nenhum apontamento aberto' })
  async concluir(@Req() req: RequestComPainel, @Param('id') id: string) {
    return this.service.concluir(req.painel, id);
  }
}

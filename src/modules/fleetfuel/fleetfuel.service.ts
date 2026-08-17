import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { StringValue } from 'ms';
import { randomUUID } from 'node:crypto';
import {
  mapAbastecimentoRowsToGastoInput,
  mapCreditoRowsToSaldoInput,
} from '../../common/prisma/abastecimento-api.mapper';
import { companyWhere, resolverCompanyId } from '../../common/prisma/company-resolver';
import {
  atualizarMedicaoAtualPg,
  resolveEquipmentByPlateOrChassisPg,
} from '../../common/prisma/equipment-resolver';
import { limparCpf } from '../../common/prisma/operator-auth.helper';
import { PrismaService } from '../../prisma/prisma.service';
import {
  mensagemIntervaloAbastecimento,
  ultimoAbastecimentoTimestampMs,
  verificarIntervaloAbastecimento,
} from '../movimentacoes/abastecimentos/helpers/intervalo-abastecimento.helper';
import { TipoMedicao } from '../movimentacoes/abastecimentos/dto/create-abastecimento.dto';
import { CriarIntencaoDto } from './dto/criar-intencao.dto';
import { ValidarAbastecimentoDto } from './dto/validar-abastecimento.dto';
import { VerificarVeiculoDto } from './dto/verificar-veiculo.dto';
import {
  BloqueioVerificacao,
  IntencaoAbastecimentoDoc,
  MotoristaVerificado,
  VeiculoVerificado,
} from './fleetfuel.types';
import {
  calcularSaldo,
  calcularTotal,
  combustivelCompativel,
  limiteRevisao,
  odometroIncoerente,
  revisaoObrigatoria,
  somaCreditadoEquipamento,
  somaGastoEquipamento,
} from './helpers/fleetfuel-rules.helper';

interface FleetfuelTokenPayload {
  intencaoId: string;
  prefeituraId: string;
  postoId: string;
  jti: string;
}

const QR_PREFIX = 'ff:';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class FleetfuelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {}

  private getTokenSecret(): string {
    const secret =
      this.configService.get<string>('FLEETFUEL_QR_SECRET') ??
      this.configService.get<string>('JWT_SECRET') ??
      '';
    if (!secret) {
      throw new InternalServerErrorException(
        'Segredo do QR (FLEETFUEL_QR_SECRET/JWT_SECRET) não configurado.',
      );
    }
    return secret;
  }

  private getTokenTtl(): StringValue {
    return (this.configService.get<string>('FLEETFUEL_QR_TTL') ??
      '10m') as StringValue;
  }

  private formatQrConteudo(intencaoId: string): string {
    return `${QR_PREFIX}${intencaoId}`;
  }

  private isUuid(value: string): boolean {
    return UUID_RE.test(value);
  }

  private async resolveQrToken(
    token: string,
  ): Promise<{ intencaoId: string; jti?: string }> {
    const trimmed = token.trim();
    if (!trimmed) {
      throw new UnauthorizedException('QR inválido ou expirado.');
    }

    if (trimmed.startsWith(QR_PREFIX)) {
      const intencaoId = trimmed.slice(QR_PREFIX.length);
      if (!this.isUuid(intencaoId)) {
        throw new UnauthorizedException('QR inválido ou expirado.');
      }
      return { intencaoId };
    }

    try {
      const payload = await this.jwtService.verifyAsync<FleetfuelTokenPayload>(
        trimmed,
        { secret: this.getTokenSecret() },
      );
      return { intencaoId: payload.intencaoId, jti: payload.jti };
    } catch {
      throw new UnauthorizedException('QR inválido ou expirado.');
    }
  }

  async verificar(dto: VerificarVeiculoDto) {
    const prefeituraId = dto.prefeituraId.trim();
    const measurementType: TipoMedicao = dto.measurementType ?? 'hodometro';

    const equipamento = await this.resolverVeiculoOuNull(
      prefeituraId,
      dto.placa,
    );
    if (!equipamento) {
      return this.respostaBloqueio({
        codigo: 'veiculo_nao_encontrado',
        titulo: 'Veículo não encontrado',
        detalhe: `Placa ${dto.placa} não está cadastrada para esta empresa.`,
      });
    }

    const veiculo = equipamento.veiculo;

    if (veiculo.status === 'inativo' || veiculo.status === 'bloqueado') {
      return this.respostaBloqueio(
        {
          codigo: 'veiculo_inativo',
          titulo: 'Veículo indisponível',
          detalhe:
            veiculo.status === 'bloqueado'
              ? 'Veículo bloqueado (em revisão). Abastecimento não liberado.'
              : 'Veículo inativo no cadastro.',
        },
        veiculo,
      );
    }

    if (odometroIncoerente(dto.kmAtual, veiculo.medicaoAtual)) {
      return this.respostaBloqueio(
        {
          codigo: 'odometro_incoerente',
          titulo: 'Incoerência no Odômetro',
          detalhe:
            `KM informado (${dto.kmAtual.toLocaleString('pt-BR')}) é menor que o ` +
            `último registro (${Number(veiculo.medicaoAtual).toLocaleString('pt-BR')} km).`,
        },
        veiculo,
      );
    }

    if (
      revisaoObrigatoria(
        dto.kmAtual,
        equipamento.ultimaRevisao,
        equipamento.intervaloRevisao,
      )
    ) {
      const limite = limiteRevisao(
        equipamento.ultimaRevisao,
        equipamento.intervaloRevisao,
      );
      return this.respostaBloqueio(
        {
          codigo: 'revisao_obrigatoria',
          titulo: 'Revisão Obrigatória',
          detalhe:
            `Veículo atingiu o limite de KM para revisão. KM atual ` +
            `${dto.kmAtual.toLocaleString('pt-BR')} / limite ` +
            `${Number(limite).toLocaleString('pt-BR')} km. Abastecimento ` +
            `bloqueado até a realização da revisão.`,
        },
        veiculo,
      );
    }

    const motorista = await this.resolverMotoristaOuNull(
      prefeituraId,
      dto.cpfMotorista,
    );
    if (!motorista) {
      return this.respostaBloqueio(
        {
          codigo: 'motorista_nao_encontrado',
          titulo: 'Motorista não encontrado',
          detalhe: 'CPF não cadastrado ou inativo nesta empresa.',
        },
        veiculo,
      );
    }

    const saldoDisponivel = await this.calcularSaldoEquipamento(
      prefeituraId,
      veiculo.equipmentId,
      [veiculo.placa, dto.placa],
    );

    return {
      data: {
        liberado: true,
        veiculo,
        motorista,
        saldoDisponivel,
        measurementType,
        bloqueio: null,
      },
      message: 'Veículo liberado para abastecimento.',
    };
  }

  private respostaBloqueio(
    bloqueio: BloqueioVerificacao,
    veiculo?: VeiculoVerificado,
  ) {
    return {
      data: {
        liberado: false,
        veiculo: veiculo ?? null,
        motorista: null,
        saldoDisponivel: null,
        measurementType: null,
        bloqueio,
      },
      message: bloqueio.titulo,
    };
  }

  async criarIntencao(dto: CriarIntencaoDto) {
    const prefeituraId = dto.prefeituraId.trim();
    const measurementType: TipoMedicao = dto.measurementType ?? 'hodometro';
    const companyId = await this.requireCompanyId(prefeituraId);

    const equipamento = await this.resolverVeiculoOuNull(
      prefeituraId,
      dto.placa,
    );
    if (!equipamento) {
      throw new NotFoundException(
        'Veículo não encontrado ou não cadastrado para esta empresa.',
      );
    }
    const veiculo = equipamento.veiculo;

    if (veiculo.status === 'inativo' || veiculo.status === 'bloqueado') {
      throw new BadRequestException('Veículo indisponível para abastecimento.');
    }
    if (odometroIncoerente(dto.kmAtual, veiculo.medicaoAtual)) {
      throw new BadRequestException(
        'KM informado menor que o último registro.',
      );
    }
    if (
      revisaoObrigatoria(
        dto.kmAtual,
        equipamento.ultimaRevisao,
        equipamento.intervaloRevisao,
      )
    ) {
      throw new BadRequestException(
        'Veículo atingiu o limite de revisão. Abastecimento bloqueado.',
      );
    }
    if (!combustivelCompativel(veiculo.combustivel, dto.tipoCombustivel)) {
      throw new BadRequestException(
        `Combustível incompatível: o veículo usa ${veiculo.combustivel}, ` +
          `bomba selecionada ${dto.tipoCombustivel}.`,
      );
    }
    if (veiculo.capacidadeTanque > 0 && dto.liters > veiculo.capacidadeTanque) {
      throw new BadRequestException(
        `Acima da capacidade do tanque (${veiculo.capacidadeTanque} L).`,
      );
    }

    const motorista = await this.resolverMotoristaOuNull(
      prefeituraId,
      dto.cpfMotorista,
    );
    if (!motorista) {
      throw new BadRequestException('Motorista não encontrado ou inativo.');
    }

    const total = calcularTotal(dto.liters, dto.pricePerLiter);
    const saldoDisponivel = await this.calcularSaldoEquipamento(
      prefeituraId,
      veiculo.equipmentId,
      [veiculo.placa, dto.placa],
    );
    if (total > saldoDisponivel) {
      throw new BadRequestException(
        `Saldo insuficiente: total ${total.toLocaleString('pt-BR', {
          style: 'currency',
          currency: 'BRL',
        })} excede o disponível.`,
      );
    }

    const id = randomUUID();
    const jti = randomUUID();
    const ttlMs = this.ttlEmMs();
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + ttlMs);

    const token = await this.jwtService.signAsync(
      {
        intencaoId: id,
        prefeituraId,
        postoId: dto.postoId.trim(),
        jti,
      } satisfies FleetfuelTokenPayload,
      { secret: this.getTokenSecret(), expiresIn: this.getTokenTtl() },
    );

    try {
      await this.prisma.fleetfuelIntencao.create({
        data: {
          id,
          legacyId: id,
          companyId,
          postoLegacyId: dto.postoId.trim(),
          postoNome: dto.postoNome?.trim() || null,
          equipmentId: equipamento.equipmentUuid,
          plateOrChassis: veiculo.placa || dto.placa,
          veiculoModelo: veiculo.modelo || null,
          veiculoDescricao: veiculo.descricao || null,
          combustivelVeiculo: veiculo.combustivel || null,
          operadorLegacyId: motorista.id,
          motoristaCpf: motorista.cpf,
          motoristaNome: motorista.nome,
          tipoCombustivel: dto.tipoCombustivel,
          liters: dto.liters.toFixed(3),
          pricePerLiter: dto.pricePerLiter.toFixed(4),
          total: total.toFixed(2),
          currentReading: dto.kmAtual,
          measurementType,
          status: 'pendente_validacao',
          jti,
          expiresAt,
          createdAt,
        },
      });
    } catch (error) {
      console.error('Erro ao criar intenção de abastecimento:', error);
      throw new InternalServerErrorException(
        'Não foi possível gerar o QR do abastecimento.',
      );
    }

    return {
      data: {
        intencaoId: id,
        token,
        qrConteudo: this.formatQrConteudo(id),
        expiresAt: expiresAt.toISOString(),
        resumo: {
          placa: veiculo.placa || dto.placa,
          motorista: motorista.nome,
          combustivel: dto.tipoCombustivel,
          litros: dto.liters,
          precoLitro: dto.pricePerLiter,
          total,
          posto: dto.postoNome?.trim() ?? null,
        },
      },
      message: 'QR gerado. Aguardando validação do motorista.',
    };
  }

  async validar(dto: ValidarAbastecimentoDto) {
    const payload = await this.resolveQrToken(dto.token);
    const cpfMotorista = dto.cpf ? limparCpf(dto.cpf) : '';

    try {
      const resultado = await this.prisma.$transaction(async (tx) => {
        const intencaoRow = await tx.fleetfuelIntencao.findFirst({
          where: {
            OR: [{ id: payload.intencaoId }, { legacyId: payload.intencaoId }],
          },
          include: {
            company: { select: { legacyId: true } },
            equipment: { select: { id: true, legacyId: true } },
          },
        });

        if (!intencaoRow) {
          throw new NotFoundException('Abastecimento não encontrado.');
        }

        const prefeituraId =
          intencaoRow.company.legacyId ?? intencaoRow.companyId;
        const equipmentPublicId =
          intencaoRow.equipment?.legacyId ?? intencaoRow.equipmentId ?? '';

        if (payload.jti && intencaoRow.jti && intencaoRow.jti !== payload.jti) {
          throw new UnauthorizedException(
            'QR não corresponde a este registro.',
          );
        }
        if (intencaoRow.status === 'concluido') {
          throw new ConflictException('Abastecimento já validado.');
        }
        if (intencaoRow.status !== 'pendente_validacao') {
          throw new ConflictException(
            'Abastecimento não está mais disponível.',
          );
        }
        if (intencaoRow.expiresAt.getTime() < Date.now()) {
          await tx.fleetfuelIntencao.update({
            where: { id: intencaoRow.id },
            data: { status: 'expirado' },
          });
          throw new UnauthorizedException('QR expirado.');
        }

        if (dto.funcionarioId && intencaoRow.operadorLegacyId) {
          if (dto.funcionarioId !== intencaoRow.operadorLegacyId) {
            throw new UnauthorizedException(
              'Este abastecimento não é do motorista logado.',
            );
          }
        } else if (cpfMotorista) {
          if (cpfMotorista !== limparCpf(intencaoRow.motoristaCpf)) {
            throw new UnauthorizedException(
              'Este abastecimento não é do motorista logado.',
            );
          }
        }

        const [creditosRows, abastecimentosRows] = await Promise.all([
          tx.credito.findMany({
            where: { companyId: intencaoRow.companyId },
            include: { equipment: { select: { legacyId: true } } },
          }),
          tx.abastecimento.findMany({
            where: { equipmentId: intencaoRow.equipmentId ?? undefined },
            include: { equipment: { select: { legacyId: true } } },
          }),
        ]);

        const creditado = somaCreditadoEquipamento(
          mapCreditoRowsToSaldoInput(creditosRows),
          equipmentPublicId,
          [intencaoRow.plateOrChassis],
        );
        const gasto = somaGastoEquipamento(
          mapAbastecimentoRowsToGastoInput(abastecimentosRows),
          equipmentPublicId,
        );

        const ultimoEmMs = ultimoAbastecimentoTimestampMs(
          abastecimentosRows.map((row) => ({
            prefeituraId,
            equipmentId: equipmentPublicId,
            createdAt: row.createdAt.toISOString(),
          })),
          prefeituraId,
          equipmentPublicId,
        );
        const intervalo = verificarIntervaloAbastecimento(ultimoEmMs);
        if (!intervalo.liberado && intervalo.proximoEmMs !== null) {
          throw new BadRequestException(
            mensagemIntervaloAbastecimento(intervalo.proximoEmMs),
          );
        }

        const total = Number(intencaoRow.total);
        const saldo = calcularSaldo(creditado, gasto);
        if (total > saldo) {
          throw new BadRequestException(
            'Saldo insuficiente no momento da validação.',
          );
        }

        const abastecimentoId = randomUUID();
        const validatedAt = new Date();
        const validatedAtIso = validatedAt.toISOString();

        await tx.abastecimento.create({
          data: {
            id: abastecimentoId,
            legacyId: abastecimentoId,
            companyId: intencaoRow.companyId,
            equipmentId: intencaoRow.equipmentId,
            operadorLegacyId: intencaoRow.operadorLegacyId,
            postoLegacyId: intencaoRow.postoLegacyId,
            data: new Date(validatedAtIso.slice(0, 10)),
            litros: intencaoRow.liters,
            valor: intencaoRow.total,
            origem: 'posto',
            leitura: intencaoRow.currentReading,
            leituraUnidade:
              intencaoRow.measurementType === 'horimetro' ? 'h' : 'km',
            plateOrChassis: intencaoRow.plateOrChassis,
            precoLitro: intencaoRow.pricePerLiter,
            status: 'aprovado',
            tipo: 'fleetfuel',
            postoNome: intencaoRow.postoNome,
            motoristaNome: intencaoRow.motoristaNome,
            combustivel: intencaoRow.tipoCombustivel,
            latitude: 0,
            longitude: 0,
            fleetfuelIntencaoId: intencaoRow.id,
            createdAt: validatedAt,
          },
        });

        await tx.fleetfuelIntencao.update({
          where: { id: intencaoRow.id },
          data: {
            status: 'concluido',
            abastecimentoId,
            validatedAt,
            validadoPorOperadorLegacyId:
              dto.funcionarioId ?? intencaoRow.operadorLegacyId,
          },
        });

        return {
          intencao: this.mapIntencaoRow(intencaoRow, prefeituraId),
          abastecimentoId,
          validatedAtIso,
          saldoApos: calcularSaldo(creditado, gasto + total),
          currentReading: intencaoRow.currentReading,
          equipmentPublicId,
        };
      });

      await atualizarMedicaoAtualPg(
        this.prisma,
        resultado.equipmentPublicId,
        resultado.currentReading,
      ).catch(() => undefined);

      return {
        data: {
          abastecimentoId: resultado.abastecimentoId,
          validatedAt: resultado.validatedAtIso,
          saldoApos: resultado.saldoApos,
          comprovante: {
            placa: resultado.intencao.plateOrChassis,
            motorista: resultado.intencao.motoristaNome,
            combustivel: resultado.intencao.tipoCombustivel,
            litros: resultado.intencao.liters,
            precoLitro: resultado.intencao.pricePerLiter,
            total: resultado.intencao.total,
            posto: resultado.intencao.postoNome ?? null,
          },
        },
        message: 'Abastecimento validado com sucesso.',
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof UnauthorizedException ||
        error instanceof ConflictException
      ) {
        throw error;
      }
      console.error('Erro ao validar abastecimento:', error);
      throw new InternalServerErrorException(
        'Não foi possível validar o abastecimento.',
      );
    }
  }

  async statusIntencao(id: string) {
    const row = await this.prisma.fleetfuelIntencao.findFirst({
      where: { OR: [{ id }, { legacyId: id }] },
    });
    if (!row) {
      throw new NotFoundException('Intenção não encontrada.');
    }
    const expirado =
      row.status === 'pendente_validacao' &&
      row.expiresAt.getTime() < Date.now();
    return {
      data: {
        id: row.legacyId ?? row.id,
        status: expirado ? 'expirado' : row.status,
        abastecimentoId: row.abastecimentoId ?? null,
        validatedAt: row.validatedAt?.toISOString() ?? null,
        expiresAt: row.expiresAt.toISOString(),
      },
      message: 'OK',
    };
  }

  private ttlEmMs(): number {
    const ttl = String(this.getTokenTtl());
    const match = /^(\d+)\s*(s|m|h|d)?$/.exec(ttl.trim());
    if (!match) return 10 * 60 * 1000;
    const valor = Number(match[1]);
    const unidade = match[2] ?? 'm';
    const fator =
      unidade === 's'
        ? 1000
        : unidade === 'h'
          ? 3600000
          : unidade === 'd'
            ? 86400000
            : 60000;
    return valor * fator;
  }

  private async resolverVeiculoOuNull(
    prefeituraId: string,
    placa: string,
  ): Promise<{
    veiculo: VeiculoVerificado;
    ultimaRevisao: unknown;
    intervaloRevisao: unknown;
    equipmentUuid: string;
  } | null> {
    try {
      const equip = await resolveEquipmentByPlateOrChassisPg(
        this.prisma,
        prefeituraId,
        placa,
      );
      const raw = equip.raw;
      const veiculo: VeiculoVerificado = {
        equipmentId: equip.id,
        placa: asString(raw.placa ?? raw.chassis ?? placa),
        descricao: asString(raw.descricao ?? raw.label ?? raw.nome),
        modelo: asString(raw.modelo),
        tipo: asString(raw.tipo),
        combustivel: asString(raw.combustivel),
        medicaoAtual: Number(raw.medicaoAtual) || 0,
        unidadeRevisao:
          raw.unidadeRevisao === 'km' || raw.unidadeRevisao === 'h'
            ? raw.unidadeRevisao
            : null,
        capacidadeTanque: Number(raw.capacidadeTanque) || 0,
        status: asString(raw.status) || 'ativo',
      };
      return {
        veiculo,
        ultimaRevisao: raw.ultimaRevisao,
        intervaloRevisao: raw.intervaloRevisao,
        equipmentUuid: equip.equipmentUuid,
      };
    } catch {
      return null;
    }
  }

  private async resolverMotoristaOuNull(
    prefeituraId: string,
    cpf: string,
  ): Promise<MotoristaVerificado | null> {
    const cpfLimpo = limparCpf(cpf);
    if (cpfLimpo.length !== 11) return null;

    const companyId = await resolverCompanyId(this.prisma, prefeituraId);
    if (!companyId) return null;

    const row = await this.prisma.operator.findFirst({
      where: {
        companyId,
        cpf: cpfLimpo,
        status: { not: 'inativo' },
      },
    });
    if (!row) return null;

    return {
      id: row.legacyId ?? row.id,
      nome: row.nome,
      cpf: cpfLimpo,
      cargo: row.cargo ?? row.funcao ?? '',
    };
  }

  private async calcularSaldoEquipamento(
    prefeituraId: string,
    equipmentPublicId: string,
    identificadores: string[],
  ): Promise<number> {
    const companyId = await resolverCompanyId(this.prisma, prefeituraId);
    if (!companyId) return 0;

    const equip = await this.prisma.equipment.findFirst({
      where: {
        companyId,
        OR: [{ id: equipmentPublicId }, { legacyId: equipmentPublicId }],
      },
      select: { id: true, legacyId: true },
    });
    if (!equip) return 0;

    const publicId = equip.legacyId ?? equip.id;

    const [creditosRows, abastecimentosRows] = await Promise.all([
      this.prisma.credito.findMany({
        where: { companyId },
        include: { equipment: { select: { legacyId: true } } },
      }),
      this.prisma.abastecimento.findMany({
        where: { equipmentId: equip.id },
        include: { equipment: { select: { legacyId: true } } },
      }),
    ]);

    const creditado = somaCreditadoEquipamento(
      mapCreditoRowsToSaldoInput(creditosRows),
      publicId,
      identificadores,
    );
    const gasto = somaGastoEquipamento(
      mapAbastecimentoRowsToGastoInput(abastecimentosRows),
      publicId,
    );
    return calcularSaldo(creditado, gasto);
  }

  private mapIntencaoRow(
    row: {
      id: string;
      legacyId: string | null;
      postoLegacyId: string;
      postoNome: string | null;
      plateOrChassis: string;
      operadorLegacyId: string | null;
      motoristaCpf: string;
      motoristaNome: string;
      tipoCombustivel: string;
      liters: unknown;
      pricePerLiter: unknown;
      total: unknown;
      currentReading: number;
      measurementType: string;
      status: string;
      abastecimentoId: string | null;
      expiresAt: Date;
      validatedAt: Date | null;
      equipmentId: string | null;
    },
    prefeituraId: string,
  ): IntencaoAbastecimentoDoc {
    return {
      id: row.legacyId ?? row.id,
      prefeituraId,
      postoId: row.postoLegacyId,
      postoNome: row.postoNome ?? undefined,
      equipmentId: row.equipmentId ?? '',
      plateOrChassis: row.plateOrChassis,
      motoristaId: row.operadorLegacyId,
      motoristaCpf: row.motoristaCpf,
      motoristaNome: row.motoristaNome,
      tipoCombustivel: row.tipoCombustivel,
      liters: Number(row.liters),
      pricePerLiter: Number(row.pricePerLiter),
      total: Number(row.total),
      currentReading: row.currentReading,
      measurementType: row.measurementType as TipoMedicao,
      status: row.status as IntencaoAbastecimentoDoc['status'],
      abastecimentoId: row.abastecimentoId ?? undefined,
      createdAt: '',
      expiresAt: row.expiresAt.toISOString(),
      validatedAt: row.validatedAt?.toISOString(),
    };
  }

  private async requireCompanyId(prefeituraId: string): Promise<string> {
    const companyId = await resolverCompanyId(this.prisma, prefeituraId);
    if (!companyId) {
      throw new BadRequestException('Empresa não encontrada.');
    }
    return companyId;
  }
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

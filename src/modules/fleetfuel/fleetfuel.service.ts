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
import { FirebaseService } from '../../config/firebase.service';
import { AbastecimentoDoc } from '../movimentacoes/abastecimentos/abastecimentos.service';
import {
  mensagemIntervaloAbastecimento,
  ultimoAbastecimentoTimestampMs,
  verificarIntervaloAbastecimento,
} from '../movimentacoes/abastecimentos/helpers/intervalo-abastecimento.helper';
import { resolveEquipmentByPlateOrChassis } from '../movimentacoes/shared/equipment.helper';
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
  limparCpf,
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

const COLECAO_INTENCOES = 'fleetfuel_intencoes';

/** Prefixo do QR curto — ~40 chars vs ~250 do JWT, muito mais rápido de escanear. */
const QR_PREFIX = 'ff:';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class FleetfuelService {
  constructor(
    private readonly firebaseService: FirebaseService,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {}

  private get firestore() {
    return this.firebaseService.getFirestore();
  }
  private get intencoesCollection() {
    return this.firestore.collection(COLECAO_INTENCOES);
  }
  private get equipamentosCollection() {
    return this.firestore.collection('equipamentos');
  }
  private get operadoresCollection() {
    return this.firestore.collection('operadores');
  }
  private get creditosCollection() {
    return this.firestore.collection('creditos');
  }
  private get abastecimentosCollection() {
    return this.firestore.collection('abastecimentos');
  }
  private get postosCollection() {
    return this.firestore.collection('postos');
  }

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

  /** Resolve intenção a partir do QR curto (`ff:uuid`) ou JWT legado. */
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

  // ---------------------------------------------------------------------------
  // Etapa 1 — verificação do veículo + motorista
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Etapa 2 — operador confirma e gera o QR (intenção pendente)
  // ---------------------------------------------------------------------------

  async criarIntencao(dto: CriarIntencaoDto) {
    const prefeituraId = dto.prefeituraId.trim();
    const measurementType: TipoMedicao = dto.measurementType ?? 'hodometro';

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

    const doc: IntencaoAbastecimentoDoc = {
      id,
      prefeituraId,
      postoId: dto.postoId.trim(),
      postoNome: dto.postoNome?.trim() || undefined,
      equipmentId: veiculo.equipmentId,
      plateOrChassis: veiculo.placa || dto.placa,
      veiculoModelo: veiculo.modelo || undefined,
      veiculoDescricao: veiculo.descricao || undefined,
      combustivelVeiculo: veiculo.combustivel || undefined,
      motoristaId: motorista.id,
      motoristaCpf: motorista.cpf,
      motoristaNome: motorista.nome,
      tipoCombustivel: dto.tipoCombustivel,
      liters: dto.liters,
      pricePerLiter: dto.pricePerLiter,
      total,
      currentReading: dto.kmAtual,
      measurementType,
      status: 'pendente_validacao',
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    const token = await this.jwtService.signAsync(
      {
        intencaoId: id,
        prefeituraId,
        postoId: doc.postoId,
        jti,
      } satisfies FleetfuelTokenPayload,
      { secret: this.getTokenSecret(), expiresIn: this.getTokenTtl() },
    );

    try {
      await this.intencoesCollection.doc(id).set({ ...doc, jti });
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
        expiresAt: doc.expiresAt,
        resumo: {
          placa: doc.plateOrChassis,
          motorista: doc.motoristaNome,
          combustivel: doc.tipoCombustivel,
          litros: doc.liters,
          precoLitro: doc.pricePerLiter,
          total: doc.total,
          posto: doc.postoNome ?? null,
        },
      },
      message: 'QR gerado. Aguardando validação do motorista.',
    };
  }

  // ---------------------------------------------------------------------------
  // Etapa 3 — motorista valida (debita saldo na transação e conclui)
  // ---------------------------------------------------------------------------

  async validar(dto: ValidarAbastecimentoDto) {
    const payload = await this.resolveQrToken(dto.token);

    const ref = this.intencoesCollection.doc(payload.intencaoId);
    const cpfMotorista = dto.cpf ? limparCpf(dto.cpf) : '';

    try {
      const resultado = await this.firestore.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) {
          throw new NotFoundException('Abastecimento não encontrado.');
        }
        const intencao = snap.data() as IntencaoAbastecimentoDoc & {
          jti?: string;
        };

        if (payload.jti && intencao.jti && intencao.jti !== payload.jti) {
          throw new UnauthorizedException(
            'QR não corresponde a este registro.',
          );
        }
        if (intencao.status === 'concluido') {
          throw new ConflictException('Abastecimento já validado.');
        }
        if (intencao.status !== 'pendente_validacao') {
          throw new ConflictException(
            'Abastecimento não está mais disponível.',
          );
        }
        if (new Date(intencao.expiresAt).getTime() < Date.now()) {
          tx.update(ref, { status: 'expirado' });
          throw new UnauthorizedException('QR expirado.');
        }

        // Identidade do motorista: o que escaneou precisa ser o da intenção.
        if (dto.funcionarioId && intencao.motoristaId) {
          if (dto.funcionarioId !== intencao.motoristaId) {
            throw new UnauthorizedException(
              'Este abastecimento não é do motorista logado.',
            );
          }
        } else if (cpfMotorista) {
          if (cpfMotorista !== limparCpf(intencao.motoristaCpf)) {
            throw new UnauthorizedException(
              'Este abastecimento não é do motorista logado.',
            );
          }
        }

        // --- Reads antes de writes: recomputa o saldo dentro da transação ---
        const [creditosSnap, abastecimentosSnap] = await Promise.all([
          tx.get(
            this.creditosCollection.where(
              'prefeituraId',
              '==',
              intencao.prefeituraId,
            ),
          ),
          tx.get(
            this.abastecimentosCollection.where(
              'equipmentId',
              '==',
              intencao.equipmentId,
            ),
          ),
        ]);

        const creditado = somaCreditadoEquipamento(
          creditosSnap.docs.map((d) => d.data() as Record<string, unknown>),
          intencao.equipmentId,
          [intencao.plateOrChassis],
        );
        const gasto = somaGastoEquipamento(
          abastecimentosSnap.docs.map(
            (d) => d.data() as { equipmentId?: string; total?: unknown },
          ),
          intencao.equipmentId,
        );

        const ultimoEmMs = ultimoAbastecimentoTimestampMs(
          abastecimentosSnap.docs.map((d) => d.data()),
          intencao.prefeituraId,
          intencao.equipmentId,
        );
        const intervalo = verificarIntervaloAbastecimento(ultimoEmMs);
        if (!intervalo.liberado && intervalo.proximoEmMs !== null) {
          throw new BadRequestException(
            mensagemIntervaloAbastecimento(intervalo.proximoEmMs),
          );
        }

        const saldo = calcularSaldo(creditado, gasto);
        if (intencao.total > saldo) {
          throw new BadRequestException(
            'Saldo insuficiente no momento da validação.',
          );
        }

        // --- Writes: grava o abastecimento e conclui a intenção ---
        const abastecimentoId = randomUUID();
        const validatedAtIso = new Date().toISOString();
        const abastecimento: AbastecimentoDoc & {
          origem: string;
          motoristaId: string | null;
          motoristaNome: string;
          fleetfuelIntencaoId: string;
        } = {
          id: abastecimentoId,
          prefeituraId: intencao.prefeituraId,
          equipmentId: intencao.equipmentId,
          plateOrChassis: intencao.plateOrChassis,
          liters: intencao.liters,
          tipo: 'comboio',
          origem: 'posto',
          measurementType: intencao.measurementType,
          currentReading: intencao.currentReading,
          pricePerLiter: intencao.pricePerLiter,
          total: intencao.total,
          postoId: intencao.postoId,
          funcionarioId: intencao.motoristaId ?? undefined,
          motoristaId: intencao.motoristaId,
          motoristaNome: intencao.motoristaNome,
          fleetfuelIntencaoId: intencao.id,
          latitude: 0,
          longitude: 0,
          createdAt: validatedAtIso,
        };

        tx.set(
          this.abastecimentosCollection.doc(abastecimentoId),
          abastecimento,
        );
        tx.update(ref, {
          status: 'concluido',
          abastecimentoId,
          validatedAt: validatedAtIso,
          validadoPorFuncionarioId: dto.funcionarioId ?? intencao.motoristaId,
        });

        return {
          intencao,
          abastecimentoId,
          validatedAtIso,
          saldoApos: calcularSaldo(creditado, gasto + intencao.total),
        };
      });

      // Best-effort: mantém a leitura atual do equipamento em dia (fora da tx).
      await this.atualizarMedicaoAtual(
        resultado.intencao.equipmentId,
        resultado.intencao.currentReading,
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

  // ---------------------------------------------------------------------------
  // Status (polling do posto-web)
  // ---------------------------------------------------------------------------

  async statusIntencao(id: string) {
    const snap = await this.intencoesCollection.doc(id).get();
    if (!snap.exists) {
      throw new NotFoundException('Intenção não encontrada.');
    }
    const intencao = snap.data() as IntencaoAbastecimentoDoc;
    const expirado =
      intencao.status === 'pendente_validacao' &&
      new Date(intencao.expiresAt).getTime() < Date.now();
    return {
      data: {
        id: intencao.id,
        status: expirado ? 'expirado' : intencao.status,
        abastecimentoId: intencao.abastecimentoId ?? null,
        validatedAt: intencao.validatedAt ?? null,
        expiresAt: intencao.expiresAt,
      },
      message: 'OK',
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers de I/O
  // ---------------------------------------------------------------------------

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
  } | null> {
    try {
      const equip = await resolveEquipmentByPlateOrChassis(
        this.equipamentosCollection,
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
    const snap = await this.operadoresCollection
      .where('prefeituraId', '==', prefeituraId)
      .where('cpf', '==', cpfLimpo)
      .get();
    if (snap.empty) return null;
    const doc = snap.docs.find((d) => {
      const status = asString((d.data() as Record<string, unknown>).status);
      return status !== 'inativo';
    });
    if (!doc) return null;
    const data = doc.data() as Record<string, unknown>;
    return {
      id: doc.id,
      nome: asString(data.nome),
      cpf: cpfLimpo,
      cargo: asString(data.cargo),
    };
  }

  private async calcularSaldoEquipamento(
    prefeituraId: string,
    equipmentId: string,
    identificadores: string[],
  ): Promise<number> {
    const [creditosSnap, abastecimentosSnap] = await Promise.all([
      this.creditosCollection.where('prefeituraId', '==', prefeituraId).get(),
      this.abastecimentosCollection
        .where('equipmentId', '==', equipmentId)
        .get(),
    ]);
    const creditado = somaCreditadoEquipamento(
      creditosSnap.docs.map((d) => d.data() as Record<string, unknown>),
      equipmentId,
      identificadores,
    );
    const gasto = somaGastoEquipamento(
      abastecimentosSnap.docs.map(
        (d) => d.data() as { equipmentId?: string; total?: unknown; status?: unknown },
      ),
      equipmentId,
    );
    return calcularSaldo(creditado, gasto);
  }

  private async atualizarMedicaoAtual(
    equipmentId: string,
    leitura: number,
  ): Promise<void> {
    const byField = await this.equipamentosCollection
      .where('id', '==', equipmentId)
      .limit(1)
      .get();
    const ref = byField.empty
      ? this.equipamentosCollection.doc(equipmentId)
      : byField.docs[0].ref;
    const snap = byField.empty ? await ref.get() : byField.docs[0];
    const atual = Number(
      (snap.data() as Record<string, unknown>)?.medicaoAtual,
    );
    if (!Number.isFinite(atual) || leitura > atual) {
      await ref.set({ medicaoAtual: leitura }, { merge: true });
    }
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

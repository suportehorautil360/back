import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '../../prisma/generated/client';
import { normalizarChassi } from './helpers/chassi.helper';
import type { SalvarChecklistRunDto } from './dto/salvar-checklist-run.dto';
import type { SalvarEmergenciaDto } from './dto/salvar-emergencia.dto';
import type { BaterPontoDto } from './dto/bater-ponto.dto';
import {
  calcularHashPonto,
  formatTimestampForLedger,
} from './helpers/ponto-ledger.helper';
import {
  montarPayloadDoChassi,
  VALIDADE_DO_TOKEN_DE_CHASSI,
} from './helpers/token-do-chassi.helper';

/**
 * Resolver chassi → empresa/equipamento (login por chassi do PWA operador).
 *
 * Migrado pra Postgres/Prisma em 2026-08-16 (purge Firebase). Antes lia de
 * `equipamentos` no Firestore + `clientes/{id}.checklistLogin.chassi`.
 * Agora lê `equipments` por chassi (normalizado) + `clients.checklist_login`.
 */
@Injectable()
export class ChecklistChassiService {
  private readonly logger = new Logger(ChecklistChassiService.name);

  constructor(
    private readonly prisma: PrismaService,
    /**
     * Opcionais para os testes que só exercitam consulta poderem construir o
     * serviço com o Prisma e mais nada. Em produção os dois vêm do módulo; sem
     * eles, `resolverChassi` devolve o resultado SEM token — que é exatamente
     * o comportamento de antes desta mudança, e não uma falha silenciosa de
     * autorização: o token só ACRESCENTA escopo, nunca é o que libera.
     */
    @Optional() private readonly jwt?: JwtService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  async resolverChassi(chassiInput: string) {
    const chassi = normalizarChassi(chassiInput);
    if (!chassi) {
      this.logger.warn(
        JSON.stringify({
          evento: 'resolver-chassi',
          chassi: chassiInput,
          resultado: 'vazio',
        }),
      );
      throw new NotFoundException('Chassi vazio.');
    }

    // Case-insensitive: chassi no Postgres pode ter vindo com case misturado do
    // Firestore antigo. normalizarChassi já uppercase/trim, mas a coluna não é
    // case-insensitive por padrão — comparamos via UPPER().
    const equipamentos = await this.prisma.equipment.findMany({
      where: {
        // Match exato após normalizar (o backfill costuma salvar já uppercase).
        chassi,
      },
      select: {
        id: true,
        legacyId: true,
        chassi: true,
        companyId: true,
        company: {
          select: {
            id: true,
            name: true,
            checklistLogin: true,
            legacyId: true,
          },
        },
      },
      take: 5,
    });

    // Fallback case-insensitive se o exato não achou nada (equipamentos legados
    // podem ter chassi em case diferente).
    let candidatos = equipamentos;
    if (candidatos.length === 0) {
      candidatos = await this.prisma.equipment.findMany({
        where: {
          chassi: { equals: chassi, mode: 'insensitive' },
        },
        select: {
          id: true,
          legacyId: true,
          chassi: true,
          companyId: true,
          company: {
            select: {
              id: true,
              name: true,
              checklistLogin: true,
              legacyId: true,
            },
          },
        },
        take: 5,
      });
    }

    if (candidatos.length === 0) {
      this.logger.warn(
        JSON.stringify({
          evento: 'resolver-chassi',
          chassi,
          resultado: 'nao-encontrado',
        }),
      );
      throw new NotFoundException('Chassi não encontrado.');
    }

    // Filtra empresas com checklist_login.chassi === true
    const habilitados = candidatos.filter((e) => {
      const cfg = e.company?.checklistLogin as { chassi?: boolean } | null;
      return cfg?.chassi === true;
    });

    if (habilitados.length === 0) {
      this.logger.warn(
        JSON.stringify({
          evento: 'resolver-chassi',
          chassi,
          resultado: 'nao-habilita',
        }),
      );
      throw new NotFoundException(
        'A empresa vinculada ao chassi não habilita login por chassi.',
      );
    }

    // Distinct por empresa — se o chassi está em >1 empresa habilitada, conflito
    const empresasUnicas = new Map<string, (typeof habilitados)[0]>();
    for (const h of habilitados) {
      if (!empresasUnicas.has(h.companyId)) empresasUnicas.set(h.companyId, h);
    }

    if (empresasUnicas.size > 1) {
      this.logger.warn(
        JSON.stringify({
          evento: 'resolver-chassi',
          chassi,
          resultado: 'conflito',
        }),
      );
      throw new ConflictException(
        'Chassi vinculado a múltiplas empresas com login habilitado.',
      );
    }

    const [primeiro] = habilitados;
    const resultado = {
      /**
       * A credencial que este login não tinha.
       *
       * Sem ela o servidor não sabe para quem responder, e o operador do
       * chassi recebia o catálogo BASE mesmo na empresa que personalizou o
       * dela. A alternativa — o cliente mandar a empresa na requisição — é o
       * antipadrão de deixar quem pergunta afirmar quem é.
       */
      token: await this.emitirTokenDoChassi({
        chassi,
        companyId: primeiro.companyId,
        idMaquina: primeiro.legacyId ?? primeiro.id,
      }),
      // Compat: PWA legado usa `empresaId` como docId Firestore. Preservamos
      // via `legacyId` quando houver, senão UUID Postgres.
      empresaId: primeiro.company?.legacyId ?? primeiro.companyId,
      empresaNome: primeiro.company?.name ?? primeiro.companyId,
      idMaquina: primeiro.legacyId ?? primeiro.id,
      chassi,
    };

    this.logger.log(
      JSON.stringify({
        evento: 'resolver-chassi',
        chassi,
        empresaId: primeiro.companyId,
        resultado: 'ok',
      }),
    );

    return resultado;
  }

  /**
   * `undefined` quando o JWT não está configurado — o fluxo segue sem token,
   * como antes. O que se perde é o recorte por empresa no catálogo, não o
   * login: degradar para "vê o base" é o desfecho certo, e derrubar o login
   * por causa de uma variável de ambiente seria trocar um recorte por uma
   * máquina parada no pátio.
   */
  private async emitirTokenDoChassi(entrada: {
    chassi: string;
    companyId: string;
    idMaquina: string;
  }): Promise<string | undefined> {
    const segredo = this.config?.get<string>('JWT_SECRET');
    if (!this.jwt || !segredo) {
      this.logger.warn(
        JSON.stringify({ evento: 'token-chassi', resultado: 'sem-jwt' }),
      );
      return undefined;
    }
    return this.jwt.signAsync(montarPayloadDoChassi(entrada), {
      secret: segredo,
      expiresIn: VALIDADE_DO_TOKEN_DE_CHASSI,
    });
  }

  async listarChassisDaEmpresa(
    empresaId: string,
  ): Promise<{ chassis: string[]; expiraEm: string }> {
    // `empresaId` pode vir como legacyId (Firestore docId) ou UUID Postgres.
    // Tentamos os dois.
    const equipamentos = await this.prisma.equipment.findMany({
      where: {
        OR: [
          { companyId: this.tryUuid(empresaId) },
          { company: { legacyId: empresaId } },
        ],
        chassi: { not: null },
      },
      select: { chassi: true },
    });

    const set = new Set<string>();
    for (const e of equipamentos) {
      const norm = normalizarChassi(e.chassi ?? '');
      if (norm) set.add(norm);
    }

    const result = {
      chassis: [...set],
      expiraEm: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    };

    this.logger.log(
      JSON.stringify({
        evento: 'listar-chassis-empresa',
        empresaId,
        quantidade: result.chassis.length,
      }),
    );

    return result;
  }

  /**
   * Grava checklist no Postgres quando o operador entrou por chassi (sem JWT
   * Supabase). Valida que o chassi pertence à empresa informada.
   */
  async salvarChecklistRun(
    dto: SalvarChecklistRunDto,
  ): Promise<{ id: string }> {
    const company = await this.resolveCompany(dto.prefeituraId);
    await this.assertEquipamentoDaEmpresa(
      company.id,
      dto.chassis,
      dto.equipamentoId,
    );

    const executedAt = Date.parse(dto.dataHoraIso);
    const row = {
      id: dto.id,
      legacyId: dto.id,
      companyId: company.id,
      operadorNome: dto.operador,
      operadorLegacyId: dto.funcionarioId || null,
      operadorCpf: (dto.funcionarioCpf ?? '').replace(/\D+/g, '') || null,
      chassi: normalizarChassi(dto.chassis),
      categoria: dto.categoria ?? null,
      modelo: dto.modelo ?? null,
      linha: dto.linha ?? null,
      totalItens: dto.totalItens ?? null,
      totalSim: dto.totalSim ?? null,
      totalNao: dto.totalNao ?? null,
      totalNa: dto.totalNa ?? null,
      totalAplicaveis: dto.totalAplicaveis ?? null,
      pontuacao: dto.pontuacao ?? null,
      horimetro: dto.horimetro ?? null,
      respostas:
        dto.respostas === null || dto.respostas === undefined
          ? undefined
          : (dto.respostas as Prisma.InputJsonValue),
      itensNao:
        dto.itensNao === null || dto.itensNao === undefined
          ? undefined
          : (dto.itensNao as Prisma.InputJsonValue),
      // O retrato do documento. Mesmo tratamento de `undefined` dos outros
      // Json: `null` explícito apagaria o retrato num reenvio de app antigo,
      // que é justamente o dado que não dá para recuperar depois.
      itens:
        dto.itens === null || dto.itens === undefined
          ? undefined
          : (dto.itens as Prisma.InputJsonValue),
      definitionLegacyId: dto.definitionLegacyId ?? null,
      obs: dto.obs ?? null,
      fotoHorimetro: dto.fotoHorimetro ?? null,
      assinaturaOperador: dto.assinaturaOperador ?? null,
      localizacaoGps: dto.localizacaoGps ?? null,
      executedAt: Number.isNaN(executedAt) ? new Date() : new Date(executedAt),
    };

    await this.prisma.checklistRun.upsert({
      where: { id: dto.id },
      create: row,
      update: {
        operadorNome: row.operadorNome,
        operadorLegacyId: row.operadorLegacyId,
        operadorCpf: row.operadorCpf,
        chassi: row.chassi,
        categoria: row.categoria,
        modelo: row.modelo,
        linha: row.linha,
        totalItens: row.totalItens,
        totalSim: row.totalSim,
        totalNao: row.totalNao,
        totalNa: row.totalNa,
        totalAplicaveis: row.totalAplicaveis,
        pontuacao: row.pontuacao,
        horimetro: row.horimetro,
        respostas: row.respostas,
        itensNao: row.itensNao,
        itens: row.itens,
        definitionLegacyId: row.definitionLegacyId,
        obs: row.obs,
        fotoHorimetro: row.fotoHorimetro,
        assinaturaOperador: row.assinaturaOperador,
        localizacaoGps: row.localizacaoGps,
        executedAt: row.executedAt,
      },
    });

    this.logger.log(
      JSON.stringify({
        evento: 'salvar-checklist-run',
        id: dto.id,
        companyId: company.id,
        chassi: row.chassi,
      }),
    );

    return { id: dto.id };
  }

  /** Emergência manual/automática — mesmo fluxo do login por chassi. */
  async salvarEmergencia(dto: SalvarEmergenciaDto): Promise<{ id: string }> {
    const company = await this.resolveCompany(dto.prefeituraId);
    if (dto.chassis) {
      await this.assertEquipamentoDaEmpresa(
        company.id,
        dto.chassis,
        dto.idMaquina ?? dto.equipamentoLegacyId,
      );
    }

    const id = dto.id ?? randomUUID();
    const dataHora = Date.parse(dto.dataHoraIso);
    const row = {
      id,
      legacyId: id,
      companyId: company.id,
      source: dto.source,
      severity: dto.severity ?? 'warning',
      chassi: dto.chassis ? normalizarChassi(dto.chassis) : null,
      equipmentLegacyId: dto.equipamentoLegacyId ?? null,
      idMaquina: dto.idMaquina ?? null,
      modelo: dto.modelo ?? null,
      operadorNome: dto.operadorNome ?? null,
      operadorLegacyId: dto.operadorLegacyId ?? null,
      operadorCpf: (dto.operadorCpf ?? '').replace(/\D+/g, '') || null,
      tipoFalha: dto.tipoFalha,
      descricao: dto.descricao,
      localizacaoGps: dto.localizacaoGps ?? null,
      fotos: (dto.fotos ?? []) as Prisma.InputJsonValue,
      checklistLegacyId: dto.checklistLegacyId ?? null,
      questionId: dto.questionId ?? null,
      questionLabel: dto.questionLabel ?? null,
      dataHora: Number.isNaN(dataHora) ? new Date() : new Date(dataHora),
    };

    await this.prisma.emergency.upsert({
      where: { id },
      create: row,
      update: {
        source: row.source,
        severity: row.severity,
        chassi: row.chassi,
        equipmentLegacyId: row.equipmentLegacyId,
        idMaquina: row.idMaquina,
        modelo: row.modelo,
        operadorNome: row.operadorNome,
        operadorLegacyId: row.operadorLegacyId,
        operadorCpf: row.operadorCpf,
        tipoFalha: row.tipoFalha,
        descricao: row.descricao,
        localizacaoGps: row.localizacaoGps,
        fotos: row.fotos,
        checklistLegacyId: row.checklistLegacyId,
        questionId: row.questionId,
        questionLabel: row.questionLabel,
        dataHora: row.dataHora,
      },
    });

    return { id };
  }

  /**
   * Batida de ponto no Postgres quando o operador entrou por chassi (sem JWT
   * Supabase). Espelha a RPC `bater_ponto` — idempotência via `legacyId`.
   */
  async baterPonto(dto: BaterPontoDto, clientId: string) {
    const company = await this.resolveCompany(dto.prefeituraId);
    const nome = dto.name.trim();
    if (!nome) {
      throw new BadRequestException('Nome do operador é obrigatório.');
    }

    const existente = await this.prisma.pontoRegistro.findFirst({
      where: { legacyId: clientId },
    });
    if (existente) {
      if (existente.companyId !== company.id) {
        throw new ConflictException(
          'Idempotency-Key já usada por outra empresa.',
        );
      }
      return this.mapPontoResponse(existente, dto.prefeituraId);
    }

    const cpfDigits = (dto.cpf ?? '').replace(/\D+/g, '') || null;
    let operatorId: string | null = null;
    if (cpfDigits) {
      const op = await this.prisma.operator.findFirst({
        where: { companyId: company.id, cpf: cpfDigits },
        select: { id: true },
      });
      operatorId = op?.id ?? null;
    }

    const timestampOriginal = new Date(dto.timestampOriginal);
    if (Number.isNaN(timestampOriginal.getTime())) {
      throw new BadRequestException('timestampOriginal inválido.');
    }
    const tsLedger = formatTimestampForLedger(dto.timestampOriginal);
    const identificador = cpfDigits || nome;

    const created = await this.prisma.$transaction(async (tx) => {
      await tx.pontoNsrCounter.upsert({
        where: { companyId: company.id },
        create: { companyId: company.id, ultimo: 0, ultimoHash: null },
        update: {},
      });
      await tx.$executeRaw`
        SELECT 1 FROM ponto_nsr_counters
        WHERE company_id = ${company.id}::uuid
        FOR UPDATE
      `;

      const counter = await tx.pontoNsrCounter.findUniqueOrThrow({
        where: { companyId: company.id },
      });

      const nextNsr = counter.ultimo + 1;
      const hashAnterior = counter.ultimoHash ?? '';
      const hash = calcularHashPonto(
        nextNsr,
        company.id,
        identificador,
        dto.tipo,
        tsLedger,
        hashAnterior,
      );

      await tx.pontoNsrCounter.update({
        where: { companyId: company.id },
        data: { ultimo: nextNsr, ultimoHash: hash },
      });

      return tx.pontoRegistro.create({
        data: {
          id: randomUUID(),
          legacyId: clientId,
          companyId: company.id,
          operatorId,
          operatorNome: nome,
          operatorCpf: cpfDigits,
          timestampOriginal,
          tipo: dto.tipo,
          photoUrl: dto.photo ?? null,
          registro: 'original',
          nsr: nextNsr,
          hash,
          hashAnterior: hashAnterior || null,
          aplicado: true,
          latitude: dto.latitude ?? null,
          longitude: dto.longitude ?? null,
          // Coluna é Int; a API de geolocalização informa float (ex.: 12.3).
          precisaoMetros:
            dto.precisaoMetros != null ? Math.round(dto.precisaoMetros) : null,
        },
      });
    });

    this.logger.log(
      JSON.stringify({
        evento: 'bater-ponto-chassi',
        companyId: company.id,
        clientId,
        nsr: created.nsr,
        tipo: dto.tipo,
      }),
    );

    return this.mapPontoResponse(created, dto.prefeituraId);
  }

  private mapPontoResponse(
    row: {
      id: string;
      operatorNome: string;
      operatorCpf: string | null;
      timestampOriginal: Date;
      tipo: string;
      photoUrl: string | null;
      nsr: number;
      hash: string;
      hashAnterior: string | null;
      registro: string;
      aplicado: boolean;
      createdAt: Date;
    },
    prefeituraId: string,
  ) {
    return {
      id: row.id,
      name: row.operatorNome,
      prefeituraId,
      timestampOriginal: row.timestampOriginal.toISOString(),
      tipo: row.tipo,
      photo: row.photoUrl ?? undefined,
      cpf: row.operatorCpf,
      nsr: row.nsr,
      hash: row.hash,
      hashAnterior: row.hashAnterior ?? undefined,
      registro: row.registro,
      aplicado: row.aplicado,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Lista checklists da empresa (login por chassi — sem JWT Supabase). */
  async listarRunsEmpresa(empresaId: string) {
    const company = await this.resolveCompany(empresaId);
    const rows = await this.prisma.checklistRun.findMany({
      where: { companyId: company.id },
      orderBy: { executedAt: 'desc' },
      take: 500,
      select: {
        id: true,
        executedAt: true,
        operadorNome: true,
        chassi: true,
        categoria: true,
        modelo: true,
        linha: true,
        totalItens: true,
        totalSim: true,
        totalNao: true,
        totalNa: true,
        totalAplicaveis: true,
        pontuacao: true,
        horimetro: true,
        assinaturaOperador: true,
        respostas: true,
        obs: true,
        localizacaoGps: true,
        operadorLegacyId: true,
        operadorCpf: true,
      },
    });

    return {
      data: rows.map((r) => ({
        id: r.id,
        executed_at: r.executedAt?.toISOString() ?? null,
        operador_nome: r.operadorNome,
        chassi: r.chassi,
        categoria: r.categoria,
        modelo: r.modelo,
        linha: r.linha,
        total_itens: r.totalItens,
        total_sim: r.totalSim,
        total_nao: r.totalNao,
        total_na: r.totalNa,
        total_aplicaveis: r.totalAplicaveis,
        pontuacao: r.pontuacao,
        horimetro: r.horimetro,
        assinatura_operador: r.assinaturaOperador,
        respostas: r.respostas,
        obs: r.obs,
        localizacao_gps: r.localizacaoGps,
        operador_legacy_id: r.operadorLegacyId,
        operador_cpf: r.operadorCpf,
      })),
    };
  }

  /**
   * Identificação do EMPREGADOR para os papéis de ponto — o CRPT da Portaria
   * 671 exige razão social e CNPJ/CAEPF do empregador, além do município.
   *
   * Devolve os campos CRUS, sem formatar: quem monta o cabeçalho é o
   * aparelho, e as regras de fallback ("razão social, senão nome comercial")
   * são de apresentação. Assim as duas pontas não divergem em qual campo
   * mostrar — existe uma implementação só, testável sem banco.
   *
   * Procura pelos dois ids porque o aparelho guarda `empresaId` como o docId
   * do Firestore (é o que o login por chassi devolve); só por `id`, toda
   * empresa migrada do legado sairia sem empregador no comprovante.
   */
  async empregadorDaEmpresa(empresaId: string) {
    const company = await this.prisma.company.findFirst({
      where: {
        OR: [{ id: this.tryUuid(empresaId) }, { legacyId: empresaId }],
      },
      select: {
        razaoSocial: true,
        name: true,
        cnpj: true,
        caepf: true,
        cidade: true,
        uf: true,
      },
    });
    // 404 e não objeto vazio: vazio viraria um comprovante com "Não
    // informado" em tudo, e ninguém saberia que o problema é o id, não o
    // cadastro.
    if (!company) {
      throw new NotFoundException('Empresa não encontrada.');
    }
    return company;
  }

  private async resolveCompany(prefeituraId: string) {
    const company = await this.prisma.company.findFirst({
      where: {
        OR: [{ id: this.tryUuid(prefeituraId) }, { legacyId: prefeituraId }],
      },
      select: { id: true, legacyId: true },
    });
    if (!company) {
      throw new NotFoundException('Empresa não encontrada.');
    }
    return company;
  }

  private async assertEquipamentoDaEmpresa(
    companyId: string,
    chassiInput: string,
    equipamentoId?: string | null,
  ) {
    const chassi = normalizarChassi(chassiInput);
    if (!chassi) {
      throw new BadRequestException('Chassi inválido.');
    }

    const equip = await this.prisma.equipment.findFirst({
      where: {
        companyId,
        OR: [{ chassi }, { chassi: { equals: chassi, mode: 'insensitive' } }],
      },
      select: { id: true, legacyId: true },
    });

    if (!equip) {
      throw new NotFoundException(
        'Chassi não pertence ao cadastro desta empresa.',
      );
    }

    if (equipamentoId) {
      const ids = new Set(
        [equip.id, equip.legacyId].filter((v): v is string => Boolean(v)),
      );
      if (!ids.has(equipamentoId)) {
        throw new BadRequestException(
          'Equipamento informado não confere com o chassi.',
        );
      }
    }
  }

  /** Se `id` é UUID válido, devolve; senão devolve string vazia (não bate). */
  private tryUuid(id: string): string {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      id,
    )
      ? id
      : '00000000-0000-0000-0000-000000000000';
  }
}

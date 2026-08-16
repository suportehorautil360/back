import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizarChassi } from './helpers/chassi.helper';

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

  constructor(private readonly prisma: PrismaService) {}

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
        chassi: true,
        companyId: true,
        company: {
          select: { id: true, name: true, checklistLogin: true, legacyId: true },
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
      // Compat: PWA legado usa `empresaId` como docId Firestore. Preservamos
      // via `legacyId` quando houver, senão UUID Postgres.
      empresaId: primeiro.company?.legacyId ?? primeiro.companyId,
      empresaNome: primeiro.company?.name ?? primeiro.companyId,
      idMaquina: primeiro.id,
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

  async listarChassisDaEmpresa(
    empresaId: string,
  ): Promise<{ chassis: string[]; expiraEm: string }> {
    // `empresaId` pode vir como legacyId (Firestore docId) ou UUID Postgres.
    // Tentamos os dois.
    const equipamentos = await this.prisma.equipment.findMany({
      where: {
        OR: [{ companyId: this.tryUuid(empresaId) }, { company: { legacyId: empresaId } }],
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

  /** Se `id` é UUID válido, devolve; senão devolve string vazia (não bate). */
  private tryUuid(id: string): string {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
      ? id
      : '00000000-0000-0000-0000-000000000000';
  }
}

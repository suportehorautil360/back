import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FirebaseService } from '../../config/firebase.service';
import { UpsertCargosPermissaoDto } from './dto/upsert-cargos-permissao.dto';

export type PorCargo = Record<string, string[]>;

export const GRUPO_FROTA = 'Gestão de Frota';
export const GRUPO_MANUTENCAO = 'Manutenção';
export const GRUPO_PESSOAS = 'Pessoas / RH';

/** Defaults (chaves normalizadas) + aliases de cargos antigos. */
export const DEFAULT_POR_CARGO: PorCargo = {
  'operador de manutenção': [GRUPO_MANUTENCAO],
  operador: [GRUPO_MANUTENCAO],
  mecânico: [GRUPO_MANUTENCAO],
  mecanico: [GRUPO_MANUTENCAO],
  motorista: [GRUPO_FROTA],
  comboista: [GRUPO_FROTA],
  'supervisor de rh': [GRUPO_PESSOAS],
  supervisor: [GRUPO_PESSOAS],
};

function normalizarChave(cargo: string): string {
  return cargo.trim().toLowerCase();
}

/** Normaliza chaves do mapa e garante arrays de strings. */
export function normalizarPorCargo(raw: unknown): PorCargo {
  if (!raw || typeof raw !== 'object') return {};
  const out: PorCargo = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const chave = normalizarChave(k);
    if (!chave) continue;
    const grupos = Array.isArray(v)
      ? v.filter((g): g is string => typeof g === 'string' && g.trim() !== '')
      : [];
    out[chave] = grupos;
  }
  return out;
}

/** Merge: defaults por baixo, doc do banco por cima. */
export function resolverPorCargo(raw: PorCargo | undefined): PorCargo {
  return { ...DEFAULT_POR_CARGO, ...normalizarPorCargo(raw) };
}

@Injectable()
export class CargosPermissaoService {
  constructor(private firebaseService: FirebaseService) {}

  private get collection() {
    return this.firebaseService.getFirestore().collection('cargosPermissao');
  }

  async obter(prefeituraId: string): Promise<PorCargo> {
    try {
      const snap = await this.collection
        .where('prefeituraId', '==', prefeituraId)
        .get();
      if (snap.empty) return { ...DEFAULT_POR_CARGO };
      const data = snap.docs[0].data() as { porCargo?: PorCargo };
      return resolverPorCargo(data.porCargo);
    } catch (error) {
      console.error('Erro ao buscar cargos-permissao:', error);
      throw new InternalServerErrorException(
        'Não foi possível buscar as permissões de cargo.',
      );
    }
  }

  async salvar(dto: UpsertCargosPermissaoDto) {
    try {
      const porCargo = normalizarPorCargo(dto.porCargo);
      const snap = await this.collection
        .where('prefeituraId', '==', dto.prefeituraId)
        .get();
      const dados = {
        prefeituraId: dto.prefeituraId,
        porCargo,
        atualizadoEm: new Date().toISOString(),
      };
      if (snap.empty) {
        await this.collection.doc().set({ id: randomUUID(), ...dados });
      } else {
        await this.collection.doc(snap.docs[0].id).update(dados);
      }
      return {
        data: resolverPorCargo(porCargo),
        message: 'Permissões de cargo salvas!',
      };
    } catch (error) {
      console.error('Erro ao salvar cargos-permissao:', error);
      throw new InternalServerErrorException(
        'Não foi possível salvar as permissões de cargo.',
      );
    }
  }
}

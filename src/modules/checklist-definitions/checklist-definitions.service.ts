import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FirebaseService } from '../../config/firebase.service';
import { CreateChecklistDefinitionDto } from './dto/create-checklist-definition.dto';
import { UpdateChecklistDefinitionDto } from './dto/update-checklist-definition.dto';
import { SEED_CHECKLIST_DEFINITIONS } from './seed-data';

export interface ChecklistDefinitionDoc {
  id: string;
  nome: string;
  categoria: string;
  keywords: string[];
  ativo: boolean;
  version: number;
  itens: { ordem: number; texto: string; severidade: string }[];
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class ChecklistDefinitionsService {
  constructor(private firebaseService: FirebaseService) {}

  private get collection() {
    return this.firebaseService
      .getFirestore()
      .collection('checklistDefinitions');
  }

  /**
   * Localiza o documento pelo campo `id` salvo ou, em fallback, pelo id do
   * próprio documento Firestore (docs semeados usam o slug como doc id).
   */
  private async findDocByField(id: string) {
    const ref = await this.collection.where('id', '==', id).get();
    if (!ref.empty) return ref.docs[0];

    const byDocId = await this.collection.doc(id).get();
    if (byDocId.exists) return byDocId;

    throw new NotFoundException('Definição de checklist não encontrada.');
  }

  async create(dto: CreateChecklistDefinitionDto) {
    const id = randomUUID();
    const agora = new Date().toISOString();
    const novo: ChecklistDefinitionDoc = {
      id,
      nome: dto.nome,
      categoria: dto.categoria,
      keywords: Array.isArray(dto.keywords) ? dto.keywords : [],
      ativo: dto.ativo ?? true,
      version: 1,
      itens: Array.isArray(dto.itens) ? dto.itens : [],
      createdAt: agora,
      updatedAt: agora,
    };
    try {
      await this.collection.doc(id).set(novo);
      return { data: novo, message: 'Definição de checklist criada!' };
    } catch (error) {
      console.error('Erro ao salvar definição de checklist:', error);
      throw new InternalServerErrorException(
        'Não foi possível salvar a definição de checklist.',
      );
    }
  }

  /** Lista as definições do catálogo global. `ativo=true` filtra só as ativas. */
  async findAll(somenteAtivas = false) {
    try {
      const ref = await this.collection.get();
      let data = ref.docs.map((doc) => {
        const raw = doc.data() as Partial<ChecklistDefinitionDoc>;
        return { ...raw, id: raw.id ?? doc.id } as ChecklistDefinitionDoc;
      });
      if (somenteAtivas) data = data.filter((d) => d.ativo !== false);
      data.sort((a, b) => (a.nome ?? '').localeCompare(b.nome ?? ''));
      return { data, message: 'Definições de checklist listadas.' };
    } catch (error) {
      console.error('Erro ao listar definições de checklist:', error);
      throw new InternalServerErrorException(
        'Não foi possível listar as definições de checklist.',
      );
    }
  }

  async findById(id: string) {
    const doc = await this.findDocByField(id);
    return { data: doc.data(), message: 'Definição encontrada.' };
  }

  async updateById(id: string, dto: UpdateChecklistDefinitionDto) {
    try {
      const doc = await this.findDocByField(id);
      const atual = doc.data() as ChecklistDefinitionDoc;

      const patch: Record<string, unknown> = {
        updatedAt: new Date().toISOString(),
      };
      for (const [key, value] of Object.entries(dto)) {
        if (value !== undefined) patch[key] = value;
      }
      // Mudou os itens => sobe a versão (o operador usa isso para invalidar cache).
      if (dto.itens !== undefined) {
        patch.version = (atual.version ?? 1) + 1;
      }

      await this.collection.doc(doc.id).update(patch);
      return {
        data: { id, ...patch },
        message: 'Definição de checklist atualizada!',
      };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      console.error('Erro ao atualizar definição de checklist:', error);
      throw new InternalServerErrorException(
        'Não foi possível atualizar a definição de checklist.',
      );
    }
  }

  /**
   * Desativa a definição (soft-delete): preserva runs históricos que a
   * referenciam por `definitionId`, mas tira do catálogo do operador.
   */
  async deleteById(id: string) {
    try {
      const doc = await this.findDocByField(id);
      await this.collection.doc(doc.id).update({
        ativo: false,
        updatedAt: new Date().toISOString(),
      });
      return { data: { id }, message: 'Definição de checklist desativada.' };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      console.error('Erro ao desativar definição de checklist:', error);
      throw new InternalServerErrorException(
        'Não foi possível desativar a definição de checklist.',
      );
    }
  }

  /**
   * Bootstrap idempotente: popula o catálogo com as variantes do seed (migradas
   * do `hu360OperadorSeed.json`). No-op se já houver definições, salvo `force`.
   * Usa o slug como doc id, então re-rodar não duplica.
   */
  async seedDefaults(force = false) {
    try {
      const existente = await this.collection.limit(1).get();
      if (!existente.empty && !force) {
        return {
          data: [],
          message: 'Catálogo já populado — seed ignorado (use ?force=true).',
        };
      }

      const agora = new Date().toISOString();
      const gravadas: ChecklistDefinitionDoc[] = [];
      for (const def of SEED_CHECKLIST_DEFINITIONS) {
        const ref = this.collection.doc(def.slug);
        const snap = await ref.get();
        const version =
          (snap.exists ? (snap.data() as ChecklistDefinitionDoc).version : 0) ||
          0;
        const doc: ChecklistDefinitionDoc = {
          id: def.slug,
          nome: def.nome,
          categoria: def.categoria,
          keywords: def.keywords,
          ativo: true,
          version: version + 1,
          itens: def.itens,
          createdAt: snap.exists
            ? ((snap.data() as ChecklistDefinitionDoc).createdAt ?? agora)
            : agora,
          updatedAt: agora,
        };
        await ref.set(doc);
        gravadas.push(doc);
      }
      return {
        data: gravadas,
        message: `Seed concluído: ${gravadas.length} definições gravadas.`,
      };
    } catch (error) {
      console.error('Erro ao semear definições de checklist:', error);
      throw new InternalServerErrorException(
        'Não foi possível semear as definições de checklist.',
      );
    }
  }
}

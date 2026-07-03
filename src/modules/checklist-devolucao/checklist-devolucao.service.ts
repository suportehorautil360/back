import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FirebaseService } from '../../config/firebase.service';
import { EquipamentosService } from '../equipamentos/equipamentos.service';
import { GarantiasService } from '../garantias/garantias.service';
import { parseHorimetro } from '../garantias/helpers/parse-horimetro.helper';
import { nomeFromOficinaDoc } from '../os/helpers/especialidade-oficina.helper';
import {
  assertOficinaTemOrcamentoNaSolicitacao,
  resolveSolicitacaoIdPorProtocolo,
} from '../os/helpers/oficina-orcamento-solicitacao.helper';
import type { ChecklistDevolucaoDoc } from './checklist-devolucao.types';
import { ConferirChecklistDevolucaoDto } from './dto/conferir-checklist-devolucao.dto';
import {
  buildChecklistDevolucaoDoc,
  mapChecklistDevolucaoFromFirestore,
  mapGeneralStateItems,
} from './helpers/checklist-devolucao.mapper';
import { nextNumeroDevolucao } from './helpers/gerar-numero-devolucao.helper';
import {
  countPartsHintInRawBody,
  extractPartsFromPatchBody,
  normalizeCreateChecklistDevolucaoDto,
} from './helpers/normalize-chd-payload.helper';
import {
  buildChdCreateResponseFields,
  chdBadRequest,
} from './helpers/chd-response.helper';
import { parseChdRequestBody } from './helpers/parse-chd-body.helper';
import {
  mergeIdentificationOs,
  resolveOsProtocolo,
} from './helpers/resolve-os-protocolo.helper';

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

@Injectable()
export class ChecklistDevolucaoService {
  constructor(
    private readonly firebaseService: FirebaseService,
    private readonly garantiasService: GarantiasService,
    private readonly equipamentosService: EquipamentosService,
  ) {}

  private get collection() {
    return this.firebaseService.getFirestore().collection('checklistsDevolucao');
  }

  private get solicitacoesCollection() {
    return this.firebaseService.getFirestore().collection('solicitacoesOS');
  }

  private get oficinasCollection() {
    return this.firebaseService.getFirestore().collection('oficinas');
  }

  private async equipamentoIdDaSolicitacao(
    solicitacaoOsId: string | null,
  ): Promise<string | null> {
    const solId = texto(solicitacaoOsId);
    if (!solId) return null;
    const snap = await this.solicitacoesCollection.doc(solId).get();
    if (!snap.exists) return null;
    const equipamentoId = texto(
      (snap.data() as Record<string, unknown>).equipamentoId,
    );
    return equipamentoId || null;
  }

  async criar(body: unknown): Promise<ChecklistDevolucaoDoc> {
    const dto = parseChdRequestBody(body);
    const oficinaId = texto(dto.oficinaId).trim();
    if (!oficinaId) {
      throw chdBadRequest('oficinaId é obrigatório.', {
        oficinaId: { message: 'Informe oficinaId no body' },
      });
    }

    const osProtocolo = await resolveOsProtocolo(
      dto,
      this.solicitacoesCollection,
    );
    if (!osProtocolo) {
      throw chdBadRequest(
        'Informe o protocolo da O.S. em identification.os, protocolo/os no body, ou solicitacaoOsId de uma OS existente.',
        {
          'identification.os': {
            message:
              'Protocolo da O.S. ausente — use identification.os, protocolo, os ou solicitacaoOsId',
          },
        },
      );
    }

    let dtoNormalizado = normalizeCreateChecklistDevolucaoDto(
      mergeIdentificationOs(dto, osProtocolo),
    );

    if (!dtoNormalizado.parts.items.length) {
      const fallbackParts = extractPartsFromPatchBody(
        (body as Record<string, unknown>)?.parts ??
          (body as Record<string, unknown>)?.pecas,
      );
      if (fallbackParts.length > 0) {
        dtoNormalizado = {
          ...dtoNormalizado,
          parts: { items: fallbackParts },
        };
      }
    }

    const partsHint = countPartsHintInRawBody(body);
    if (partsHint > 0 && !dtoNormalizado.parts.items.length) {
      throw chdBadRequest(
        'O payload enviou peças em parts.items, mas o servidor não conseguiu interpretá-las.',
        {
          'parts.items': {
            count: partsHint,
            message:
              'Verifique Content-Type: application/json ou envie o JSON no campo data (multipart)',
          },
        },
      );
    }

    if (!texto(dtoNormalizado.identification?.date)) {
      throw chdBadRequest('identification.date é obrigatório.', {
        'identification.date': {
          message: 'Informe identification.date (ex.: 2026-06-23)',
        },
      });
    }

    const solicitacaoOsId =
      texto(dtoNormalizado.solicitacaoOsId) ||
      texto(dto.solicitacaoOsId) ||
      (await resolveSolicitacaoIdPorProtocolo(
        this.solicitacoesCollection,
        osProtocolo,
      ));

    await assertOficinaTemOrcamentoNaSolicitacao(
      this.solicitacoesCollection,
      solicitacaoOsId ?? '',
      oficinaId,
    );

    if (solicitacaoOsId && !texto(dtoNormalizado.solicitacaoOsId)) {
      dtoNormalizado = {
        ...dtoNormalizado,
        solicitacaoOsId,
      };
    }

    const id = texto(dto.id) || randomUUID();
    const createdAt = new Date().toISOString();

    try {
      const number =
        texto(dto.number) ||
        (await nextNumeroDevolucao(this.collection, oficinaId));

      const doc = buildChecklistDevolucaoDoc(id, number, dtoNormalizado, createdAt);
      if (!doc.parts.items.length) {
        console.warn(
          'CHD salvo sem peças — verifique se o POST envia parts.items (JSON) ou campo data em multipart.',
          { id: doc.id, keys: Object.keys(body as object) },
        );
      }
      await this.collection.doc(id).set(doc);

      const equipamentoId = await this.equipamentoIdDaSolicitacao(
        doc.solicitacaoOsId,
      );
      if (equipamentoId) {
        await this.equipamentosService.syncMedicaoFromChecklist(equipamentoId, {
          hourMeter: doc.identification.hourMeter,
          km: doc.identification.currentKm,
        });
      }

      return doc;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Erro ao criar checklist de devolução:', error);
      throw new InternalServerErrorException(
        'Não foi possível salvar o checklist de devolução.',
      );
    }
  }

  async atualizarFotos(
    id: string,
    body: unknown,
  ): Promise<ChecklistDevolucaoDoc> {
    const raw =
      body && typeof body === 'object'
        ? (body as Record<string, unknown>)
        : {};
    const docId = id.trim();
    if (!docId) throw new BadRequestException('id inválido.');

    const temGeneralState = raw.generalState != null;
    const temParts = raw.parts != null;
    if (!temGeneralState && !temParts) {
      throw new BadRequestException(
        'Informe generalState ou parts para atualizar.',
      );
    }

    try {
      const ref = this.collection.doc(docId);
      const snap = await ref.get();
      if (!snap.exists) {
        throw new NotFoundException('Checklist de devolução não encontrado.');
      }

      const atual = mapChecklistDevolucaoFromFirestore(
        snap.id,
        snap.data() as Record<string, unknown>,
      );

      const payload: Record<string, unknown> = {
        updatedAt: new Date().toISOString(),
      };

      if (temGeneralState && raw.generalState) {
        payload.generalState = {
          ...atual.generalState,
          ...mapGeneralStateItems(
            raw.generalState as Record<
              string,
              { status?: string; photo?: string; description?: string }
            >,
          ),
        };
      }

      if (temParts) {
        const partItems = extractPartsFromPatchBody(raw.parts);
        if (partItems.length > 0) {
          payload.parts = { items: partItems };
        }
      }

      await ref.update(payload);

      return mapChecklistDevolucaoFromFirestore(docId, {
        ...(snap.data() as Record<string, unknown>),
        ...payload,
      });
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      console.error('Erro ao atualizar fotos do checklist de devolução:', error);
      throw new InternalServerErrorException(
        'Não foi possível atualizar as fotos do checklist de devolução.',
      );
    }
  }

  async conferir(
    id: string,
    dto: ConferirChecklistDevolucaoDto,
  ): Promise<{
    data: ChecklistDevolucaoDoc;
    garantiasGeradas: number;
    solicitacaoStatus?: string;
    message: string;
  }> {
    const docId = id.trim();
    if (!docId) throw new BadRequestException('id inválido.');

    const conferidoEm = new Date().toISOString();
    const prefeituraConferencia = {
      aceito: dto.aceito,
      observacoes: texto(dto.observacoes) || null,
      conferidoPor: texto(dto.conferidoPor) || null,
      conferidoEm,
    };
    const novoStatus = dto.aceito ? 'aceito' : 'contestado';

    try {
      const ref = this.collection.doc(docId);
      const snap = await ref.get();
      if (!snap.exists) {
        throw new NotFoundException('Checklist de devolução não encontrado.');
      }

      const atual = mapChecklistDevolucaoFromFirestore(
        snap.id,
        snap.data() as Record<string, unknown>,
      );

      if (atual.status === 'aceito' || atual.status === 'contestado') {
        throw new ConflictException(
          'Este checklist de devolução já foi conferido.',
        );
      }

      let garantiasGeradas = 0;
      let solicitacaoStatus: string | undefined;

      if (dto.aceito) {
        const solId = texto(atual.solicitacaoOsId);
        if (!solId) {
          throw new BadRequestException(
            'solicitacaoOsId é obrigatório para aceitar e gerar garantias.',
          );
        }

        const solSnap = await this.solicitacoesCollection.doc(solId).get();
        if (!solSnap.exists) {
          throw new NotFoundException('Solicitação de OS não encontrada.');
        }

        const sol = solSnap.data() as Record<string, unknown>;
        const equipamentoId = texto(sol.equipamentoId);
        const equipamento = texto(sol.equipamento);
        const prefeituraId =
          texto(atual.prefeituraId) || texto(sol.prefeituraId);

        if (!equipamentoId) {
          throw new BadRequestException(
            'A solicitação de OS não possui equipamentoId para vincular garantias.',
          );
        }

        const oficinaSnap = await this.oficinasCollection
          .doc(atual.oficinaId)
          .get();
        const oficinaData = oficinaSnap.exists
          ? (oficinaSnap.data() as Record<string, unknown>)
          : {};
        const fornecedor = nomeFromOficinaDoc(oficinaData, atual.oficinaId);
        const horimetroAtual =
          parseHorimetro(atual.identification.hourMeter) ??
          parseHorimetro(atual.identification.currentKm);

        const existentes = await this.firebaseService
          .getFirestore()
          .collection('garantias')
          .where('checklistDevolucaoId', '==', docId)
          .get();

        if (!existentes.empty) {
          garantiasGeradas = existentes.size;
        } else {
          const chdAtualizado: ChecklistDevolucaoDoc = {
            ...atual,
            status: novoStatus,
            prefeituraConferencia,
            updatedAt: conferidoEm,
          };

          const registros =
            await this.garantiasService.gerarDeChecklistDevolucao(
              chdAtualizado,
              {
                prefeituraId,
                equipamentoId,
                equipamento,
                fornecedor,
                horimetroAtual,
              },
            );
          garantiasGeradas = registros.length;
        }

        await this.solicitacoesCollection.doc(solId).update({
          status: 'concluido',
          updatedAt: conferidoEm,
        });
        solicitacaoStatus = 'concluido';
      }

      await ref.update({
        status: novoStatus,
        prefeituraConferencia,
        updatedAt: conferidoEm,
      });

      const data = mapChecklistDevolucaoFromFirestore(docId, {
        ...(snap.data() as Record<string, unknown>),
        status: novoStatus,
        prefeituraConferencia,
        updatedAt: conferidoEm,
      });

      return {
        data,
        garantiasGeradas,
        solicitacaoStatus,
        message: dto.aceito
          ? `Devolução aceita. ${garantiasGeradas} item(ns) de garantia registrado(s).`
          : 'Devolução contestada.',
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof ConflictException
      ) {
        throw error;
      }
      console.error('Erro ao conferir checklist de devolução:', error);
      throw new InternalServerErrorException(
        'Não foi possível conferir o checklist de devolução.',
      );
    }
  }

  async obter(id: string): Promise<ChecklistDevolucaoDoc> {
    const docId = id.trim();
    if (!docId) throw new BadRequestException('id inválido.');

    try {
      const snap = await this.collection.doc(docId).get();
      if (!snap.exists) {
        throw new NotFoundException('Checklist de devolução não encontrado.');
      }
      return mapChecklistDevolucaoFromFirestore(
        snap.id,
        snap.data() as Record<string, unknown>,
      );
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      console.error('Erro ao buscar checklist de devolução:', error);
      throw new InternalServerErrorException(
        'Não foi possível buscar o checklist de devolução.',
      );
    }
  }

  async listarPorOficina(
    oficinaId: string,
  ): Promise<{ data: ChecklistDevolucaoDoc[]; message: string }> {
    const id = oficinaId.trim();
    if (!id) throw new BadRequestException('oficinaId inválido.');

    try {
      const snap = await this.collection.where('oficinaId', '==', id).get();

      const data = snap.docs
        .map((doc) =>
          mapChecklistDevolucaoFromFirestore(
            doc.id,
            doc.data() as Record<string, unknown>,
          ),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

      return {
        data,
        message: 'Checklists de devolução carregados com sucesso.',
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Erro ao listar checklists de devolução:', error);
      throw new InternalServerErrorException(
        'Não foi possível listar os checklists de devolução.',
      );
    }
  }

  async listarPorPrefeitura(
    prefeituraId: string,
  ): Promise<{ data: ChecklistDevolucaoDoc[]; message: string }> {
    const id = prefeituraId.trim();
    if (!id) throw new BadRequestException('prefeituraId inválido.');

    try {
      const [directSnap, solSnap] = await Promise.all([
        this.collection.where('prefeituraId', '==', id).get(),
        this.solicitacoesCollection.where('prefeituraId', '==', id).get(),
      ]);

      const porId = new Map<string, ChecklistDevolucaoDoc>();

      for (const doc of directSnap.docs) {
        porId.set(
          doc.id,
          mapChecklistDevolucaoFromFirestore(
            doc.id,
            doc.data() as Record<string, unknown>,
          ),
        );
      }

      const solIds = solSnap.docs.map((doc) => doc.id);
      for (let i = 0; i < solIds.length; i += 30) {
        const chunk = solIds.slice(i, i + 30);
        if (chunk.length === 0) continue;
        const linkedSnap = await this.collection
          .where('solicitacaoOsId', 'in', chunk)
          .get();
        for (const doc of linkedSnap.docs) {
          if (porId.has(doc.id)) continue;
          porId.set(
            doc.id,
            mapChecklistDevolucaoFromFirestore(
              doc.id,
              doc.data() as Record<string, unknown>,
            ),
          );
        }
      }

      const data = Array.from(porId.values()).sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      );

      return {
        data,
        message: 'Checklists de devolução carregados com sucesso.',
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Erro ao listar checklists de devolução:', error);
      throw new InternalServerErrorException(
        'Não foi possível listar os checklists de devolução.',
      );
    }
  }
}

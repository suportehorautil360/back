import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { FieldValue } from 'firebase-admin/firestore';
import { FirebaseService } from '../../../config/firebase.service';
import { NotificacoesService } from '../../notificacoes/notificacoes.service';
import { nomeFromOficinaDoc } from '../helpers/especialidade-oficina.helper';
import {
  mergeLance,
  parseOficinasIds,
  parseOficinasResponderam,
  statusAposOrcamento,
} from '../helpers/lances-os.helper';
import type { CreateOrcamentoResult, LanceOs } from '../os.types';
import { CreateOrcamentoDto } from './dto/create-orcamento.dto';
import { UpdateOrcamentoDto } from './dto/update-orcamento.dto';
import { mapOrdemServicoListItem } from '../helpers/ordem-servico-list.helper';
import {
  ordemPermiteEdicao,
  solicitacaoPermiteEdicaoOrcamento,
  solicitacaoPermiteNovoOrcamento,
} from './helpers/editar-orcamento.helper';
import { parseOrcamentoItemsFromDto } from './helpers/orcamento-items.helper';
import {
  mapOrdemToOrcamentoApi,
  type OrcamentoApiItem,
} from './helpers/orcamento-response.helper';

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function fmtBRL(valor: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor);
}

@Injectable()
export class OrcamentosService {
  constructor(
    private readonly firebaseService: FirebaseService,
    private readonly notificacoes: NotificacoesService,
  ) {}

  private get solicitacoesCollection() {
    return this.firebaseService.getFirestore().collection('solicitacoesOS');
  }

  private get ordensCollection() {
    return this.firebaseService.getFirestore().collection('ordensServico');
  }

  private get oficinasCollection() {
    return this.firebaseService.getFirestore().collection('oficinas');
  }

  async criar(dto: CreateOrcamentoDto): Promise<CreateOrcamentoResult> {
    const solicitacaoOsId = dto.solicitacaoOsId.trim();
    const oficinaId = dto.oficinaId.trim();

    const { itens, valorTotal } = parseOrcamentoItemsFromDto(dto.items);
    const prazoDias = dto.prazoDias ?? 7;
    const solRef = this.solicitacoesCollection.doc(solicitacaoOsId);
    const oficinaSnap = await this.oficinasCollection.doc(oficinaId).get();
    const oficinaData = oficinaSnap.exists
      ? (oficinaSnap.data() as Record<string, unknown>)
      : {};
    const oficinaNome = nomeFromOficinaDoc(oficinaData, oficinaId);

    try {
      const result = await this.firebaseService
        .getFirestore()
        .runTransaction(async (tx) => {
          const solSnap = await tx.get(solRef);
          if (!solSnap.exists) {
            throw new NotFoundException('Solicitação de OS não encontrada.');
          }

          const sol = solSnap.data() as Record<string, unknown>;
          const statusAtual = texto(sol.status) || 'aguardando_orcamento';
          if (!solicitacaoPermiteNovoOrcamento(statusAtual)) {
            throw new BadRequestException(
              'Esta solicitação não está aceitando novos orçamentos.',
            );
          }

          const oficinasIds = parseOficinasIds(sol.oficinasIds);
          if (!oficinasIds.includes(oficinaId)) {
            throw new BadRequestException(
              'Esta oficina não foi convidada para esta OS.',
            );
          }

          const responderam = parseOficinasResponderam(sol.oficinasResponderam);
          if (responderam.includes(oficinaId)) {
            throw new ConflictException(
              'Esta oficina já enviou orçamento para esta OS.',
            );
          }

          const dupSnap = await tx.get(
            this.ordensCollection
              .where('solicitacaoOsId', '==', solicitacaoOsId)
              .where('oficinaId', '==', oficinaId)
              .limit(1),
          );
          if (!dupSnap.empty) {
            throw new ConflictException(
              'Já existe orçamento desta oficina para esta solicitação.',
            );
          }

          const protocolo =
            texto(dto.protocol) || texto(sol.protocolo) || solicitacaoOsId;
          const prefeituraId = texto(sol.prefeituraId);
          const ordemRef = this.ordensCollection.doc();
          const agora = new Date().toISOString();

          tx.set(ordemRef, {
            id: ordemRef.id,
            protocolo,
            prefeituraId,
            solicitacaoOsId,
            oficinaId,
            oficinaNome,
            operador: oficinaNome,
            equipamento: texto(sol.equipamento),
            defeito: texto(sol.relato),
            itens,
            valorTotal,
            prazoDias,
            fotosComprovacao: dto.fotosComprovacao.map((url) => url.trim()),
            status: 'em_pregao',
            criadoEm: FieldValue.serverTimestamp(),
          });

          const lance: LanceOs = {
            oficinaId,
            valor: valorTotal,
            prazoDias,
            ordemServicoId: ordemRef.id,
            atualizadoEm: agora,
          };

          const lancesAtualizados = mergeLance(
            Array.isArray(sol.lances) ? (sol.lances as LanceOs[]) : [],
            lance,
          );
          const responderamAtualizados = [...responderam, oficinaId];
          const novoStatus = statusAposOrcamento(
            oficinasIds,
            responderamAtualizados,
          );

          tx.update(solRef, {
            oficinasResponderam: FieldValue.arrayUnion(oficinaId),
            lances: lancesAtualizados,
            status: novoStatus,
          });

          return {
            id: ordemRef.id,
            protocol: protocolo,
            valorTotal,
            prazoDias,
            solicitacaoStatus: novoStatus,
            prefeituraId,
            oficinaNome,
          };
        });

      // Notifica o RH da prefeitura. Falha da notificação não quebra o envio.
      if (result.prefeituraId) {
        try {
          await this.notificacoes.create({
            destinatarioTipo: 'rh',
            destinatarioId: result.prefeituraId,
            prefeituraId: result.prefeituraId,
            tipo: 'info',
            titulo: `Novo orçamento: ${result.protocol}`,
            mensagem: `${result.oficinaNome} enviou orçamento de ${fmtBRL(
              result.valorTotal,
            )} (prazo: ${result.prazoDias} dia${
              result.prazoDias === 1 ? '' : 's'
            }).`,
            referenciaTipo: 'orcamento',
            referenciaId: result.id,
          });
        } catch (notifErr) {
          console.warn(
            'Não foi possível notificar a prefeitura sobre o orçamento:',
            notifErr,
          );
        }
      }

      return {
        id: result.id,
        protocol: result.protocol,
        valorTotal: result.valorTotal,
        prazoDias: result.prazoDias,
        solicitacaoStatus: result.solicitacaoStatus,
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof ConflictException
      ) {
        throw error;
      }
      console.error('Erro ao enviar orçamento:', error);
      throw new InternalServerErrorException(
        'Não foi possível enviar o orçamento.',
      );
    }
  }

  async atualizar(
    id: string,
    dto: UpdateOrcamentoDto,
  ): Promise<CreateOrcamentoResult> {
    const ordemId = id.trim();
    const oficinaId = dto.oficinaId.trim();

    if (!ordemId) {
      throw new BadRequestException('id inválido.');
    }
    if (!oficinaId) {
      throw new BadRequestException('oficinaId inválido.');
    }

    const { itens, valorTotal } = parseOrcamentoItemsFromDto(dto.items);
    const ordemRef = this.ordensCollection.doc(ordemId);

    try {
      const result = await this.firebaseService
        .getFirestore()
        .runTransaction(async (tx) => {
          const ordemSnap = await tx.get(ordemRef);
          if (!ordemSnap.exists) {
            throw new NotFoundException('Orçamento não encontrado.');
          }

          const ordem = ordemSnap.data() as Record<string, unknown>;
          const ordemOficinaId = texto(ordem.oficinaId);

          if (ordemOficinaId !== oficinaId) {
            throw new BadRequestException(
              'Esta oficina não pode editar este orçamento.',
            );
          }

          if (!ordemPermiteEdicao(ordem.status)) {
            throw new BadRequestException(
              'Este orçamento não pode mais ser editado.',
            );
          }

          const solicitacaoOsId = texto(ordem.solicitacaoOsId);
          if (!solicitacaoOsId) {
            throw new BadRequestException(
              'Orçamento sem vínculo com solicitação de OS.',
            );
          }

          const solRef = this.solicitacoesCollection.doc(solicitacaoOsId);
          const solSnap = await tx.get(solRef);
          if (!solSnap.exists) {
            throw new NotFoundException('Solicitação de OS não encontrada.');
          }

          const sol = solSnap.data() as Record<string, unknown>;
          const statusAtual = texto(sol.status) || 'aguardando_orcamento';

          if (!solicitacaoPermiteEdicaoOrcamento(statusAtual)) {
            throw new BadRequestException(
              'Esta solicitação não permite edição de orçamento.',
            );
          }

          const oficinasIds = parseOficinasIds(sol.oficinasIds);
          if (!oficinasIds.includes(oficinaId)) {
            throw new BadRequestException(
              'Esta oficina não foi convidada para esta OS.',
            );
          }

          const responderam = parseOficinasResponderam(sol.oficinasResponderam);
          if (!responderam.includes(oficinaId)) {
            throw new BadRequestException(
              'Esta oficina ainda não enviou orçamento para esta OS.',
            );
          }

          const prazoDias =
            dto.prazoDias ??
            Math.max(1, Math.round(Number(ordem.prazoDias) || 7));
          const protocolo =
            texto(ordem.protocolo) || texto(ordem.protocol) || ordemId;
          const agora = new Date().toISOString();

          tx.update(ordemRef, {
            itens,
            valorTotal,
            prazoDias,
            fotosComprovacao: dto.fotosComprovacao.map((url) => url.trim()),
            atualizadoEm: agora,
          });

          const lance: LanceOs = {
            oficinaId,
            valor: valorTotal,
            prazoDias,
            ordemServicoId: ordemId,
            atualizadoEm: agora,
          };

          const lancesAtualizados = mergeLance(
            Array.isArray(sol.lances) ? (sol.lances as LanceOs[]) : [],
            lance,
          );

          tx.update(solRef, {
            lances: lancesAtualizados,
          });

          return {
            id: ordemId,
            protocol: protocolo,
            valorTotal,
            prazoDias,
            solicitacaoStatus: statusAtual,
          };
        });

      return result;
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      console.error('Erro ao atualizar orçamento:', error);
      throw new InternalServerErrorException(
        'Não foi possível atualizar o orçamento.',
      );
    }
  }

  async listarPorOficina(
    oficinaId: string,
  ): Promise<{ data: OrcamentoApiItem[]; message: string }> {
    const id = oficinaId.trim();
    if (!id) {
      throw new BadRequestException('oficinaId inválido.');
    }

    try {
      const snap = await this.ordensCollection.where('oficinaId', '==', id).get();

      const ordens = snap.docs
        .map((doc) =>
          mapOrdemServicoListItem(doc.id, doc.data() as Record<string, unknown>),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

      const statusPorSolicitacao = await this.loadSolicitacaoStatusMap(
        ordens.map((ordem) => ordem.solicitacaoOsId),
      );

      const data = ordens.map((ordem) =>
        mapOrdemToOrcamentoApi(
          ordem,
          statusPorSolicitacao.get(ordem.solicitacaoOsId),
        ),
      );

      return {
        data,
        message: 'Orçamentos da oficina carregados com sucesso.',
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Erro ao listar orçamentos da oficina:', error);
      throw new InternalServerErrorException(
        'Não foi possível carregar os orçamentos da oficina.',
      );
    }
  }

  async obterPorId(
    id: string,
    oficinaId?: string,
  ): Promise<{ data: OrcamentoApiItem; message: string }> {
    const docId = id.trim();
    if (!docId) {
      throw new BadRequestException('id inválido.');
    }

    try {
      const ordem = await this.resolveOrdem(docId, oficinaId);
      if (!ordem) {
        throw new NotFoundException('Orçamento não encontrado.');
      }

      const status = await this.loadSolicitacaoStatus(ordem.solicitacaoOsId);

      return {
        data: mapOrdemToOrcamentoApi(ordem, status),
        message: 'Orçamento encontrado.',
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      console.error('Erro ao obter orçamento:', error);
      throw new InternalServerErrorException(
        'Não foi possível carregar o orçamento.',
      );
    }
  }

  private async resolveOrdem(
    id: string,
    oficinaId?: string,
  ): Promise<ReturnType<typeof mapOrdemServicoListItem> | null> {
    const direct = await this.ordensCollection.doc(id).get();
    if (direct.exists) {
      return mapOrdemServicoListItem(
        direct.id,
        direct.data() as Record<string, unknown>,
      );
    }

    const oficina = texto(oficinaId);
    if (oficina) {
      const bySol = await this.ordensCollection
        .where('solicitacaoOsId', '==', id)
        .where('oficinaId', '==', oficina)
        .limit(1)
        .get();
      if (!bySol.empty) {
        const doc = bySol.docs[0];
        return mapOrdemServicoListItem(
          doc.id,
          doc.data() as Record<string, unknown>,
        );
      }
    }

    const bySolOnly = await this.ordensCollection
      .where('solicitacaoOsId', '==', id)
      .limit(oficina ? 1 : 20)
      .get();

    if (bySolOnly.empty) return null;

    const doc =
      oficina && bySolOnly.docs.length > 1
        ? bySolOnly.docs.find(
            (entry) =>
              texto((entry.data() as Record<string, unknown>).oficinaId) ===
              oficina,
          ) ?? bySolOnly.docs[0]
        : bySolOnly.docs[0];

    return mapOrdemServicoListItem(
      doc.id,
      doc.data() as Record<string, unknown>,
    );
  }

  private async loadSolicitacaoStatus(solicitacaoOsId: string): Promise<string> {
    if (!solicitacaoOsId) return '';
    const snap = await this.solicitacoesCollection.doc(solicitacaoOsId).get();
    if (!snap.exists) return '';
    return texto((snap.data() as Record<string, unknown>).status);
  }

  private async loadSolicitacaoStatusMap(
    solicitacaoIds: string[],
  ): Promise<Map<string, string>> {
    const unique = [...new Set(solicitacaoIds.filter(Boolean))];
    const entries = await Promise.all(
      unique.map(async (solId) => {
        const status = await this.loadSolicitacaoStatus(solId);
        return [solId, status] as const;
      }),
    );
    return new Map(entries);
  }
}

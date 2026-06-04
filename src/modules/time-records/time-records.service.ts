import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FirebaseService } from '../../config/firebase.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { CreateTimeRecordDto } from './dto/create-time-record.dto';
import { UpdateTimeRecordDto } from './dto/update-time-record.dto';
import { selarRegistro } from './ledger';

@Injectable()
export class TimeRecordsService {
  constructor(
    private firebaseService: FirebaseService,
    private featureFlags: FeatureFlagsService,
  ) {}

  private get collection() {
    return this.firebaseService.getFirestore().collection('timeRecords');
  }

  /**
   * Versão legível em horário de Brasília (ex.: "26/05/2026 18:07") só para
   * leitura/auditoria no console. A fonte de verdade segue em UTC
   * (timestampOriginal).
   */
  private horaLocalBR(iso: string): string {
    const d = new Date(iso);
    const tz = 'America/Sao_Paulo';
    const data = d.toLocaleDateString('pt-BR', {
      timeZone: tz,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    const hora = d.toLocaleTimeString('pt-BR', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
    });
    return `${data} ${hora}`;
  }

  /**
   * Registra uma marcação ORIGINAL do trabalhador no ledger imutável.
   * Recebe NSR sequencial e hash encadeado (Portaria 671). Esse registro
   * NUNCA é alterado nem apagado depois.
   */
  async create(dto: CreateTimeRecordDto) {
    if (!(await this.featureFlags.ativo(dto.prefeituraId, 'ponto'))) {
      throw new ForbiddenException(
        'O ponto não está ativo para esta prefeitura.',
      );
    }
    const id = randomUUID();
    const db = this.firebaseService.getFirestore();
    try {
      const novo = await db.runTransaction(async (tx) => {
        const selo = await selarRegistro(db, tx, {
          prefeituraId: dto.prefeituraId,
          identificador: dto.cpf?.trim() || dto.name,
          tipo: dto.tipo,
          timestampOriginal: dto.timestampOriginal,
          registro: 'original',
        });
        const doc = {
          id,
          name: dto.name,
          cpf: dto.cpf?.trim() || null,
          photo: dto.photo,
          prefeituraId: dto.prefeituraId,
          timestampOriginal: dto.timestampOriginal,
          horaLocalBR: this.horaLocalBR(dto.timestampOriginal),
          tipo: dto.tipo,
          // Natureza no ledger: marcação original do trabalhador (imutável).
          registro: 'original' as const,
          nsr: selo.nsr,
          hash: selo.hash,
          hashAnterior: selo.hashAnterior,
          createdAt: new Date().toISOString(),
        };
        tx.set(this.collection.doc(id), doc);
        return doc;
      });
      return { data: novo, message: 'Ponto registrado com sucesso!' };
    } catch (error) {
      console.error('Erro ao registrar ponto:', error);
      throw new InternalServerErrorException(
        'Não foi possível registrar o ponto. Tente novamente mais tarde.',
      );
    }
  }

  /**
   * Correção de horário pelo operador. NÃO altera a batida original (a
   * Portaria 671 proíbe). Cria um novo registro de AJUSTE no ledger, apontando
   * para o NSR da original via `refNsr`, que fica `aplicado: false` até o RH
   * aprovar. O espelho segue mostrando o horário ORIGINAL como oficial até lá.
   */
  async update(id: string, dto: UpdateTimeRecordDto) {
    const db = this.firebaseService.getFirestore();
    try {
      const snap = await this.collection.where('id', '==', id).get();
      if (snap.empty) {
        throw new NotFoundException(
          'Batida não encontrada para o ID fornecido.',
        );
      }
      const original = snap.docs[0].data() as {
        prefeituraId: string;
        name: string;
        cpf?: string | null;
        tipo: string;
        nsr?: number;
        id: string;
      };

      const novoId = randomUUID();
      const ajuste = await db.runTransaction(async (tx) => {
        const selo = await selarRegistro(db, tx, {
          prefeituraId: original.prefeituraId,
          identificador: original.cpf?.trim() || original.name,
          tipo: original.tipo,
          timestampOriginal: dto.timestampOriginal,
          registro: 'ajuste',
          refNsr: original.nsr ?? null,
        });
        const doc = {
          id: novoId,
          name: original.name,
          cpf: original.cpf ?? null,
          prefeituraId: original.prefeituraId,
          tipo: original.tipo,
          timestampOriginal: dto.timestampOriginal,
          horaLocalBR: this.horaLocalBR(dto.timestampOriginal),
          registro: 'ajuste' as const,
          // Alvo da correção: NSR (preferido) e id (fallback p/ legado sem NSR).
          refNsr: original.nsr ?? null,
          refId: original.id,
          // Pendente até o RH aprovar — a original continua valendo no espelho.
          aplicado: false,
          motivo: dto.motivo?.trim() || null,
          createdAt: new Date().toISOString(),
          nsr: selo.nsr,
          hash: selo.hash,
          hashAnterior: selo.hashAnterior,
        };
        tx.set(this.collection.doc(novoId), doc);
        return doc;
      });
      return {
        data: ajuste,
        message: 'Correção registrada. Aguardando aprovação do RH.',
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      console.error('Erro ao registrar correção de ponto:', error);
      throw new InternalServerErrorException(
        'Não foi possível registrar a correção. Tente novamente mais tarde.',
      );
    }
  }

  /**
   * Aplica/recusa um registro de AJUSTE ou CANCELAMENTO na folha (RH). A
   * marcação ORIGINAL do trabalhador nunca pode ser avaliada nem alterada
   * (Portaria 671) — tentar fazê-lo retorna 403. Aprovar/reprovar só alterna
   * o flag `aplicado` (metadado de tratamento), sem tocar nos dados/hash da
   * marcação.
   */
  private async tratarAjuste(
    id: string,
    patch: { aplicado: boolean; motivoReprovacao: string | null },
  ) {
    const snap = await this.collection.where('id', '==', id).get();
    if (snap.empty) {
      throw new NotFoundException('Registro não encontrado para o ID fornecido.');
    }
    const docId = snap.docs[0].id;
    const data = snap.docs[0].data() as { registro?: string };
    if ((data.registro ?? 'original') === 'original') {
      throw new ForbiddenException(
        'A marcação original do trabalhador não pode ser aprovada, reprovada ou alterada (Portaria 671). Apenas ajustes/cancelamentos podem ser avaliados.',
      );
    }
    await this.collection.doc(docId).update({
      ...patch,
      avaliadoEm: new Date().toISOString(),
    });
    return { data: {}, message: 'Status atualizado com sucesso!' };
  }

  async aprovar(id: string) {
    try {
      return await this.tratarAjuste(id, {
        aplicado: true,
        motivoReprovacao: null,
      });
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      )
        throw error;
      console.error('Erro ao aprovar ajuste de ponto:', error);
      throw new InternalServerErrorException(
        'Não foi possível aprovar o ajuste. Tente novamente mais tarde.',
      );
    }
  }

  async reprovar(id: string, motivo: string) {
    try {
      return await this.tratarAjuste(id, {
        aplicado: false,
        motivoReprovacao: motivo,
      });
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      )
        throw error;
      console.error('Erro ao reprovar ajuste de ponto:', error);
      throw new InternalServerErrorException(
        'Não foi possível reprovar o ajuste. Tente novamente mais tarde.',
      );
    }
  }

  async findAllById(prefeituraId: string) {
    try {
      const snap = await this.collection
        .where('prefeituraId', '==', prefeituraId)
        .get();

      // Lista vazia é resultado válido (200, não 404) — sem batidas ainda.
      const data = snap.docs.map((doc) => doc.data());
      return { data, message: 'Pontos buscados com sucesso!' };
    } catch (error) {
      console.error('Erro ao buscar pontos:', error);
      throw new InternalServerErrorException(
        'Não foi possível buscar os pontos. Tente novamente mais tarde.',
      );
    }
  }
}

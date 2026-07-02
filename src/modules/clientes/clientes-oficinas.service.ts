import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { FirebaseService } from '../../config/firebase.service';
import {
  especialidadeFromOficinaDoc,
  nomeFromOficinaDoc,
} from '../os/helpers/especialidade-oficina.helper';
import {
  ehOficinaAtiva,
  mapOficinaCredenciadaDoc,
} from '../os/helpers/oficinas-credenciadas.helper';
import type { OficinaCredenciadaListItem } from './clientes-oficinas.types';

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function listaTexto(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  return valor.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
}

@Injectable()
export class ClientesOficinasService {
  constructor(private readonly firebaseService: FirebaseService) {}

  private get db(): Firestore {
    return this.firebaseService.getFirestore();
  }

  async listarCredenciadas(
    prefeituraId: string,
  ): Promise<{ data: OficinaCredenciadaListItem[]; message: string }> {
    await this.assertClienteExiste(prefeituraId);

    try {
      const snap = await this.db
        .collection('oficinas')
        .where('prefeituraId', '==', prefeituraId)
        .get();

      const data = snap.docs
        .map((doc) => this.mapListItem(doc.id, doc.data() as Record<string, unknown>))
        .filter((item): item is OficinaCredenciadaListItem => item !== null)
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

      return {
        data,
        message: 'Oficinas credenciadas carregadas com sucesso.',
      };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      console.error('Erro ao listar oficinas credenciadas:', error);
      throw new InternalServerErrorException(
        'Não foi possível listar as oficinas credenciadas.',
      );
    }
  }

  async credenciar(prefeituraId: string, parceiroId: string) {
    await this.assertClienteExiste(prefeituraId);

    const parceiroRef = this.db.collection('oficinas').doc(parceiroId);
    const parceiroSnap = await parceiroRef.get();
    if (!parceiroSnap.exists) {
      throw new NotFoundException('Parceiro oficina não encontrado.');
    }

    const parceiro = parceiroSnap.data() as Record<string, unknown>;
    const nome = nomeFromOficinaDoc(parceiro, parceiroId);
    const especialidade = especialidadeFromOficinaDoc(parceiro);
    if (!especialidade) {
      throw new BadRequestException(
        'Informe especialidade ou linhasAtuacao/categoriasServico no cadastro do parceiro.',
      );
    }

    const prefeituraAtual = texto(parceiro.prefeituraId);

    const linhasAtuacao = listaTexto(parceiro.linhasAtuacao);
    const segmentosAtuacao = listaTexto(parceiro.segmentosAtuacao);

    try {
      if (!prefeituraAtual || prefeituraAtual === prefeituraId) {
        const payload = {
          prefeituraId,
          nome,
          especialidade,
          status: 'Ativa',
          parceiroId,
          linhasAtuacao,
          segmentosAtuacao,
          credenciadoEm: new Date().toISOString(),
        };
        await parceiroRef.set(payload, { merge: true });
        return {
          data: { id: parceiroId, prefeituraId, parceiroId, status: 'Ativa' },
          message: 'Oficina credenciada no município.',
        };
      }

      const existente = await this.buscarCredenciamento(prefeituraId, parceiroId);
      if (existente) {
        await existente.ref.update({
          status: 'Ativa',
          nome,
          especialidade,
          linhasAtuacao,
          segmentosAtuacao,
          credenciadoEm: new Date().toISOString(),
        });
        return {
          data: {
            id: existente.id,
            prefeituraId,
            parceiroId,
            status: 'Ativa',
          },
          message: 'Oficina credenciada no município.',
        };
      }

      const credId = randomUUID();
      await this.db
        .collection('oficinas')
        .doc(credId)
        .set({
          id: credId,
          prefeituraId,
          parceiroId,
          nome,
          especialidade,
          status: 'Ativa',
          razaoSocial: texto(parceiro.razaoSocial),
          nomeFantasia: texto(parceiro.nomeFantasia),
          cidadeUf: texto(parceiro.cidadeUf),
          endereco: texto(parceiro.endereco),
          linhasAtuacao,
          segmentosAtuacao,
          categoriasServico: parceiro.categoriasServico ?? [],
          tipoParceiro: 'oficina',
          credenciadoEm: new Date().toISOString(),
        });

      return {
        data: { id: credId, prefeituraId, parceiroId, status: 'Ativa' },
        message: 'Oficina credenciada no município.',
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      console.error('Erro ao credenciar oficina:', error);
      throw new InternalServerErrorException(
        'Não foi possível credenciar a oficina.',
      );
    }
  }

  async descredenciar(prefeituraId: string, parceiroId: string) {
    await this.assertClienteExiste(prefeituraId);

    try {
      const credenciamentos = await this.listarDocsCredenciamento(
        prefeituraId,
        parceiroId,
      );

      if (credenciamentos.length === 0) {
        throw new NotFoundException(
          'Nenhum credenciamento ativo encontrado para este município.',
        );
      }

      const batch = this.db.batch();
      for (const { ref } of credenciamentos) {
        batch.update(ref, {
          status: 'Suspensa',
          descredenciadoEm: new Date().toISOString(),
        });
      }
      await batch.commit();

      return { message: 'Oficina descredenciada do município.' };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      console.error('Erro ao descredenciar oficina:', error);
      throw new InternalServerErrorException(
        'Não foi possível descredenciar a oficina.',
      );
    }
  }

  private mapListItem(
    docId: string,
    data: Record<string, unknown>,
  ): OficinaCredenciadaListItem | null {
    const mapped = mapOficinaCredenciadaDoc(docId, data);
    if (!mapped) return null;

    return {
      id: mapped.id,
      nome: mapped.nome,
      especialidade: mapped.especialidade,
      status: texto(data.status) || 'Ativa',
      parceiroId: texto(data.parceiroId) || docId,
      cidadeUf: texto(data.cidadeUf),
      linhasAtuacao: listaTexto(data.linhasAtuacao),
      segmentosAtuacao: mapped.segmentosAtuacao ?? [],
    };
  }

  private async buscarCredenciamento(prefeituraId: string, parceiroId: string) {
    const docs = await this.listarDocsCredenciamento(prefeituraId, parceiroId);
    return docs[0] ?? null;
  }

  private async listarDocsCredenciamento(
    prefeituraId: string,
    parceiroId: string,
  ): Promise<
    Array<{ id: string; ref: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData> }>
  > {
    const snap = await this.db
      .collection('oficinas')
      .where('prefeituraId', '==', prefeituraId)
      .get();

    return snap.docs
      .filter((doc) => {
        const data = doc.data() as Record<string, unknown>;
        if (!ehOficinaAtiva(data.status)) return false;
        const pid = texto(data.parceiroId);
        return doc.id === parceiroId || pid === parceiroId;
      })
      .map((doc) => ({ id: doc.id, ref: doc.ref }));
  }

  private async assertClienteExiste(prefeituraId: string): Promise<void> {
    const id = prefeituraId.trim();
    if (!id) throw new BadRequestException('prefeituraId inválido.');

    const snap = await this.db.collection('clientes').doc(id).get();
    if (!snap.exists) {
      throw new NotFoundException('Cliente (prefeitura) não encontrado.');
    }
  }
}

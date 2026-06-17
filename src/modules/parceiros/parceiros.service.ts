import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FirebaseService } from '../../config/firebase.service';
import {
  OficinaParceiro,
  ParceirosOverview,
  PostoParceiro,
  TipoParceiro,
} from './parceiros.types';
import { CreateParceiroDto } from './dto/create-parceiro.dto';
import {
  especialidadeFromOficinaDoc,
  nomeFromOficinaDoc,
} from '../os/helpers/especialidade-oficina.helper';

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor : '';
}

/** "Ativa"/"ativo" => true; "Suspensa"/etc => false. */
function ehAtivo(status: unknown): boolean {
  return texto(status).toLowerCase().startsWith('ativ');
}

function numero(valor: unknown): number {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
  if (typeof valor === 'string') {
    const limpo = valor
      .replace(/[^0-9,.-]/g, '')
      .replace(/\./g, '')
      .replace(',', '.');
    const n = Number(limpo);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function listaTexto(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  return valor.filter((v): v is string => typeof v === 'string');
}

@Injectable()
export class ParceirosService {
  constructor(private firebaseService: FirebaseService) {}

  /**
   * Rede de parceiros credenciados (todos os clientes): postos e oficinas.
   * A cidade/UF vem do próprio parceiro; para os legados sem cidade, cai no
   * cliente vinculado (`prefeituraId`).
   */
  async overview(): Promise<{ data: ParceirosOverview }> {
    const db = this.firebaseService.getFirestore();
    try {
      const [clientesSnap, postosSnap, oficinasSnap] = await Promise.all([
        db.collection('clientes').get(),
        db.collection('postos').get(),
        db.collection('oficinas').get(),
      ]);

      const clientePorId = new Map<string, { nome: string; uf: string }>();
      for (const doc of clientesSnap.docs) {
        const d = doc.data() as Record<string, unknown>;
        clientePorId.set(doc.id, { nome: texto(d.nome), uf: texto(d.uf) });
      }

      const localDoCliente = (prefeituraId: string): string => {
        const c = clientePorId.get(prefeituraId);
        if (!c || !c.nome) return '';
        return c.uf ? `${c.nome}/${c.uf}` : c.nome;
      };

      const postos: PostoParceiro[] = postosSnap.docs.map((doc) => {
        const d = doc.data() as Record<string, unknown>;
        return {
          id: doc.id,
          nome: texto(d.nomeFantasia) || texto(d.razaoSocial) || '—',
          razaoSocial: texto(d.razaoSocial) || texto(d.nomeFantasia) || '—',
          cidadeUf: texto(d.cidadeUf) || localDoCliente(texto(d.prefeituraId)),
          bandeira: texto(d.bandeira),
          condicaoPagamento: texto(d.condicaoPagamento),
          limiteCredito: numero(d.limiteCredito),
          ativo: ehAtivo(d.status ?? 'Ativa'),
        };
      });

      const oficinas: OficinaParceiro[] = oficinasSnap.docs.map((doc) => {
        const d = doc.data() as Record<string, unknown>;
        const categorias = listaTexto(d.categoriasServico);
        return {
          id: doc.id,
          nome:
            texto(d.nomeFantasia) ||
            texto(d.nome) ||
            texto(d.razaoSocial) ||
            '—',
          razaoSocial: texto(d.razaoSocial) || texto(d.nome) || '—',
          cidadeUf: texto(d.cidadeUf) || localDoCliente(texto(d.prefeituraId)),
          especialidade: texto(d.especialidade) || categorias.join(', '),
          condicaoPagamento: texto(d.condicaoPagamento),
          limiteCredito: numero(d.limiteCredito),
          ativo: ehAtivo(d.status ?? 'Ativa'),
        };
      });

      postos.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
      oficinas.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

      return { data: { postos, oficinas } };
    } catch (error) {
      console.error('Erro ao montar overview de parceiros:', error);
      throw new InternalServerErrorException(
        'Não foi possível carregar os parceiros.',
      );
    }
  }

  /** Cadastra um parceiro (posto ou oficina) na coleção correspondente. */
  async criar(dto: CreateParceiroDto) {
    const tipo: TipoParceiro = dto.tipo === 'oficina' ? 'oficina' : 'posto';
    const razaoSocial = (dto.razaoSocial ?? '').trim();
    if (!razaoSocial) {
      throw new BadRequestException('Informe a razão social do parceiro.');
    }

    const fs = this.firebaseService.getFirestore();
    const id = randomUUID();
    const prefeituraId = (dto.prefeituraId ?? '').trim();
    const comum = {
      id,
      razaoSocial,
      nomeFantasia: (dto.nomeFantasia ?? '').trim(),
      cnpj: (dto.cnpj ?? '').trim(),
      telefonePrincipal: (dto.telefonePrincipal ?? '').trim(),
      emailComercial: (dto.emailComercial ?? '').trim(),
      cidadeUf: (dto.cidadeUf ?? '').trim(),
      endereco: (dto.endereco ?? '').trim(),
      condicaoPagamento: (dto.condicaoPagamento ?? '').trim(),
      limiteCredito: numero(dto.limiteCredito),
      descontoComercial: (dto.descontoComercial ?? '').trim(),
      observacoesFaturamento: (dto.observacoesFaturamento ?? '').trim(),
      status: 'Ativa',
      createdAt: new Date().toISOString(),
      ...(prefeituraId ? { prefeituraId, parceiroId: id } : {}),
    };

    try {
      if (tipo === 'posto') {
        await fs
          .collection('postos')
          .doc(id)
          .set({
            ...comum,
            tipoParceiro: 'posto',
            bandeira: (dto.bandeira ?? '').trim(),
            combustiveis: listaTexto(dto.combustiveis),
            servicos: listaTexto(dto.servicos),
          });
      } else {
        const categorias = listaTexto(dto.categoriasServico);
        const linhasAtuacao = listaTexto(dto.linhasAtuacao);
        const dadosOficina = {
          ...comum,
          linhasAtuacao,
          categoriasServico: categorias,
        };
        const nome = nomeFromOficinaDoc(dadosOficina, razaoSocial);
        const especialidade = especialidadeFromOficinaDoc(dadosOficina);
        await fs
          .collection('oficinas')
          .doc(id)
          .set({
            ...dadosOficina,
            tipoParceiro: 'oficina',
            nome,
            especialidade: especialidade || categorias.join(', '),
            especificacoes: (dto.especificacoes ?? '').trim(),
          });
      }
      return { data: { id, tipo }, message: 'Parceiro cadastrado.' };
    } catch (error) {
      console.error('Erro ao salvar parceiro:', error);
      throw new InternalServerErrorException(
        'Não foi possível salvar o parceiro.',
      );
    }
  }

  /** Remove um parceiro (posto/oficina) pelo id. */
  async remover(tipo: string, id: string) {
    if (!id) throw new BadRequestException('ID inválido.');
    const colecao = tipo === 'oficina' ? 'oficinas' : 'postos';
    try {
      await this.firebaseService
        .getFirestore()
        .collection(colecao)
        .doc(id)
        .delete();
      return { message: 'Parceiro removido.' };
    } catch (error) {
      console.error('Erro ao remover parceiro:', error);
      throw new InternalServerErrorException(
        'Não foi possível remover o parceiro.',
      );
    }
  }
}

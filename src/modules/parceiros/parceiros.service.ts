import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { DocumentReference } from 'firebase-admin/firestore';
import { FirebaseService } from '../../config/firebase.service';
import {
  OficinaParceiro,
  ParceirosOverview,
  PostoParceiro,
  TipoParceiro,
} from './parceiros.types';
import { CreateParceiroDto } from './dto/create-parceiro.dto';
import {
  CreateParceiroLoginDto,
  ResetParceiroLoginSenhaDto,
} from './dto/create-parceiro-login.dto';
import {
  hashSenhaOperacional,
  mapParceiroLoginDoc,
  type ParceiroLoginRow,
} from './helpers/parceiro-login.helper';
import {
  credenciaisLoginAutomatico,
  type CredenciaisLoginAutomatico,
} from './helpers/gerar-credenciais-parceiro.helper';
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
  async overview(prefeituraId?: string): Promise<{ data: ParceirosOverview }> {
    const filtroPref = (prefeituraId ?? '').trim();
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

      const postos: PostoParceiro[] = postosSnap.docs
        .map((doc) => {
        const d = doc.data() as Record<string, unknown>;
        const prefId = texto(d.prefeituraId);
        if (filtroPref && prefId !== filtroPref) return null;
        return {
          id: doc.id,
          prefeituraId: prefId,
          nome: texto(d.nomeFantasia) || texto(d.razaoSocial) || '—',
          razaoSocial: texto(d.razaoSocial) || texto(d.nomeFantasia) || '—',
          cidadeUf: texto(d.cidadeUf) || localDoCliente(texto(d.prefeituraId)),
          bandeira: texto(d.bandeira),
          condicaoPagamento: texto(d.condicaoPagamento),
          limiteCredito: numero(d.limiteCredito),
          ativo: ehAtivo(d.status ?? 'Ativa'),
        };
      })
        .filter((p): p is PostoParceiro => p !== null);

      const oficinas: OficinaParceiro[] = oficinasSnap.docs
        .map((doc) => {
        const d = doc.data() as Record<string, unknown>;
        const prefId = texto(d.prefeituraId);
        if (filtroPref && prefId !== filtroPref) return null;
        const categorias = listaTexto(d.categoriasServico);
        return {
          id: doc.id,
          prefeituraId: prefId,
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
      })
        .filter((o): o is OficinaParceiro => o !== null);

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

      let login: CredenciaisLoginAutomatico | undefined;
      if (prefeituraId) {
        login = await this.provisionarLoginAutomatico(
          tipo,
          id,
          prefeituraId,
          comum.nomeFantasia || razaoSocial,
          comum.nomeFantasia || razaoSocial || 'Gestor do parceiro',
        );
      }

      return {
        data: { id, tipo, ...(login ? { login } : {}) },
        message: login
          ? 'Parceiro cadastrado. Login operacional criado automaticamente.'
          : 'Parceiro cadastrado.',
      };
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

  private async carregarParceiro(
    tipo: TipoParceiro,
    parceiroId: string,
  ): Promise<{ prefeituraId: string; ref: DocumentReference }> {
    const id = parceiroId.trim();
    if (!id) throw new BadRequestException('ID do parceiro inválido.');

    const colecao = tipo === 'oficina' ? 'oficinas' : 'postos';
    const ref = this.firebaseService.getFirestore().collection(colecao).doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new NotFoundException('Parceiro não encontrado.');
    }
    const prefeituraId = texto(snap.data()?.prefeituraId);
    if (!prefeituraId) {
      throw new BadRequestException(
        'Parceiro sem cliente vinculado. Cadastre com prefeituraId.',
      );
    }
    return { prefeituraId, ref };
  }

  private async usuarioLoginDisponivel(usuario: string): Promise<boolean> {
    const snap = await this.firebaseService
      .getFirestore()
      .collection('users')
      .where('usuario', '==', usuario)
      .limit(1)
      .get();
    return snap.empty;
  }

  private async persistirLoginOperacional(
    tipo: TipoParceiro,
    parceiroId: string,
    prefeituraId: string,
    input: {
      nome: string;
      usuario: string;
      senha: string;
      perfil?: 'gestor' | 'admin';
    },
  ): Promise<ParceiroLoginRow> {
    const nome = input.nome.trim();
    const usuario = input.usuario.trim();
    const senha = input.senha.trim();
    if (!nome || !usuario || !senha) {
      throw new BadRequestException('Preencha nome, usuário e senha.');
    }
    if (senha.length < 4) {
      throw new BadRequestException('A senha deve ter no mínimo 4 caracteres.');
    }
    if (!(await this.usuarioLoginDisponivel(usuario))) {
      throw new ConflictException('Já existe um usuário com esse login.');
    }

    const perfil = input.perfil === 'admin' ? 'admin' : 'gestor';
    const id = randomUUID();
    const payload: Record<string, unknown> = {
      id,
      nome,
      usuario,
      senha: hashSenhaOperacional(senha),
      perfil,
      type: tipo,
      vinculo: tipo,
      prefeituraId,
      createdAt: new Date().toISOString(),
      ...(tipo === 'posto'
        ? { postoId: parceiroId.trim() }
        : { officinaId: parceiroId.trim() }),
    };

    const ref = await this.firebaseService
      .getFirestore()
      .collection('users')
      .add(payload);
    const data = mapParceiroLoginDoc(ref.id, payload);
    if (!data) {
      throw new InternalServerErrorException('Falha ao mapear login criado.');
    }
    return data;
  }

  private async provisionarLoginAutomatico(
    tipo: TipoParceiro,
    parceiroId: string,
    prefeituraId: string,
    slugBase: string,
    nomeExibicao: string,
  ): Promise<CredenciaisLoginAutomatico> {
    let creds = credenciaisLoginAutomatico(tipo, parceiroId, {
      nomeExibicao,
      slugBase,
    });
    if (!(await this.usuarioLoginDisponivel(creds.usuario))) {
      creds = {
        ...creds,
        usuario: `${creds.usuario}.${creds.senhaInicial.slice(0, 4).toLowerCase()}`,
      };
    }
    await this.persistirLoginOperacional(tipo, parceiroId, prefeituraId, {
      nome: creds.nome,
      usuario: creds.usuario,
      senha: creds.senhaInicial,
      perfil: 'gestor',
    });
    return creds;
  }

  async listarLogins(
    tipo: string,
    parceiroId: string,
  ): Promise<{ data: ParceiroLoginRow[]; message: string }> {
    const t: TipoParceiro = tipo === 'oficina' ? 'oficina' : 'posto';
    await this.carregarParceiro(t, parceiroId);

    const campo = t === 'posto' ? 'postoId' : 'officinaId';
    try {
      const snap = await this.firebaseService
        .getFirestore()
        .collection('users')
        .where(campo, '==', parceiroId.trim())
        .get();

      const data = snap.docs
        .map((doc) =>
          mapParceiroLoginDoc(doc.id, doc.data() as Record<string, unknown>),
        )
        .filter((row): row is ParceiroLoginRow => row !== null)
        .sort((a, b) => a.usuario.localeCompare(b.usuario, 'pt-BR'));

      return { data, message: 'Logins carregados com sucesso.' };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      console.error('Erro ao listar logins do parceiro:', error);
      throw new InternalServerErrorException(
        'Não foi possível carregar os logins.',
      );
    }
  }

  async criarLogin(
    tipo: string,
    parceiroId: string,
    dto: CreateParceiroLoginDto,
  ): Promise<{ data: ParceiroLoginRow; message: string }> {
    const t: TipoParceiro = tipo === 'oficina' ? 'oficina' : 'posto';
    const { prefeituraId } = await this.carregarParceiro(t, parceiroId);

    try {
      const data = await this.persistirLoginOperacional(t, parceiroId, prefeituraId, {
        nome: dto.nome ?? '',
        usuario: dto.usuario ?? '',
        senha: dto.senha ?? '',
        perfil: dto.perfil === 'admin' ? 'admin' : 'gestor',
      });
      return { data, message: 'Login criado com sucesso.' };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException
      ) {
        throw error;
      }
      console.error('Erro ao criar login do parceiro:', error);
      throw new InternalServerErrorException(
        'Não foi possível criar o login.',
      );
    }
  }

  async resetarLoginSenha(acessoId: string, dto: ResetParceiroLoginSenhaDto) {
    const id = acessoId.trim();
    const senha = (dto.senha ?? '').trim();
    if (!id) throw new BadRequestException('ID inválido.');
    if (senha.length < 4) {
      throw new BadRequestException('A senha deve ter no mínimo 4 caracteres.');
    }

    const ref = this.firebaseService.getFirestore().collection('users').doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new NotFoundException('Login não encontrado.');
    }

    try {
      await ref.update({ senha: hashSenhaOperacional(senha) });
      return { message: 'Senha redefinida.' };
    } catch (error) {
      console.error('Erro ao resetar senha do login:', error);
      throw new InternalServerErrorException(
        'Não foi possível redefinir a senha.',
      );
    }
  }

  async removerLogin(acessoId: string) {
    const id = acessoId.trim();
    if (!id) throw new BadRequestException('ID inválido.');

    const ref = this.firebaseService.getFirestore().collection('users').doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new NotFoundException('Login não encontrado.');
    }

    try {
      await ref.delete();
      return { message: 'Login removido.' };
    } catch (error) {
      console.error('Erro ao remover login:', error);
      throw new InternalServerErrorException(
        'Não foi possível remover o login.',
      );
    }
  }
}

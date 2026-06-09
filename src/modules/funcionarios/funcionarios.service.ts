import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { StringValue } from 'ms';
import { createHash } from 'node:crypto';
import * as admin from 'firebase-admin';
import { FirebaseService } from '../../config/firebase.service';
import { CreateFuncionarioDto } from './dto/create-funcionario.dto';
import { AuthFuncionarioDto } from './dto/auth-funcionario.dto';

const COLECAO = 'operadores';
const BATCH_MAX = 450;

function limparCpf(cpf: string): string {
  return (cpf || '').replace(/\D/g, '');
}

/** SHA-256 hex (UTF-8) — idêntico ao hashSenha do front (paridade do login). */
function sha256hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Hash salgado com o CPF, igual ao front: SHA-256("<cpf>:<senha>"). */
function hashSenhaFuncionario(cpf: string, senha: string): string {
  return sha256hex(`${limparCpf(cpf)}:${senha}`);
}

/** Login gerado: primeiro nome (minúsculo) + 3 últimos dígitos do CPF. */
function gerarLogin(nome: string, cpf: string): string {
  const primeiro = (nome || '').trim().split(/\s+/)[0] ?? '';
  const cpfLimpo = limparCpf(cpf);
  if (!primeiro || cpfLimpo.length < 3) return '';
  return `${primeiro.toLowerCase()}${cpfLimpo.slice(-3)}`;
}

function tsToMillis(v: unknown): number {
  if (v && typeof (v as { toMillis?: () => number }).toMillis === 'function') {
    return (v as { toMillis: () => number }).toMillis();
  }
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : 0;
  }
  return 0;
}

export interface ImportResultado {
  criados: number;
  ignorados: number;
  erros: { linha: number; nome: string; cpf: string; motivo: string }[];
}

@Injectable()
export class FuncionariosService {
  constructor(
    private firebaseService: FirebaseService,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {}

  private get firestore() {
    return this.firebaseService.getFirestore();
  }
  private get collection() {
    return this.firestore.collection(COLECAO);
  }

  private getJwtSecret(): string {
    const jwtSecret = this.configService.get<string>('JWT_SECRET') ?? '';
    if (!jwtSecret) {
      throw new Error('JWT_SECRET nao configurado no ambiente.');
    }
    return jwtSecret;
  }

  /**
   * Login do operador/funcionário (app de campo). Autentica contra a coleção
   * `operadores` por CPF (11 dígitos) ou login gerado (primeiro nome + 3
   * últimos dígitos do CPF), com a senha salgada com o CPF. Porta a lógica
   * que o front fazia direto no Firestore (funcionariosApi.autenticar).
   */
  async autenticar(dto: AuthFuncionarioDto) {
    const ident = (dto.identificador ?? '').trim();
    const senha = dto.senha ?? '';
    if (!ident || !senha) {
      return { ok: false, msg: 'Informe o CPF/usuário e a senha.' };
    }

    const limpo = limparCpf(ident);
    const ehCpf = limpo.length === 11;

    const snap = ehCpf
      ? await this.collection.where('cpf', '==', limpo).get()
      : await this.collection
          .where('loginGerado', '==', ident.toLowerCase())
          .get();

    if (snap.empty) {
      return { ok: false, msg: 'Identificador ou senha incorretos.' };
    }

    let temSenha = false;
    for (const doc of snap.docs) {
      const data = doc.data() as Record<string, unknown>;
      const senhaHash =
        typeof data.senhaHash === 'string' ? data.senhaHash : '';
      if (!senhaHash) continue;
      temSenha = true;

      const cpfDoc = limparCpf(typeof data.cpf === 'string' ? data.cpf : '');
      if (senhaHash !== hashSenhaFuncionario(cpfDoc, senha)) continue;

      const status = typeof data.status === 'string' ? data.status : 'ativo';
      if (status !== 'ativo') {
        return { ok: false, msg: 'Funcionário inativo. Procure o gestor.' };
      }

      const funcionario = {
        id: doc.id,
        nome: typeof data.nome === 'string' ? data.nome : '',
        cpf: cpfDoc,
        cargo: typeof data.cargo === 'string' ? data.cargo : '',
        loginGerado:
          typeof data.loginGerado === 'string' ? data.loginGerado : '',
        prefeituraId:
          typeof data.prefeituraId === 'string' ? data.prefeituraId : '',
      };

      const expiresIn =
        this.configService.get<string>('JWT_EXPIRES_IN') ?? '24h';
      const accessToken = await this.jwtService.signAsync(
        {
          sub: funcionario.loginGerado || funcionario.id,
          tipo: 'operador',
          cargo: funcionario.cargo,
          prefeituraId: funcionario.prefeituraId,
        },
        {
          secret: this.getJwtSecret(),
          expiresIn: expiresIn as StringValue,
        },
      );

      return {
        ok: true,
        funcionario,
        accessToken,
        tokenType: 'Bearer',
        expiresIn,
        message: 'Login realizado com sucesso.',
      };
    }

    return {
      ok: false,
      msg: temSenha
        ? 'Identificador ou senha incorretos.'
        : 'Funcionário sem senha cadastrada. Procure o gestor.',
    };
  }

  /** Campos do documento (sem createdAt/senha), compartilhado por criar/editar. */
  private basePayload(input: CreateFuncionarioDto) {
    const cpf = limparCpf(input.cpf);
    return {
      nome: (input.nome || '').trim(),
      cpf,
      loginGerado: gerarLogin(input.nome, cpf),
      cargo: (input.cargo || '').trim(),
      telefone: input.telefone?.trim() || null,
      tipo:
        input.tipo === 'supervisor' || input.tipo === 'admin'
          ? input.tipo
          : 'operador',
      status: input.status === 'inativo' ? 'inativo' : 'ativo',
      matricula: input.matricula?.trim() || null,
      dataNascimento: input.dataNascimento?.trim() || null,
      rg: input.rg?.trim() || null,
      cnh: input.cnh?.replace(/\D/g, '') || null,
      cnhCategoria: input.cnhCategoria?.trim() || null,
      cnhValidade: input.cnhValidade?.trim() || null,
      cnhLocalEmissao: input.cnhLocalEmissao?.trim() || null,
      cnhEmissao: input.cnhEmissao?.trim() || null,
      cnhRestricao: input.cnhRestricao?.trim() || null,
      observacoes: input.observacoes?.trim() || null,
    };
  }

  private async getDocOrThrow(id: string) {
    const snap = await this.collection.doc(id).get();
    if (!snap.exists) {
      throw new NotFoundException('Funcionário não encontrado.');
    }
    return snap;
  }

  async create(prefeituraId: string, dto: CreateFuncionarioDto) {
    try {
      const cpf = limparCpf(dto.cpf);
      const senhaInicial = dto.senha || cpf;
      const ref = this.collection.doc();
      await ref.set({
        prefeituraId,
        ...this.basePayload(dto),
        senhaHash: hashSenhaFuncionario(cpf, senhaInicial),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return {
        data: { id: ref.id },
        message: 'Funcionário criado com sucesso!',
      };
    } catch (error) {
      console.error('Erro ao criar funcionário:', error);
      throw new InternalServerErrorException(
        'Não foi possível criar o funcionário.',
      );
    }
  }

  async findAllByPrefeitura(prefeituraId: string) {
    try {
      const snap = await this.collection
        .where('prefeituraId', '==', prefeituraId)
        .get();

      const data = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort(
          (a, b) =>
            tsToMillis((b as { createdAt?: unknown }).createdAt) -
            tsToMillis((a as { createdAt?: unknown }).createdAt),
        );

      // Backfill do loginGerado para docs legados (fire-and-forget).
      for (const d of snap.docs) {
        const x = d.data();
        if (x.loginGerado || !x.nome || !x.cpf) continue;
        const lg = gerarLogin(String(x.nome), String(x.cpf));
        if (lg) {
          void this.collection
            .doc(d.id)
            .update({ loginGerado: lg })
            .catch(() => {});
        }
      }

      return { data, message: 'Funcionários buscados com sucesso!' };
    } catch (error) {
      console.error('Erro ao buscar funcionários:', error);
      throw new InternalServerErrorException(
        'Não foi possível buscar os funcionários.',
      );
    }
  }

  async findById(id: string) {
    const snap = await this.getDocOrThrow(id);
    return { data: { id: snap.id, ...snap.data() }, message: 'OK' };
  }

  async update(id: string, dto: CreateFuncionarioDto) {
    await this.getDocOrThrow(id);
    const cpf = limparCpf(dto.cpf);
    const payload: Record<string, unknown> = {
      ...this.basePayload(dto),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (dto.senha) payload.senhaHash = hashSenhaFuncionario(cpf, dto.senha);
    await this.collection.doc(id).update(payload);
    return { data: {}, message: 'Funcionário atualizado com sucesso!' };
  }

  async remove(id: string) {
    await this.getDocOrThrow(id);
    await this.collection.doc(id).delete();
    return { data: {}, message: 'Funcionário removido com sucesso!' };
  }

  async definirStatus(id: string, status: 'ativo' | 'inativo') {
    await this.getDocOrThrow(id);
    await this.collection.doc(id).update({
      status: status === 'inativo' ? 'inativo' : 'ativo',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { data: {}, message: 'Status atualizado.' };
  }

  /** Reseta a senha para o CPF (ação do gestor). */
  async resetarSenha(id: string) {
    const snap = await this.getDocOrThrow(id);
    const cpf = limparCpf(String(snap.data()?.cpf ?? ''));
    if (!cpf) {
      throw new InternalServerErrorException(
        'CPF não definido — não dá para resetar.',
      );
    }
    await this.collection.doc(id).update({
      senhaHash: hashSenhaFuncionario(cpf, cpf),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { data: {}, message: 'Senha resetada para o CPF.' };
  }

  async cpfEmUso(prefeituraId: string, cpf: string, ignorarId?: string) {
    const limpo = limparCpf(cpf);
    if (!limpo) return { data: { emUso: false }, message: 'OK' };
    const snap = await this.collection
      .where('prefeituraId', '==', prefeituraId)
      .where('cpf', '==', limpo)
      .get();
    const emUso = snap.docs.some((d) => d.id !== ignorarId);
    return { data: { emUso }, message: 'OK' };
  }

  /** Importa vários funcionários de uma vez, validando e deduplicando por CPF. */
  async importar(
    prefeituraId: string,
    linhas: CreateFuncionarioDto[],
  ): Promise<{ data: ImportResultado; message: string }> {
    try {
      const existentesSnap = await this.collection
        .where('prefeituraId', '==', prefeituraId)
        .get();
      const cpfsExistentes = new Set(
        existentesSnap.docs
          .map((d) => limparCpf(String(d.data().cpf ?? '')))
          .filter(Boolean),
      );

      const vistos = new Set<string>();
      const erros: ImportResultado['erros'] = [];
      let criados = 0;
      let batch = this.firestore.batch();
      let pendentes = 0;

      for (let i = 0; i < linhas.length; i++) {
        const row = linhas[i];
        const linha = i + 1;
        const nome = (row?.nome || '').trim();
        const cpf = limparCpf(row?.cpf || '');

        if (!nome) {
          erros.push({ linha, nome, cpf, motivo: 'Nome vazio' });
          continue;
        }
        if (cpf.length !== 11) {
          erros.push({
            linha,
            nome,
            cpf,
            motivo: 'CPF inválido (precisa de 11 dígitos)',
          });
          continue;
        }
        if (cpfsExistentes.has(cpf) || vistos.has(cpf)) {
          erros.push({ linha, nome, cpf, motivo: 'CPF já cadastrado' });
          continue;
        }

        vistos.add(cpf);
        const senhaInicial = row.senha || cpf;
        const ref = this.collection.doc();
        batch.set(ref, {
          prefeituraId,
          ...this.basePayload(row),
          senhaHash: hashSenhaFuncionario(cpf, senhaInicial),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        criados++;
        pendentes++;

        if (pendentes >= BATCH_MAX) {
          await batch.commit();
          batch = this.firestore.batch();
          pendentes = 0;
        }
      }

      if (pendentes > 0) await batch.commit();

      return {
        data: { criados, ignorados: erros.length, erros },
        message: `${criados} criado(s), ${erros.length} ignorado(s).`,
      };
    } catch (error) {
      console.error('Erro ao importar funcionários:', error);
      throw new InternalServerErrorException(
        'Não foi possível importar os funcionários.',
      );
    }
  }
}

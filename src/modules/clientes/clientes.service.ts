import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { FirebaseService } from '../../config/firebase.service';
import {
  AcessoRow,
  ClienteOverviewRow,
  TipoClienteApi,
} from './clientes.types';
import { CreateClienteDto } from './dto/create-cliente.dto';
import { UpdateClienteDto } from './dto/update-cliente.dto';
import { CreateAcessoDto } from './dto/create-acesso.dto';
import { UpdateAcessoDto } from './dto/update-acesso.dto';
import { ResetSenhaAcessoDto } from './dto/reset-senha-acesso.dto';
import { ChecklistLoginConfigDto } from './dto/checklist-login-config.dto';

/** SHA-256 sem salt (espelha utils/hashSenha do front, pra o login bater). */
function hashSenha(senha: string): string {
  return createHash('sha256').update(senha, 'utf8').digest('hex');
}

function booleano(valor: unknown, padrao = false): boolean {
  return typeof valor === 'boolean' ? valor : padrao;
}

/** Converte um campo solto do Firestore (unknown) em string segura. */
function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor : '';
}

function isAcessoDoCliente(d: Record<string, unknown>): boolean {
  if (texto(d.postoId).trim() || texto(d.officinaId).trim()) return false;
  const vinculo = texto(d.vinculo).trim() || texto(d.type).trim();
  return vinculo === 'prefeitura' || vinculo === 'locacao';
}

function mapAcessoRow(id: string, d: Record<string, unknown>): AcessoRow {
  return {
    id,
    nome: texto(d.nome).trim(),
    usuario: texto(d.usuario).trim(),
    email: texto(d.email).trim(),
    whatsapp: texto(d.whatsapp).trim(),
    perfil: texto(d.perfil).trim() || 'gestor',
    notificaEmail: booleano(d.notificaEmail, true),
    notificaWhatsapp: booleano(d.notificaWhatsapp, false),
  };
}

@Injectable()
export class ClientesService {
  constructor(private firebaseService: FirebaseService) {}

  /**
   * Lista todos os clientes contratantes com métricas agregadas por cliente:
   * frota ativa, em manutenção e checklists. Custo e O.S. ficam zerados até a
   * fonte desses números ser definida. As coleções são lidas no servidor
   * (firebase-admin), então o front não toca no Firestore direto.
   */
  async overview(): Promise<{ data: ClienteOverviewRow[] }> {
    const db = this.firebaseService.getFirestore();

    try {
      const [clientesSnap, equipamentosSnap, checklistsSnap] =
        await Promise.all([
          db.collection('clientes').get(),
          db.collection('equipamentos').get(),
          db.collection('checklists').get(),
        ]);

      // Agrupa equipamentos por cliente (prefeituraId): ativos x manutenção.
      const frotaPorCliente = new Map<
        string,
        { ativos: number; emManutencao: number }
      >();
      for (const doc of equipamentosSnap.docs) {
        const d = doc.data() as Record<string, unknown>;
        const clienteId = texto(d.prefeituraId);
        if (!clienteId) continue;
        const atual = frotaPorCliente.get(clienteId) ?? {
          ativos: 0,
          emManutencao: 0,
        };
        const status = texto(d.status).toLowerCase();
        if (status === 'ativo') atual.ativos += 1;
        if (status === 'manutencao' || status === 'manutenção')
          atual.emManutencao += 1;
        frotaPorCliente.set(clienteId, atual);
      }

      // Conta checklists por cliente.
      const checklistsPorCliente = new Map<string, number>();
      for (const doc of checklistsSnap.docs) {
        const d = doc.data() as Record<string, unknown>;
        const clienteId = texto(d.prefeituraId);
        if (!clienteId) continue;
        checklistsPorCliente.set(
          clienteId,
          (checklistsPorCliente.get(clienteId) ?? 0) + 1,
        );
      }

      const data: ClienteOverviewRow[] = clientesSnap.docs.map((doc) => {
        const d = doc.data() as Record<string, unknown>;
        const id = doc.id;
        const frota = frotaPorCliente.get(id) ?? { ativos: 0, emManutencao: 0 };
        const tipoCliente: TipoClienteApi =
          d.tipoCliente === 'locacao' ? 'locacao' : 'prefeitura';
        const contrato = (d.contrato ?? {}) as Record<string, unknown>;

        return {
          id,
          nome: texto(d.nome),
          uf: texto(d.uf),
          tipoCliente,
          email: texto(contrato.emailContratante),
          ativos: frota.ativos,
          emManutencao: frota.emManutencao,
          checklists: checklistsPorCliente.get(id) ?? 0,
          custoAcumulado: 0,
          osCotacao: 0,
          osNfPagamento: 0,
        };
      });

      return { data };
    } catch (error) {
      console.error('Erro ao montar overview de clientes:', error);
      throw new InternalServerErrorException(
        'Não foi possível carregar os clientes.',
      );
    }
  }

  /**
   * Cria um cliente + contrato. Porta a validação/normalização que antes
   * vivia no front (useClientes.adicionarCliente), agora no backend.
   */
  async criar(dto: CreateClienteDto) {
    const nome = (dto.nome ?? '').trim();
    const uf = (dto.uf ?? '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .slice(0, 2);
    const contrato = dto.contrato;

    if (!nome || uf.length !== 2) {
      throw new BadRequestException('Informe o município e a UF com 2 letras.');
    }
    if (!contrato?.numero?.trim()) {
      throw new BadRequestException(
        'Informe o número do instrumento contratual.',
      );
    }
    if (!contrato?.objeto?.trim()) {
      throw new BadRequestException('Descreva o objeto do contrato.');
    }
    if (!contrato?.vigenciaInicio?.trim()) {
      throw new BadRequestException(
        'Informe o início da vigência do contrato.',
      );
    }

    const id = randomUUID();
    const tipoCliente: TipoClienteApi =
      dto.tipoCliente === 'locacao' ? 'locacao' : 'prefeitura';
    const qtdInicialAtivos =
      typeof contrato.qtdInicialAtivos === 'number' &&
      contrato.qtdInicialAtivos >= 0
        ? contrato.qtdInicialAtivos
        : 0;

    const dados = {
      id,
      adminId: null,
      criadoEm: new Date().toISOString(),
      nome,
      uf,
      tipoCliente,
      cnpj: (dto.cnpj ?? '').trim(),
      caepf: (dto.caepf ?? '').trim(),
      cidade: (dto.cidade ?? '').trim(),
      whatsapp: (dto.whatsapp ?? '').trim(),
      contrato: {
        numero: contrato.numero.trim(),
        processo: contrato.processo ?? '',
        modalidade: contrato.modalidade ?? 'pregao_eletronico',
        dataAssinatura: contrato.dataAssinatura ?? '',
        vigenciaInicio: contrato.vigenciaInicio,
        vigenciaFim: contrato.vigenciaFim ?? '',
        objeto: contrato.objeto.trim(),
        valorMensal: contrato.valorMensal ?? '',
        valorTotal: contrato.valorTotal ?? '',
        indiceReajuste: contrato.indiceReajuste ?? '',
        periodicidadeFaturamento: contrato.periodicidadeFaturamento ?? 'mensal',
        slaRespostaHoras: contrato.slaRespostaHoras ?? '',
        responsavelContratante: contrato.responsavelContratante ?? '',
        cargoContratante: contrato.cargoContratante ?? '',
        emailContratante: contrato.emailContratante ?? '',
        telefoneContratante: contrato.telefoneContratante ?? '',
        observacoes: contrato.observacoes ?? '',
        status: contrato.status ?? 'ativo',
        qtdInicialAtivos,
      },
    };

    try {
      await this.firebaseService
        .getFirestore()
        .collection('clientes')
        .doc(id)
        .set(dados);
      return { data: dados, message: 'Cliente cadastrado com sucesso.' };
    } catch (error) {
      console.error('Erro ao salvar cliente:', error);
      throw new InternalServerErrorException(
        'Não foi possível salvar o cliente.',
      );
    }
  }

  /**
   * Atualização parcial de um cliente. Só grava os campos informados (merge),
   * preservando o resto — inclusive o contrato, que é mesclado campo a campo.
   * Fonte única dos dados da empresa: o admin e a tela de Configurações da
   * prefeitura editam este mesmo documento.
   */
  async atualizar(clienteId: string, dto: UpdateClienteDto) {
    const ref = this.firebaseService
      .getFirestore()
      .collection('clientes')
      .doc(clienteId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new NotFoundException('Cliente não encontrado.');
    }
    const atual = (snap.data() ?? {}) as Record<string, unknown>;

    const patch: Record<string, unknown> = {
      atualizadoEm: new Date().toISOString(),
    };

    if (dto.nome !== undefined) {
      const nome = (dto.nome ?? '').trim();
      if (!nome) throw new BadRequestException('Informe o município/nome.');
      patch.nome = nome;
    }
    if (dto.uf !== undefined) {
      const uf = (dto.uf ?? '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z]/g, '')
        .slice(0, 2);
      if (uf.length !== 2) {
        throw new BadRequestException('Informe a UF com 2 letras.');
      }
      patch.uf = uf;
    }
    if (dto.tipoCliente !== undefined) {
      patch.tipoCliente =
        dto.tipoCliente === 'locacao' ? 'locacao' : 'prefeitura';
    }
    for (const campo of ['cnpj', 'caepf', 'cidade', 'whatsapp'] as const) {
      if (dto[campo] !== undefined) patch[campo] = (dto[campo] ?? '').trim();
    }

    if (dto.contrato) {
      const contratoAtual = (atual.contrato ?? {}) as Record<string, unknown>;
      const merged: Record<string, unknown> = { ...contratoAtual };
      for (const [chave, valor] of Object.entries(dto.contrato)) {
        if (valor !== undefined) merged[chave] = valor;
      }
      patch.contrato = merged;
    }

    try {
      await ref.set(patch, { merge: true });
      return {
        data: { id: clienteId, ...atual, ...patch },
        message: 'Cliente atualizado com sucesso.',
      };
    } catch (error) {
      console.error('Erro ao atualizar cliente:', error);
      throw new InternalServerErrorException(
        'Não foi possível atualizar o cliente.',
      );
    }
  }

  /**
   * Dados crus de um cliente por id (= prefeituraId). Usado para pré-preencher
   * a tela de Configurações da prefeitura com os dados da empresa.
   */
  async obter(clienteId: string) {
    try {
      const snap = await this.firebaseService
        .getFirestore()
        .collection('clientes')
        .doc(clienteId)
        .get();
      if (!snap.exists) {
        throw new NotFoundException('Cliente não encontrado.');
      }
      return { data: snap.data(), message: 'Cliente encontrado.' };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      console.error('Erro ao buscar cliente:', error);
      throw new InternalServerErrorException(
        'Não foi possível buscar o cliente.',
      );
    }
  }

  /** Lista os acessos (coleção `users`) vinculados a um cliente. */
  async listarAcessos(clienteId: string): Promise<{ data: AcessoRow[] }> {
    const db = this.firebaseService.getFirestore();
    try {
      const snap = await db
        .collection('users')
        .where('prefeituraId', '==', clienteId)
        .get();

      const data: AcessoRow[] = snap.docs
        .map((doc) => {
          const d = doc.data() as Record<string, unknown>;
          if (!isAcessoDoCliente(d)) return null;
          return mapAcessoRow(doc.id, d);
        })
        .filter((row): row is AcessoRow => row !== null);
      return { data };
    } catch (error) {
      console.error('Erro ao listar acessos:', error);
      throw new InternalServerErrorException(
        'Não foi possível carregar os acessos.',
      );
    }
  }

  /** Cria um acesso (usuário) vinculado a um cliente. */
  async criarAcesso(clienteId: string, dto: CreateAcessoDto) {
    const db = this.firebaseService.getFirestore();

    const nome = (dto.nome ?? '').trim();
    const usuario = (dto.usuario ?? '').trim();
    const senha = (dto.senha ?? '').trim();

    if (!nome || !usuario || !senha) {
      throw new BadRequestException('Preencha nome, login e senha inicial.');
    }
    if (senha.length < 4) {
      throw new BadRequestException('A senha deve ter no mínimo 4 caracteres.');
    }

    const clienteSnap = await db.collection('clientes').doc(clienteId).get();
    if (!clienteSnap.exists) {
      throw new NotFoundException('Cliente não encontrado.');
    }
    const tipoCliente: TipoClienteApi =
      (clienteSnap.data() as Record<string, unknown>).tipoCliente === 'locacao'
        ? 'locacao'
        : 'prefeitura';

    const duplicado = await db
      .collection('users')
      .where('usuario', '==', usuario)
      .get();
    if (!duplicado.empty) {
      throw new BadRequestException('Já existe um usuário com esse login.');
    }

    const perfil = dto.perfil === 'admin' ? 'admin' : 'gestor';
    const novo = {
      id: randomUUID(),
      nome,
      usuario,
      senha: hashSenha(senha),
      perfil,
      type: tipoCliente,
      vinculo: tipoCliente,
      prefeituraId: clienteId,
      email: (dto.email ?? '').trim(),
      whatsapp: (dto.whatsapp ?? '').trim(),
      notificaEmail: booleano(dto.notificaEmail, true),
      notificaWhatsapp: booleano(dto.notificaWhatsapp, true),
      mustChangePassword: true,
      createdAt: new Date().toISOString(),
    };

    try {
      const ref = await db.collection('users').add(novo);
      const data: AcessoRow = {
        id: ref.id,
        nome,
        usuario,
        email: novo.email,
        whatsapp: novo.whatsapp,
        perfil,
        notificaEmail: novo.notificaEmail,
        notificaWhatsapp: novo.notificaWhatsapp,
      };
      return { data, message: 'Usuário cadastrado com sucesso.' };
    } catch (error) {
      console.error('Erro ao salvar acesso:', error);
      throw new InternalServerErrorException(
        'Não foi possível salvar o acesso.',
      );
    }
  }

  /** Remove um acesso (usuário) pelo id do documento. */
  async removerAcesso(acessoId: string) {
    if (!acessoId) {
      throw new BadRequestException('ID inválido.');
    }
    try {
      await this.firebaseService
        .getFirestore()
        .collection('users')
        .doc(acessoId)
        .delete();
      return { message: 'Acesso removido.' };
    } catch (error) {
      console.error('Erro ao remover acesso:', error);
      throw new InternalServerErrorException(
        'Não foi possível remover o acesso.',
      );
    }
  }

  private async carregarAcessoDoCliente(clienteId: string, acessoId: string) {
    const db = this.firebaseService.getFirestore();
    const ref = db.collection('users').doc(acessoId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new NotFoundException('Acesso não encontrado.');
    }
    const data = snap.data() as Record<string, unknown>;
    if (texto(data.prefeituraId).trim() !== clienteId.trim()) {
      throw new BadRequestException('Acesso não pertence a este cliente.');
    }
    if (!isAcessoDoCliente(data)) {
      throw new BadRequestException(
        'Este usuário não é um acesso de cliente (prefeitura/locação).',
      );
    }
    return { ref, data };
  }

  /** Atualiza dados de um acesso (sem alterar senha). */
  async atualizarAcesso(
    clienteId: string,
    acessoId: string,
    dto: UpdateAcessoDto,
  ) {
    const { ref, data } = await this.carregarAcessoDoCliente(
      clienteId,
      acessoId,
    );

    const patch: Record<string, unknown> = {};

    if (dto.nome !== undefined) {
      const nome = dto.nome.trim();
      if (!nome) throw new BadRequestException('Nome não pode ser vazio.');
      patch.nome = nome;
    }

    if (dto.usuario !== undefined) {
      const usuario = dto.usuario.trim();
      if (!usuario) throw new BadRequestException('Login não pode ser vazio.');
      if (usuario !== texto(data.usuario)) {
        const db = this.firebaseService.getFirestore();
        const duplicado = await db
          .collection('users')
          .where('usuario', '==', usuario)
          .get();
        const outro = duplicado.docs.find((doc) => doc.id !== acessoId);
        if (outro) {
          throw new BadRequestException('Já existe um usuário com esse login.');
        }
      }
      patch.usuario = usuario;
    }

    if (dto.perfil !== undefined) {
      patch.perfil = dto.perfil === 'admin' ? 'admin' : 'gestor';
    }

    if (dto.email !== undefined) patch.email = dto.email.trim();
    if (dto.whatsapp !== undefined) patch.whatsapp = dto.whatsapp.trim();
    if (dto.notificaEmail !== undefined)
      patch.notificaEmail = dto.notificaEmail;
    if (dto.notificaWhatsapp !== undefined) {
      patch.notificaWhatsapp = dto.notificaWhatsapp;
    }

    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('Nenhum campo para atualizar.');
    }

    try {
      await ref.update(patch);
      const atualizado = { ...data, ...patch };
      return {
        data: mapAcessoRow(acessoId, atualizado),
        message: 'Acesso atualizado.',
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      console.error('Erro ao atualizar acesso:', error);
      throw new InternalServerErrorException(
        'Não foi possível atualizar o acesso.',
      );
    }
  }

  /** Redefine a senha de um acesso. */
  async resetarSenhaAcesso(
    clienteId: string,
    acessoId: string,
    dto: ResetSenhaAcessoDto,
  ) {
    const { ref } = await this.carregarAcessoDoCliente(clienteId, acessoId);
    const senha = (dto.senha ?? '').trim();
    if (senha.length < 4) {
      throw new BadRequestException('A senha deve ter no mínimo 4 caracteres.');
    }

    try {
      await ref.update({
        senha: hashSenha(senha),
        mustChangePassword: true,
      });
      return { message: 'Senha redefinida com sucesso.' };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      console.error('Erro ao redefinir senha:', error);
      throw new InternalServerErrorException(
        'Não foi possível redefinir a senha.',
      );
    }
  }

  /** Atualiza a configuração do checklist login (cpfSenha / chassi) de um cliente. */
  async atualizarChecklistLoginConfig(
    clienteId: string,
    config: ChecklistLoginConfigDto,
  ): Promise<void> {
    const ref = this.firebaseService
      .getFirestore()
      .collection('clientes')
      .doc(clienteId);
    const doc = await ref.get();
    if (!doc.exists) {
      throw new NotFoundException(`Cliente ${clienteId} não encontrado.`);
    }
    await ref.update({
      checklistLogin: { cpfSenha: config.cpfSenha, chassi: config.chassi },
    });
  }
}

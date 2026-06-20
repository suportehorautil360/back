import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { FirebaseService } from '../../config/firebase.service';
import { clonarMatrizPadrao } from './data/matriz-padrao.seed';
import { validarMatrizPreventiva } from './helpers/validar-matriz.helper';
import type {
  PlanoPreventivoDoc,
  SalvarPlanoPreventivoInput,
} from './planos-preventivos.types';

@Injectable()
export class PlanosPreventivosService {
  constructor(private readonly firebaseService: FirebaseService) {}

  private get collection() {
    return this.firebaseService.getFirestore().collection('planosPreventivos');
  }

  async obter(prefeituraId: string): Promise<{ data: PlanoPreventivoDoc; message: string }> {
    await this.assertClienteExiste(prefeituraId);

    const snap = await this.collection.doc(prefeituraId.trim()).get();
    if (!snap.exists) {
      throw new NotFoundException('Preventive plan not found for this municipality.');
    }

    return {
      data: this.mapDoc(prefeituraId.trim(), snap.data() as Record<string, unknown>),
      message: 'Preventive plan loaded.',
    };
  }

  async salvar(
    prefeituraId: string,
    body: unknown,
  ): Promise<{ data: PlanoPreventivoDoc; message: string }> {
    const id = prefeituraId.trim();
    await this.assertClienteExiste(id);
    const matriz = validarMatrizPreventiva(body);

    try {
      const doc = await this.gravar(id, matriz);
      return { data: doc, message: 'Preventive plan saved.' };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Erro ao salvar plano preventivo:', error);
      throw new InternalServerErrorException('Could not save preventive plan.');
    }
  }

  async restaurarPadrao(
    prefeituraId: string,
  ): Promise<{ data: PlanoPreventivoDoc; message: string }> {
    const id = prefeituraId.trim();
    await this.assertClienteExiste(id);

    try {
      const doc = await this.gravar(id, clonarMatrizPadrao());
      return { data: doc, message: 'Default preventive plan restored.' };
    } catch (error) {
      console.error('Erro ao restaurar plano preventivo:', error);
      throw new InternalServerErrorException('Could not restore default preventive plan.');
    }
  }

  private async gravar(
    prefeituraId: string,
    matriz: SalvarPlanoPreventivoInput,
  ): Promise<PlanoPreventivoDoc> {
    const atualizadoEm = new Date().toISOString();
    const payload = {
      prefeituraId,
      ciclos: matriz.ciclos,
      linhas: matriz.linhas,
      atualizadoEm,
    };

    await this.collection.doc(prefeituraId).set(payload);
    return payload;
  }

  private mapDoc(
    prefeituraId: string,
    raw: Record<string, unknown>,
  ): PlanoPreventivoDoc {
    return {
      prefeituraId,
      ciclos: Array.isArray(raw.ciclos) ? (raw.ciclos as PlanoPreventivoDoc['ciclos']) : [],
      linhas: Array.isArray(raw.linhas) ? (raw.linhas as PlanoPreventivoDoc['linhas']) : [],
      atualizadoEm:
        typeof raw.atualizadoEm === 'string'
          ? raw.atualizadoEm
          : new Date().toISOString(),
    };
  }

  private async assertClienteExiste(prefeituraId: string): Promise<void> {
    const id = prefeituraId.trim();
    if (!id) throw new BadRequestException('prefeituraId inválido.');

    const snap = await this.firebaseService
      .getFirestore()
      .collection('clientes')
      .doc(id)
      .get();
    if (!snap.exists) {
      throw new NotFoundException('Cliente (prefeitura) não encontrado.');
    }
  }
}

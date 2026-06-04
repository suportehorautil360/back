import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { FirebaseService } from '../../config/firebase.service';
import { randomUUID } from 'node:crypto';
import { CreateRevisionDto } from './dto/create-revision.dto';

@Injectable()
export class RevisionService {
  // Injetamos o FirebaseService para poder conversar com o banco
  constructor(private firebaseService: FirebaseService) {}

  // Um "atalho" para não ter que digitar esse caminho gigante toda hora
  private get collection() {
    return this.firebaseService.getFirestore().collection('revision');
  }
  private get vehiclesCollection() {
    return this.firebaseService.getFirestore().collection('vehicles');
  }
  private get configuracoesCollection() {
    return this.firebaseService.getFirestore().collection('configuracoes');
  }

  private normalizeTipo(value?: string): string {
    return (value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  }

  private normalizeUnidade(value?: string): 'km' | 'horas' | undefined {
    const unidade = this.normalizeTipo(value);
    if (!unidade) return undefined;
    if (unidade === 'km' || unidade.includes('quilometr')) return 'km';
    if (
      unidade === 'h' ||
      unidade.includes('hora') ||
      unidade.includes('hour')
    ) {
      return 'horas';
    }
    return undefined;
  }

  private resolveTipoKeys(rawTipo?: string): string[] {
    const tipo = this.normalizeTipo(rawTipo);
    if (!tipo) return [];

    if (tipo.includes('carro') || tipo === 'car' || tipo.includes('cars')) {
      return ['carro', 'carros', 'car'];
    }

    if (
      tipo.includes('caminhao') ||
      tipo.includes('caminhoes') ||
      tipo.includes('truck')
    ) {
      return ['caminhao', 'caminhoes', 'truck'];
    }

    if (
      tipo.includes('maquina') ||
      tipo.includes('maquinas') ||
      tipo.includes('machine')
    ) {
      return ['maquina', 'maquinas', 'machine'];
    }

    if (tipo.includes('ambulancia') || tipo.includes('ambulance')) {
      return ['ambulancia', 'ambulancias', 'ambulance'];
    }

    if (tipo.includes('van')) {
      return ['van', 'vans'];
    }

    return [];
  }

  private getIntervaloPorTipo(
    configuracao: Record<string, unknown> | null,
    tipoVeiculo?: string,
  ): { valor: number; unidade?: 'km' | 'horas' } | undefined {
    if (!configuracao) return undefined;

    const keys = this.resolveTipoKeys(tipoVeiculo);
    if (!keys.length) return undefined;

    const intervalos = configuracao.intervalos as
      | Record<string, { valor?: number; unidade?: string }>
      | undefined;

    for (const key of keys) {
      const intervalo = intervalos?.[key];
      const valor = intervalo?.valor;
      if (typeof valor === 'number' && Number.isFinite(valor) && valor > 0) {
        return {
          valor,
          unidade: this.normalizeUnidade(intervalo?.unidade),
        };
      }
    }

    return undefined;
  }

  private resolveIntervaloRevisao(
    configuracao: Record<string, unknown> | null,
    vehicleData: {
      type?: string;
      tipo?: string;
      maintenanceInterval?: number;
      intervaloRevisao?: number;
      maintenanceUnit?: string;
      unidadeRevisao?: string;
    },
  ): { valor: number; unidade: 'km' | 'horas' } {
    const tipoVeiculo = vehicleData.type ?? vehicleData.tipo;
    const intervaloConfig = this.getIntervaloPorTipo(configuracao, tipoVeiculo);
    if (intervaloConfig) {
      return {
        valor: intervaloConfig.valor,
        unidade: intervaloConfig.unidade ?? 'km',
      };
    }

    const intervaloVeiculo =
      vehicleData.maintenanceInterval ?? vehicleData.intervaloRevisao;
    if (
      typeof intervaloVeiculo === 'number' &&
      Number.isFinite(intervaloVeiculo) &&
      intervaloVeiculo > 0
    ) {
      return {
        valor: intervaloVeiculo,
        unidade:
          this.normalizeUnidade(
            vehicleData.maintenanceUnit ?? vehicleData.unidadeRevisao,
          ) ?? 'km',
      };
    }

    return { valor: 1000, unidade: 'km' };
  }

  async create(createRevisionDto: CreateRevisionDto) {
    const revisionId = randomUUID();
    try {
      const newRevision = {
        id: revisionId,
        ...createRevisionDto,
        status: 'Pendente',
        createdAt: new Date().toISOString(),
      };

      const vehicleRef = await this.vehiclesCollection
        .where('id', '==', createRevisionDto.vehicleId)
        .get();

      if (vehicleRef.empty) {
        throw new NotFoundException(
          'Veículo não encontrado para o ID fornecido.',
        );
      }

      const vehicleDocID = vehicleRef.docs[0].id;

      const vehicleData = vehicleRef.docs[0].data() as {
        currentMeter: number;
        lastRevisionOdometerReading: number;
        maintenanceInterval?: number;
        intervaloRevisao?: number;
        maintenanceUnit?: string;
        unidadeRevisao?: string;
        type?: string;
        tipo?: string;
      };

      const lastOdometer = vehicleData?.lastRevisionOdometerReading || 0;
      const configRef = await this.configuracoesCollection
        .where('prefeituraId', '==', createRevisionDto.prefeituraId)
        .get();
      const configuracao = configRef.empty
        ? null
        : (configRef.docs[0].data() as Record<string, unknown>);
      const intervaloRevisao = this.resolveIntervaloRevisao(
        configuracao,
        vehicleData,
      );
      const unidadeMensagem = intervaloRevisao.unidade;
      const descricaoMedicao =
        unidadeMensagem === 'horas' ? 'A medição' : 'A quilometragem';

      if (
        createRevisionDto.odometerReading <=
        lastOdometer + intervaloRevisao.valor
      ) {
        throw new BadRequestException(
          `${descricaoMedicao} deve ser pelo menos ${intervaloRevisao.valor} ${unidadeMensagem} maior que a última revisão (${lastOdometer} ${unidadeMensagem}).`,
        );
      }

      if (createRevisionDto.odometerReading < vehicleData.currentMeter) {
        throw new BadRequestException(
          'A quilometragem não pode ser menor que a atual do veículo.',
        );
      }

      await this.collection.doc().set(newRevision);
      await this.vehiclesCollection.doc(vehicleDocID).update({
        status: 'bloqueado',
      });

      return {
        data: newRevision,
        message: 'Revisão criada com sucesso',
      };
    } catch (error) {
      console.error('Erro ao salvar revisão:', error);
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Ocorreu um erro ao salvar a revisão. Por favor, tente novamente mais tarde.',
      );
    }
  }

  /**
   * Registra uma revisão JÁ concluída e libera o veículo no mesmo passo:
   * grava a revisão com status "Concluída", adota a leitura informada como
   * leitura atual (currentMeter) e como base da próxima revisão
   * (lastRevisionOdometerReading), e devolve o veículo para "ativo".
   */
  async complete(createRevisionDto: CreateRevisionDto) {
    const revisionId = randomUUID();
    try {
      const vehicleRef = await this.vehiclesCollection
        .where('id', '==', createRevisionDto.vehicleId)
        .get();

      if (vehicleRef.empty) {
        throw new NotFoundException(
          'Veículo não encontrado para o ID fornecido.',
        );
      }

      const vehicleDocID = vehicleRef.docs[0].id;
      const vehicleData = vehicleRef.docs[0].data() as {
        currentMeter: number;
      };

      if (createRevisionDto.odometerReading < vehicleData.currentMeter) {
        throw new BadRequestException(
          'A quilometragem não pode ser menor que a atual do veículo.',
        );
      }

      const newRevision = {
        id: revisionId,
        ...createRevisionDto,
        status: 'Concluída',
        createdAt: new Date().toISOString(),
      };

      await this.collection.doc().set(newRevision);
      await this.vehiclesCollection.doc(vehicleDocID).update({
        currentMeter: createRevisionDto.odometerReading,
        lastRevisionOdometerReading: createRevisionDto.odometerReading,
        status: 'ativo',
        updatedAt: new Date().toISOString(),
      });

      return {
        data: newRevision,
        message: 'Revisão concluída e veículo liberado com sucesso',
      };
    } catch (error) {
      console.error('Erro ao concluir revisão:', error);
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Ocorreu um erro ao concluir a revisão. Por favor, tente novamente mais tarde.',
      );
    }
  }

  async findAllById(id: string) {
    try {
      const docRef = await this.collection
        .where('prefeituraId', '==', id)
        .get();

      if (docRef.empty) {
        throw new NotFoundException(
          'Nenhuma revisão encontrada para a prefeitura fornecida.',
        );
      }

      const revisions = docRef.docs.map((doc) => doc.data());
      return {
        data: revisions,
        message: 'Revisões buscadas com sucesso',
      };
    } catch (error) {
      console.error('Erro ao buscar revisões:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Ocorreu um erro ao buscar as revisões. Por favor, tente novamente mais tarde.',
      );
    }
  }
}

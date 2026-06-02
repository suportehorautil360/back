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
      };

      const lastOdometer = vehicleData?.lastRevisionOdometerReading || 0;

      if (createRevisionDto.odometerReading <= lastOdometer + 1000) {
        throw new BadRequestException(
          `A quilometragem deve ser pelo menos 1.000 km maior que a última revisão (${lastOdometer} km).`,
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


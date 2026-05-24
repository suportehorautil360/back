import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { FirebaseService } from '../../config/firebase.service';
import { v4 as uuid } from 'uuid';
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
    const revisionId = uuid();
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
      const vehicleDocID = vehicleRef.docs[0].id;

      const vehicleData = vehicleRef.docs[0].data() as {
        odometerReading: number;
        lastRevisionOdometerReading: number;
      };

      const lastOdometer = vehicleData?.lastRevisionOdometerReading || 0;

      if (createRevisionDto.odometerReading <= lastOdometer + 1000) {
        throw new BadRequestException(
          `A quilometragem deve ser pelo menos 1.000 km maior que a última revisão (${lastOdometer} km).`,
        );
      }

      if (createRevisionDto.odometerReading < vehicleData.odometerReading) {
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
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Ocorreu um erro ao salvar a revisão. Por favor, tente novamente mais tarde.',
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

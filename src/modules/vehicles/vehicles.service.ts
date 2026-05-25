import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { FirebaseService } from '../../config/firebase.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { v4 as uuid } from 'uuid';

@Injectable()
export class VehiclesService {
  // Injetamos o FirebaseService para poder conversar com o banco
  constructor(private firebaseService: FirebaseService) {}

  // Um "atalho" para não ter que digitar esse caminho gigante toda hora
  private get collection() {
    return this.firebaseService.getFirestore().collection('vehicles');
  }

  async create(createVehicleDto: CreateVehicleDto) {
    const id = uuid();
    try {
      const docRef = this.collection.doc();

      const newVehicle = {
        id,
        ...createVehicleDto,
        status: 'ativo',
        createdAt: new Date().toISOString(),
      };
      await docRef.set(newVehicle);
      return newVehicle;
    } catch (error) {
      console.error('Erro ao salvar veículo:', error);
      const firestoreErrorCode =
        typeof error === 'object' && error !== null && 'code' in error
          ? (error as { code?: number }).code
          : undefined;

      if (firestoreErrorCode === 5) {
        throw new InternalServerErrorException(
          'Firestore nao encontrado para este projeto. Verifique se o Firestore foi habilitado no Firebase/GCP e se as credenciais pertencem ao projeto correto.',
        );
      }
      throw new InternalServerErrorException(
        'Não foi possível salvar o veículo no banco de dados.',
      );
    }
  }

  async findAllByID(id: string) {
    try {
      const docRef = await this.collection
        .where('prefeituraId', '==', id)
        .get();

      if (docRef.empty) {
        throw new NotFoundException(
          'Nenhum veículo encontrado para a prefeitura fornecida.',
        );
      }
      const data = docRef.docs.map((doc) => doc.data());
      return { data, message: 'Veículos encontrados com sucesso!' };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      console.error('Erro ao buscar veículo:', error);

      throw new InternalServerErrorException(
        'Não foi possível buscar o veículo no banco de dados.',
      );
    }
  }

  async updateById(carId: string, updateVehicleDto: CreateVehicleDto) {
    try {
      const docRef = await this.collection.where('id', '==', carId).get();

      if (docRef.empty) {
        throw new NotFoundException(
          'Veículo não encontrado para o ID fornecido.',
        );
      }
      const docId = docRef.docs[0].id;

      await this.collection.doc(docId).update({
        ...updateVehicleDto,
        updatedAt: new Date().toISOString(),
      });

      return {
        data: {},
        message: 'Veículo atualizado com sucesso!',
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      console.error('Erro ao atualizar veículo:', error);

      throw new InternalServerErrorException(
        'Não foi possível atualizar o veículo no banco de dados. tente novamente mais tarde.',
      );
    }
  }

  async deleteById(carId: string) {
    try {
      const docRef = await this.collection.where('id', '==', carId).get();

      if (docRef.empty) {
        throw new NotFoundException(
          'Veículo não encontrado para o ID fornecido.',
        );
      }
      const docId = docRef.docs[0].id;

      await this.collection.doc(docId).delete();

      return {
        data: {},
        message: 'Veículo deletado com sucesso!',
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      console.error('Erro ao deletar veículo:', error);

      throw new InternalServerErrorException(
        'Não foi possível deletar o veículo no banco de dados. tente novamente mais tarde.',
      );
    }
  }
}

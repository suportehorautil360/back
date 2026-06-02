import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { FirebaseService } from '../../config/firebase.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { randomUUID } from 'node:crypto';

type VehicleFilters = {
  plate?: string;
  nome?: string;
  tipo?: string;
};

@Injectable()
export class VehiclesService {
  // Injetamos o FirebaseService para poder conversar com o banco
  constructor(private firebaseService: FirebaseService) {}

  // Um "atalho" para não ter que digitar esse caminho gigante toda hora
  private get collection() {
    return this.firebaseService.getFirestore().collection('vehicles');
  }

  async create(createVehicleDto: CreateVehicleDto) {
    const id = randomUUID();
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

  async findAllByID(id: string, filters?: VehicleFilters) {
    try {
      const docRef = await this.collection
        .where('prefeituraId', '==', id)
        .get();

      if (docRef.empty) {
        throw new NotFoundException(
          'Nenhum veículo encontrado para a prefeitura fornecida.',
        );
      }
      const data = docRef.docs
        .map((doc) => doc.data())
        .filter((vehicle) => this.matchesFilters(vehicle, filters));

      if (data.length === 0) {
        throw new NotFoundException(
          'Nenhum veículo encontrado para os filtros informados.',
        );
      }

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

  private matchesFilters(
    vehicle: Record<string, unknown>,
    filters?: VehicleFilters,
  ): boolean {
    const filtroPlate = this.normalizeText(filters?.plate);
    const filtroNome = this.normalizeText(filters?.nome);
    const filtroTipo = this.normalizeText(filters?.tipo);

    if (filtroPlate) {
      const plateValue = this.normalizeText(vehicle.plate ?? vehicle.chassis);
      if (!plateValue.includes(filtroPlate)) {
        return false;
      }
    }

    if (filtroNome) {
      const nomeValue = this.normalizeText(vehicle.name ?? vehicle.nome);
      if (!nomeValue.includes(filtroNome)) {
        return false;
      }
    }

    if (filtroTipo) {
      const tipoValue = this.normalizeText(vehicle.type ?? vehicle.tipo);
      if (!tipoValue.includes(filtroTipo)) {
        return false;
      }
    }

    return true;
  }

  private normalizeText(value: unknown): string {
    if (typeof value === 'string') {
      return value.trim().toLowerCase();
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value).trim().toLowerCase();
    }
    return '';
  }
}


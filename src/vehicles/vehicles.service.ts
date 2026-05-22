import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { FirebaseService } from '../services/firebase.service';
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
      // 1. Pede pro Firebase gerar uma referência vazia (isso já cria um ID único tipo 'aB3x9Y...')
      const docRef = this.collection.doc();

      // 2. Monta o objeto final misturando o que veio do front com as regras do back-end
      const newVehicle = {
        id,
        ...createVehicleDto, // Espalha todos os dados do DTO aqui (nome, placa, etc)
        status: 'ativo', // Todo veículo novo entra como ativo por padrão
        createdAt: new Date().toISOString(), // Salva a data e hora exata do cadastro
      };

      // 3. Manda salvar de fato no Firestore
      await docRef.set(newVehicle);

      // 4. Devolve o veículo criado (com o ID) para o Controller mandar pro Front-end
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
}

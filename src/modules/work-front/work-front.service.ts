import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { CreateWorkFrontDto } from './dto/create-work-front.dto';
import { FirebaseService } from 'src/config/firebase.service';
import { v4 as uuid } from 'uuid';

@Injectable()
export class WorkFrontService {
  constructor(private readonly firebaseService: FirebaseService) {}
  private get collection() {
    return this.firebaseService.getFirestore().collection('revision');
  }

  async create(createWorkFrontDto: CreateWorkFrontDto) {
    try {
      const db = this.firebaseService.getFirestore();

      const id = uuid();
      const newWorkFront = {
        id,
        ...createWorkFrontDto,
        createdAt: new Date().toISOString(),
      };
      await db.collection('work-fronts').doc().set(newWorkFront);
      return {
        data: newWorkFront,
        message: 'Front de trabalho criado com sucesso',
      };
    } catch (error) {
      console.error('Error creating work front:', error);
      throw new InternalServerErrorException(
        'Ocorreu um erro ao criar o front de trabalho. Por favor, tente novamente mais tarde.',
      );
    }
  }

  async findAll(prefeituraId: string) {
    try {
      const db = this.firebaseService.getFirestore();

      // 1. Busca as frentes de trabalho
      const snapshot = await db
        .collection('work-fronts')
        .where('prefeituraId', '==', prefeituraId)
        .get();

      // 2. Busca as alocações da prefeitura
      const allocationsSnapshot = await db
        .collection('allocations')
        .where('prefeituraId', '==', prefeituraId)
        .get();

      // Transforma as alocações em um array de objetos
      const allocationsData = allocationsSnapshot.docs.map((doc) => doc.data());

      // 3. Mapeia as frentes e injeta as alocações correspondentes
      const workFrontsData = snapshot.docs.map((doc) => {
        const workFront = doc.data();

        // Filtra apenas as alocações que pertencem a esta frente específica
        const equipments = allocationsData.filter(
          (alloc) => alloc.workFrontId === workFront.id,
        );

        return {
          ...workFront,
          equipamentos: equipments, // Aqui você injeta a lista
        };
      });

      return {
        data: workFrontsData,
        message: 'Fronts de trabalho com equipamentos recuperados com sucesso.',
      };
    } catch (error) {
      console.error('Error fetching work fronts:', error);
      throw new InternalServerErrorException(
        'Ocorreu um erro ao buscar os dados. Tente novamente mais tarde.',
      );
    }
  }

  async remove(workFrontId: string) {
    const db = this.firebaseService.getFirestore();
    const batch = db.batch();

    // 1. Busca todas as alocações dessa frente
    const allocations = await db
      .collection('allocations')
      .where('workFrontId', '==', workFrontId)
      .get();

    // 2. Adiciona cada alocação ao batch para deletar/inativar
    allocations.docs.forEach((doc) => {
      batch.delete(doc.ref); // Ou batch.update(doc.ref, { status: 'inativa' })
    });

    // 3. Adiciona a remoção da frente ao batch
    const frontSnapshot = await db
      .collection('work-fronts')
      .where('id', '==', workFrontId)
      .get();
    frontSnapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });

    // 4. Executa tudo de uma vez
    await batch.commit();

    return {
      message: 'Front de trabalho removido com sucesso',
    };
  }
}

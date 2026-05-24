import { Injectable } from '@nestjs/common';
import { FirebaseService } from 'src/config/firebase.service';

@Injectable()
export class TanksService {
  constructor(private readonly firebaseService: FirebaseService) {}
  private get collection() {
    return this.firebaseService.getFirestore().collection('tanks');
  }

  async findAll(prefeituraId: string) {
    try {
      const snapshot = await this.collection
        .where('prefeituraId', '==', prefeituraId)
        .get();
      snapshot.docs.map((doc) => {
        const data = doc.data();
        const percentage = (data.currentVolume / data.capacity) * 100;

        // Lógica de Status dinâmica
        let status = 'Normal';
        if (percentage <= 20) status = 'Critic';
        else if (percentage <= 60) status = 'Moderate';

        return {
          data: { ...data, status },
          message: 'Tanks encontrados com sucesso.',
        };
      });
    } catch (error) {
      console.error('Error fetching tanks:', error);
      throw new Error(
        'Ocorreu um erro ao buscar os tanques. Por favor, tente novamente mais tarde.',
      );
    }
  }
}

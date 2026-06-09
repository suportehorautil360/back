import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { FirebaseService } from 'src/config/firebase.service';

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor : '';
}

function numero(valor: unknown): number {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
  if (typeof valor === 'string') {
    const n = Number(valor);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

@Injectable()
export class TanksService {
  constructor(private readonly firebaseService: FirebaseService) {}

  private get firestore() {
    return this.firebaseService.getFirestore();
  }

  /**
   * Tanques do comboio da prefeitura, com nível/capacidade e (quando o tanque
   * está vinculado a um equipamento-comboio) o modelo/placa resolvidos da
   * coleção `equipamentos`.
   */
  async findAll(prefeituraId: string) {
    try {
      const [tanksSnap, equipSnap] = await Promise.all([
        this.firestore
          .collection('tanks')
          .where('prefeituraId', '==', prefeituraId)
          .get(),
        this.firestore
          .collection('equipamentos')
          .where('prefeituraId', '==', prefeituraId)
          .get(),
      ]);

      // Índice de equipamentos por chassi e por placa (para resolver o comboio).
      const porChassis = new Map<string, { modelo: string; placa: string }>();
      const porPlaca = new Map<string, { modelo: string; placa: string }>();
      for (const doc of equipSnap.docs) {
        const e = doc.data() as Record<string, unknown>;
        const info = {
          modelo: texto(e.modelo) || texto(e.descricao),
          placa: texto(e.placa),
        };
        const chassis = texto(e.chassis);
        const placa = texto(e.placa);
        if (chassis) porChassis.set(chassis, info);
        if (placa) porPlaca.set(placa.toUpperCase(), info);
      }

      const data = tanksSnap.docs.map((doc) => {
        const d = doc.data() as Record<string, unknown>;
        const capacity = numero(d.capacity);
        const currentVolume = numero(d.currentVolume);
        const percentage = capacity > 0 ? (currentVolume / capacity) * 100 : 0;

        let status = 'Normal';
        if (percentage <= 20) status = 'Critic';
        else if (percentage <= 60) status = 'Moderate';

        const vinculo =
          porChassis.get(texto(d.veiculoChassis)) ??
          porPlaca.get(texto(d.veiculoPlaca).toUpperCase());

        return {
          id: doc.id,
          ...d,
          capacity,
          currentVolume,
          percentage,
          status,
          veiculoModelo: texto(d.veiculoModelo) || vinculo?.modelo || '',
          veiculoPlaca: texto(d.veiculoPlaca) || vinculo?.placa || '',
        };
      });

      return { data, message: 'Tanks encontrados com sucesso.' };
    } catch (error) {
      console.error('Error fetching tanks:', error);
      throw new InternalServerErrorException(
        'Não foi possível buscar os tanques.',
      );
    }
  }
}

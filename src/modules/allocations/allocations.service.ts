import { Injectable } from '@nestjs/common';
import { FirebaseService } from 'src/config/firebase.service';
import { randomUUID } from 'node:crypto';
import { CreateAllocationDto } from './dto/create-allocation.dto';

@Injectable()
export class AllocationsService {
  constructor(private readonly firebaseService: FirebaseService) {}

  /**
   * Atualiza o campo `obra` do equipamento (= frente atual). Mantém a Frota /
   * Revisões em sincronia com a alocação. `obra` vazio = sem frente.
   */
  private async setObraDoEquipamento(vehicleId: string, obra: string) {
    if (!vehicleId) return;
    const db = this.firebaseService.getFirestore();
    const snapshot = await db
      .collection('equipamentos')
      .where('id', '==', vehicleId)
      .get();
    if (snapshot.empty) return;
    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.update(doc.ref, { obra }));
    await batch.commit();
  }

  async allocate(createDto: CreateAllocationDto) {
    const db = this.firebaseService.getFirestore();
    const id = randomUUID();

    // "Mover": encerra qualquer alocação ativa anterior do mesmo veículo,
    // garantindo no máximo 1 frente por equipamento.
    const anteriores = await db
      .collection('allocations')
      .where('vehicleId', '==', createDto.vehicleId)
      .get();

    const allocation = {
      id,
      ...createDto,
      createdAt: new Date().toISOString(),
      status: 'active',
    };

    const batch = db.batch();
    anteriores.docs.forEach((doc) => batch.delete(doc.ref));
    batch.set(db.collection('allocations').doc(), allocation);
    await batch.commit();

    // Sincroniza o `obra` do equipamento com a frente de destino.
    await this.setObraDoEquipamento(
      createDto.vehicleId,
      createDto.workFrontName,
    );

    return allocation;
  }

  async remove(allocationId: string) {
    const db = this.firebaseService.getFirestore();
    const snapshot = await db
      .collection('allocations')
      .where('id', '==', allocationId)
      .get();

    const vehicleIds = snapshot.docs
      .map((doc) => doc.data().vehicleId as string | undefined)
      .filter((v): v is string => !!v);

    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();

    // Limpa o `obra` dos veículos desalocados.
    for (const vehicleId of vehicleIds) {
      await this.setObraDoEquipamento(vehicleId, '');
    }
  }
}


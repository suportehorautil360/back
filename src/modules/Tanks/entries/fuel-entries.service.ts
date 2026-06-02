import { Injectable } from '@nestjs/common';
import { FirebaseService } from 'src/config/firebase.service';
import { CreateFuelEntryDto } from '../dto/create-fuel-entry.dto';
import { randomUUID } from 'node:crypto';

@Injectable()
export class FuelEntriesService {
  constructor(private readonly firebaseService: FirebaseService) {}

  async createEntry(createDto: CreateFuelEntryDto) {
    const db = this.firebaseService.getFirestore();
    const batch = db.batch();

    // Acessando o FieldValue via seu serviço centralizado
    const { FieldValue } = this.firebaseService;

    const entryId = randomUUID();
    const entryRef = db.collection('fuel-entries').doc(entryId);
    const tankRef = db.collection('tanks').doc(createDto.tankId);

    batch.set(entryRef, {
      ...createDto,
      createdAt: new Date().toISOString(),
    });

    batch.update(tankRef, {
      currentVolume: FieldValue.increment(createDto.volume),
    });

    await batch.commit();
    return { success: true };
  }
}


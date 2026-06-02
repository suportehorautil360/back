import { Injectable } from '@nestjs/common';
import { FirebaseService } from 'src/config/firebase.service';
import { v4 as uuid } from 'uuid';
import { CreateAllocationDto } from './dto/create-allocation.dto';

@Injectable()
export class AllocationsService {
  constructor(private readonly firebaseService: FirebaseService) {}

  async allocate(createDto: CreateAllocationDto) {
    const db = this.firebaseService.getFirestore();
    const id = uuid();

    const allocation = {
      id,
      ...createDto,
      createdAt: new Date().toISOString(),
      status: 'active',
    };

    await db.collection('allocations').doc().set(allocation);
    return allocation;
  }

  async remove(allocationId: string) {
    const db = this.firebaseService.getFirestore();
    const snapshot = await db
      .collection('allocations')
      .where('id', '==', allocationId)
      .get();

    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
}

import { Injectable } from '@nestjs/common';
import { FirebaseService } from 'src/config/firebase.service';
import { randomUUID } from 'node:crypto';
import { CreateAllocationDto } from './dto/create-allocation.dto';

@Injectable()
export class AllocationsService {
  constructor(private readonly firebaseService: FirebaseService) {}

  async allocate(createDto: CreateAllocationDto) {
    const db = this.firebaseService.getFirestore();
    const id = randomUUID();

    const allocation = {
      id,
      ...createDto,
      createdAt: new Date().toISOString(),
      status: 'active',
    };

    await db.collection('allocations').doc().set(allocation);
    return allocation;
  }
}


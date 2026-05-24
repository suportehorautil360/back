import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';

@Injectable()
export class FirebaseService {
  private static db: admin.firestore.Firestore;

  constructor(private configService: ConfigService) {
    // A inicialização só ocorre se a variável estática db estiver vazia
    if (!FirebaseService.db) {
      if (admin.apps.length === 0) {
        admin.initializeApp({
          credential: admin.credential.cert({
            projectId: this.configService.get<string>('FIREBASE_PROJECT_ID'),
            clientEmail: this.configService.get<string>(
              'FIREBASE_CLIENT_EMAIL',
            ),
            privateKey: this.configService
              .get<string>('FIREBASE_PRIVATE_KEY')
              ?.replace(/\\n/g, '\n'),
          }),
        });
      }

      FirebaseService.db = admin.firestore();

      // Configuração única garantida pela verificação estática
      FirebaseService.db.settings({
        ignoreUndefinedProperties: true,
        preferRest: true,
        databaseId: 'default',
      });
    }
  }

  getFirestore() {
    return FirebaseService.db;
  }

  get FieldValue() {
    return admin.firestore.FieldValue;
  }
}

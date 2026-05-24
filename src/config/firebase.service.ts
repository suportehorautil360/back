import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

@Injectable()
export class FirebaseService {
  private static db: admin.firestore.Firestore;

  constructor(private configService: ConfigService) {
    // A inicialização só ocorre se a variável estática db estiver vazia
    if (!FirebaseService.db) {
      if (admin.apps.length === 0) {
        admin.initializeApp({
          credential: this.getCredential(),
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

  private getCredential(): admin.credential.Credential {
    const projectId = this.configService.get<string>('FIREBASE_PROJECT_ID');
    const clientEmail = this.configService.get<string>('FIREBASE_CLIENT_EMAIL');
    const privateKey = this.configService
      .get<string>('FIREBASE_PRIVATE_KEY')
      ?.replace(/\\n/g, '\n');

    if (projectId && clientEmail && privateKey) {
      return admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      });
    }

    if (projectId || clientEmail || privateKey) {
      throw new Error(
        'Firebase env vars incompletas. Informe FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL e FIREBASE_PRIVATE_KEY, ou use FIREBASE_SERVICE_ACCOUNT_PATH.',
      );
    }

    const serviceAccountPath =
      this.configService.get<string>('FIREBASE_SERVICE_ACCOUNT_PATH') ??
      this.configService.get<string>('GOOGLE_APPLICATION_CREDENTIALS');

    if (serviceAccountPath) {
      const absolutePath = isAbsolute(serviceAccountPath)
        ? serviceAccountPath
        : resolve(process.cwd(), serviceAccountPath);

      if (!existsSync(absolutePath)) {
        throw new Error(
          `Firebase service account não encontrado: ${absolutePath}`,
        );
      }

      const serviceAccount = JSON.parse(readFileSync(absolutePath, 'utf8'));

      return admin.credential.cert(serviceAccount);
    }

    return admin.credential.applicationDefault();
  }
}

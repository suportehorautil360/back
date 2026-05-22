import { Injectable, OnModuleInit } from '@nestjs/common';
import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class FirebaseService implements OnModuleInit {
  private db!: admin.firestore.Firestore;

  onModuleInit() {
    if (admin.apps.length === 0) {
      // Resolve o caminho absoluto para garantir que o Node encontra o arquivo na raiz
      const serviceAccountPath = path.resolve(
        process.cwd(),
        'firebase-adminsdk.json',
      );

      console.log('--- DEBUG FIREBASE JSON ---');
      console.log('A carregar credenciais de:', serviceAccountPath);
      console.log('---------------------------');

      if (!fs.existsSync(serviceAccountPath)) {
        throw new Error(
          `Arquivo de credenciais nao encontrado em: ${serviceAccountPath}`,
        );
      }

      const serviceAccount = JSON.parse(
        fs.readFileSync(serviceAccountPath, 'utf8'),
      ) as admin.ServiceAccount & { project_id?: string };

      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.projectId ?? serviceAccount.project_id,
      });
    }

    const db = admin.firestore();

    db.settings({
      ignoreUndefinedProperties: true,
      preferRest: true,
      databaseId: 'default',
    });

    this.db = db;
  }

  getFirestore() {
    return this.db;
  }
}

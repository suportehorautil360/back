/**
 * ⚠️ DÍVIDA DE SEGURANÇA (rastreada em issue): credenciais do Firebase Admin
 * embutidas no código a pedido do cliente, porque o host do backend NÃO dá
 * acesso a variáveis de ambiente.
 *
 * Consequências: a chave privada vai para o repositório (e GitHub). Assim que
 * for possível usar variáveis de ambiente / secret manager:
 *   1. Migrar estas credenciais para env (FIREBASE_PROJECT_ID / _CLIENT_EMAIL /
 *      _PRIVATE_KEY ou FIREBASE_SERVICE_ACCOUNT_PATH).
 *   2. ROTACIONAR esta chave no Console do Firebase (ela deve ser considerada
 *      comprometida a partir do momento em que entrou no repositório).
 */
import type { ServiceAccount } from 'firebase-admin';

/** Banco Firestore do projeto de produção (padrão "(default)"). */
export const FIREBASE_DATABASE_ID = '(default)';

export const FIREBASE_SERVICE_ACCOUNT: ServiceAccount = {
  projectId: 'horautil360',
  clientEmail: 'firebase-adminsdk-fbsvc@horautil360.iam.gserviceaccount.com',
  privateKey:
    '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDk3ZFUmye0fFcQ\nnq3jdIeZnAK/gz93DM+34xErLxNyDIGtO4SF4jysXJA0hlPUfc/qdCS79RW6iD5o\nf8lVvZ07Mr9qJkjoOC8XGlYZ4yNdTaZas/Qqvlav7Kj3c5TnkVQy1PUqr/HcK+Rv\ngWupaMa5aMwW56ADLZh070eQ9YgtJHVAo39ElQTLMqyQEahVJrGByfaB6i44jGch\n+yYPC4vu+aLTMzzeR+nXs3+luw0mZHwIXrsl1s2JfQQzkGXWzL+8jMrovZm17NLw\n+dtBM4NcvKn6stcoaa+pPpnTxM0xc2IJ0681DtgQeFrVO3FP21VxFnwXfhaZIip6\nE64oXRrvAgMBAAECggEAIepzzwXvLGAAxwW83yg1sB3eimL41LuhTK7prGydhRk1\nXmajjPOp6iENfbsqUSMT3Lq5duErBymJlhLZ00r2Mf+jPifORhuNXu8YM13lr74C\nGQ7x8COk1Q1NPN50Ap0WzTGh42GPhgE7KQsU2VYdnPxawkow/EeVgD61bFX2iDnH\nJ0uXZD4b7IKjlaDEvdvhhtcOFfPiByOxdvIxWwSdrX5g7YMDmBAIdohDSwLDC8uz\nBDjs8ESIlmALeFSIJg9djBxgj7lDoCGL+iJ1dU27qmhSgDuetG21ZUdCKJIcojMA\nFkzfcdz5MrtgiAR/xqtK3TRzQsnICxSxa1W88ogygQKBgQD1GScLLqKBnIXakZvA\nQTE29Gixh7eDahUKwfyfuC+Y0SbhQFU/5/fEclBbvKHE4QtgnNRox6+TT3RYkF/9\noZdA1FGeqjVPDL+fFLMkvY3Mb//AZfUVkOrIoiPsbUb7xTnnB6MjVJGjXgkIs5Q3\nXjJjbDMWShupzWCNkr0gk8VSOwKBgQDvC5QbGgUQm/H782Fjr5EeijOXS/b9mZjf\nreu/xTMFniNZ7rQ0wy+oYtZwlQL7IRxoLhKD5DrQ7KBzUw6nnMKvhvfH+K9s/xOU\nIefUrOTzcQ+n/B5dNwKma/1hfZMwn6/uUmbM2/G87cfNMSAP5Y8trt6/BY4AR2n7\nX8TVDy963QKBgQCpG7umqXySdQ6d6c1O7ywnwKbjpsJlt7HhBEtrYEfm5pgu3pZz\nS3fWYRE02oe7MZMKC+s6iFyKBU4/NQ4mD3Iu1s+h68pwSlmER2H7PZYysiwB8dcS\nFDUKTWT/4b4SRNhYoRpcbCM4Vs9g45amRSX7F1KAVI2VsRCnXdGEQrDotQKBgCw8\nmEvrpMROF5nokD1CYDimmqWFCVAk/IVoShhTBf4kJaae5fpdpJQktkpfSQ3wMrGU\n1RhTRA8luwuccznRaLXS5Ee9Xblt+tGO9LgGxtfGNH+ByJy3cWYa1ekUtAhrhMM1\nvJBso2+zESaH0McgVD6//bib7oteq944+tPy23aBAoGBAMESRGJNhed5O+ZQyV9p\nqZBlXwBAHu9Uh4Ey1iEdqvGsGAldi0jZBtGoT49kSzN//wyA9e/dnk0cFbDryv1a\n6pB6MGtvB4xcq+++K+i8i5KXbFFkc5nVDFOPcTNj6Hz18sIS21knD6ezO7bhfgNr\nR/g9mZIIBSQ8ikVfNeZEWrXE\n-----END PRIVATE KEY-----\n',
};

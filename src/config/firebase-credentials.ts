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
// export const FIREBASE_DATABASE_ID = '(default)';

// export const FIREBASE_SERVICE_ACCOUNT: ServiceAccount = {
//   projectId: 'horautil360',
//   clientEmail: 'firebase-adminsdk-fbsvc@horautil360.iam.gserviceaccount.com',
//   privateKey:
//     '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDk3ZFUmye0fFcQ\nnq3jdIeZnAK/gz93DM+34xErLxNyDIGtO4SF4jysXJA0hlPUfc/qdCS79RW6iD5o\nf8lVvZ07Mr9qJkjoOC8XGlYZ4yNdTaZas/Qqvlav7Kj3c5TnkVQy1PUqr/HcK+Rv\ngWupaMa5aMwW56ADLZh070eQ9YgtJHVAo39ElQTLMqyQEahVJrGByfaB6i44jGch\n+yYPC4vu+aLTMzzeR+nXs3+luw0mZHwIXrsl1s2JfQQzkGXWzL+8jMrovZm17NLw\n+dtBM4NcvKn6stcoaa+pPpnTxM0xc2IJ0681DtgQeFrVO3FP21VxFnwXfhaZIip6\nE64oXRrvAgMBAAECggEAIepzzwXvLGAAxwW83yg1sB3eimL41LuhTK7prGydhRk1\nXmajjPOp6iENfbsqUSMT3Lq5duErBymJlhLZ00r2Mf+jPifORhuNXu8YM13lr74C\nGQ7x8COk1Q1NPN50Ap0WzTGh42GPhgE7KQsU2VYdnPxawkow/EeVgD61bFX2iDnH\nJ0uXZD4b7IKjlaDEvdvhhtcOFfPiByOxdvIxWwSdrX5g7YMDmBAIdohDSwLDC8uz\nBDjs8ESIlmALeFSIJg9djBxgj7lDoCGL+iJ1dU27qmhSgDuetG21ZUdCKJIcojMA\nFkzfcdz5MrtgiAR/xqtK3TRzQsnICxSxa1W88ogygQKBgQD1GScLLqKBnIXakZvA\nQTE29Gixh7eDahUKwfyfuC+Y0SbhQFU/5/fEclBbvKHE4QtgnNRox6+TT3RYkF/9\noZdA1FGeqjVPDL+fFLMkvY3Mb//AZfUVkOrIoiPsbUb7xTnnB6MjVJGjXgkIs5Q3\nXjJjbDMWShupzWCNkr0gk8VSOwKBgQDvC5QbGgUQm/H782Fjr5EeijOXS/b9mZjf\nreu/xTMFniNZ7rQ0wy+oYtZwlQL7IRxoLhKD5DrQ7KBzUw6nnMKvhvfH+K9s/xOU\nIefUrOTzcQ+n/B5dNwKma/1hfZMwn6/uUmbM2/G87cfNMSAP5Y8trt6/BY4AR2n7\nX8TVDy963QKBgQCpG7umqXySdQ6d6c1O7ywnwKbjpsJlt7HhBEtrYEfm5pgu3pZz\nS3fWYRE02oe7MZMKC+s6iFyKBU4/NQ4mD3Iu1s+h68pwSlmER2H7PZYysiwB8dcS\nFDUKTWT/4b4SRNhYoRpcbCM4Vs9g45amRSX7F1KAVI2VsRCnXdGEQrDotQKBgCw8\nmEvrpMROF5nokD1CYDimmqWFCVAk/IVoShhTBf4kJaae5fpdpJQktkpfSQ3wMrGU\n1RhTRA8luwuccznRaLXS5Ee9Xblt+tGO9LgGxtfGNH+ByJy3cWYa1ekUtAhrhMM1\nvJBso2+zESaH0McgVD6//bib7oteq944+tPy23aBAoGBAMESRGJNhed5O+ZQyV9p\nqZBlXwBAHu9Uh4Ey1iEdqvGsGAldi0jZBtGoT49kSzN//wyA9e/dnk0cFbDryv1a\n6pB6MGtvB4xcq+++K+i8i5KXbFFkc5nVDFOPcTNj6Hz18sIS21knD6ezO7bhfgNr\nR/g9mZIIBSQ8ikVfNeZEWrXE\n-----END PRIVATE KEY-----\n',
// };

export const FIREBASE_DATABASE_ID = 'default';

export const FIREBASE_SERVICE_ACCOUNT: ServiceAccount = {
  projectId: 'horautil-homolog',
  clientEmail:
    'firebase-adminsdk-fbsvc@horautil-homolog.iam.gserviceaccount.com',
  privateKey:
    '-----BEGIN PRIVATE KEY-----\nMIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQDezz5c0quyynPo\nVkeNf/bCgeUPInXborruAYHBF3ZIUlmNSZ5PnBDp+8txxsG2wRW2739dCJehpb46\ngwVH9n0IuKNa9wovHxgMJ/NLAOabuXO57lgKrhQex++1yAKnkHJJ+t+AfKXobWJD\n48Y4AMVy/+YyNFb9QrA3X7Yy3FyDSZ/zlhmWWFEDe+Fgbql0LHsLlIT8iGsIuqVL\n30uCK1GQyhO/gN4VnptA4ZGWeFtekdz9Wa4OsZ8oeDf/Ls8SOd7USIGd8UHocST+\n5I7MTFC5//XsE0rCU3XNJ0CT34SNkvSDna53o+IaowB6MqiyJbpIWT0q716vAcge\nPQkUG7vZAgMBAAECggEABdzlMrMWcodyQlhW3KnT1+1sFhhdipB/I7klbWvNIH0O\nPzIDOOwN4+JMyasluMXe6OfnbY7G0qmWVlrRPkIFqz+UiNW8Tl4el19LvxsAdnOM\nUIWtimZnQCIZtCpVq4wY/cpcrDhbc0DBl7C8LAgVKgAC0ipfaZ2iHmrl0/PJeWjf\neUVS3SmFUei1Mdwjm+ZW6AnjpnZ+L/7PCALb7VOe8SajWETikkEpOcYTGCc4rOF8\nTsS0WqoqhU1anI376zSh1ijSqrjwPP20r66S4QWrBq2Ye3+4ihLdvCK5ddL7PsAQ\nYL5mtvcZzZoEF+KAnguXT6Uq+jHiyP5FICzbnNIYyQKBgQD3yeoZz5BwE2nDR+Xt\npTr7jF5krWKMcliJGTc8D/ZvKjhMWsDZJtAXXust+CzFyS+9W2fI8U6UPSBoc2v0\n8GbIQb4tOOx00aekGO6AcNT/nYxz0hh0KTKT0nCld6Bh9nbApLzBfT/vwOPSQZ02\nMNduqpTdBZ0a8kgff2PqUiZb9QKBgQDmMWvZZ5FmjVkiigxDjx41vGcWFpFS+Rou\nx90j1Iv75L0zZ2NWMBb2DKvQLMJea2wwqqCZ3uMNX5jYGGb3WTA7yi9bN23oowFe\nQIzx/USwSifGhbk33NXLyTYu9UmXKZVRXcLL99HoTNvNX3aR0hr0EhRyDeMBUwV/\nlSCON1m11QKBgQCRfSzHGuhj5gIjdwO6FVoceL6zvlouvLTfSr7ztSus+c00h9TT\nq8Zi8oiD5UPkncw6EoFNquHIiFuO+LZaiwzOaEuRoeq0bKVR5JGlOJrXu1nMZ3+U\nNNxNjzI09Zhl7KCtXAy4TyJLU6ZwvbXhK6xSfjYJ0FH+kGNomxO/cZy0QQKBgQCb\nOkSCDKcuQq8S7Yirnj0++1eAu6MwEq8nULu9R71GFc/IdDW2jyNMtOq/rQ89YK9K\neiVm3bi68fY98uasccZm60bX+h7xu8pWZq0lGidRwg/kfZSTKSY7D+qr69i+SNpa\nTiHoLautPPcUHQX1+3sVj4OeDeNAp12T1VpozMaAKQKBgQCV8lS/DXmTipQZSAEJ\nfOuQ24+TcbvdApVIsEHIXa4YnebCAUhzLzRQ7GuhGsKYJ0R/ph3vgYk9vQukp1Ej\n60WS4mcGYvplMqcj/u289b5honhievfhxJ9mzpkIh/QEpfxvcUZXFxd8mN4JXqBT\n+f8MpxthgDuEbnLDdFgPTGzGfQ==\n-----END PRIVATE KEY-----\n',
};

import * as admin from 'firebase-admin';

/**
 * Ajusta o saldo (`currentVolume`) do tanque do comboio da prefeitura — pega o
 * 1º tanque (mesma regra do dashboard). Incremento atômico via
 * `FieldValue.increment`. Best-effort: erros são logados e NÃO derrubam a
 * movimentação que originou o ajuste.
 *
 * Convenção: `deltaLitros` positivo soma (reabastecimento do comboio),
 * negativo desconta (abastecimento de equipamento a partir do comboio).
 */
export async function ajustarSaldoTanque(
  firestore: admin.firestore.Firestore,
  prefeituraId: string,
  deltaLitros: number,
): Promise<void> {
  if (!prefeituraId || !Number.isFinite(deltaLitros) || deltaLitros === 0) {
    return;
  }
  try {
    const snap = await firestore
      .collection('tanks')
      .where('prefeituraId', '==', prefeituraId)
      .limit(1)
      .get();
    if (snap.empty) return;
    await snap.docs[0].ref.update({
      currentVolume: admin.firestore.FieldValue.increment(deltaLitros),
    });
  } catch (error) {
    console.error('Erro ao ajustar saldo do tanque:', error);
  }
}

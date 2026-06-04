/**
 * Formata um número para o JID do WhatsApp. Garante o DDI 55 (Brasil) quando
 * o número vem só com DDD (10 dígitos = fixo, 11 = celular).
 */
export function formatarJid(numero: string | null | undefined): string {
  let d = (numero ?? '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return `${d}@s.whatsapp.net`;
}

/** Há dígitos suficientes para um número válido? */
export function numeroValido(numero: string | null | undefined): boolean {
  const d = (numero ?? '').replace(/\D/g, '');
  return d.length >= 10;
}

/**
 * Formata um número para o JID do WhatsApp. Se vier em E.164 (começa com `+`),
 * o DDI já está presente e os dígitos são usados como estão. Para números
 * legados sem `+` e só com DDD (10 = fixo, 11 = celular), assume Brasil e
 * prefixa o DDI 55.
 */
export function formatarJid(numero: string | null | undefined): string {
  const raw = (numero ?? '').trim();
  let d = raw.replace(/\D/g, '');
  if (!raw.startsWith('+') && (d.length === 10 || d.length === 11)) {
    d = `55${d}`;
  }
  return `${d}@s.whatsapp.net`;
}

/** Há dígitos suficientes para um número válido? */
export function numeroValido(numero: string | null | undefined): boolean {
  const d = (numero ?? '').replace(/\D/g, '');
  return d.length >= 10;
}

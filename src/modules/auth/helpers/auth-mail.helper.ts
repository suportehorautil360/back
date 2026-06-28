export function htmlResetSenhaOficina(opts: {
  nome: string;
  link: string;
  expiraHoras: number;
}): { html: string; text: string } {
  const { nome, link, expiraHoras } = opts;

  const text = [
    `Olá, ${nome}.`,
    '',
    'Recebemos um pedido para redefinir a senha do app da oficina (Hora Útil 360).',
    '',
    `Acesse o link abaixo (válido por ${expiraHoras} hora(s)) para criar uma nova senha:`,
    link,
    '',
    'Se você não solicitou, ignore este e-mail.',
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<body style="font-family:system-ui,sans-serif;line-height:1.5;color:#0f172a;max-width:520px;margin:0 auto;padding:24px">
  <p>Olá, <strong>${escapeHtml(nome)}</strong>.</p>
  <p>Recebemos um pedido para redefinir a senha do <strong>app da oficina</strong> (Hora Útil 360).</p>
  <p style="margin:24px 0">
    <a href="${escapeHtml(link)}" style="display:inline-block;background:#f97316;color:#000;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Redefinir senha</a>
  </p>
  <p style="font-size:13px;color:#64748b">Este link expira em ${expiraHoras} hora(s). Se você não solicitou, ignore este e-mail.</p>
  <p style="font-size:12px;color:#94a3b8;word-break:break-all">${escapeHtml(link)}</p>
</body>
</html>`;

  return { html, text };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

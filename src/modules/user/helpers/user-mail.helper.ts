export function htmlResetSenhaPosto(opts: {
  nome: string;
  link: string;
  expiraHoras: number;
}): { html: string; text: string } {
  const { nome, link, expiraHoras } = opts;
  const text = [
    `Olá, ${nome}.`,
    '',
    'Recebemos um pedido para redefinir a senha do seu acesso ao portal do posto (Hora Útil 360 / FleetFuel).',
    '',
    `Acesse o link abaixo (válido por ${expiraHoras} hora(s)):`,
    link,
    '',
    'Se você não solicitou, ignore este e-mail.',
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<body style="font-family:system-ui,sans-serif;line-height:1.5;color:#0f172a;max-width:520px;margin:0 auto;padding:24px">
  <p>Olá, <strong>${escapeHtml(nome)}</strong>.</p>
  <p>Recebemos um pedido para redefinir a senha do seu acesso ao <strong>portal do posto</strong> (Hora Útil 360 / FleetFuel).</p>
  <p style="margin:24px 0">
    <a href="${escapeHtml(link)}" style="display:inline-block;background:#f97316;color:#000;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Redefinir senha</a>
  </p>
  <p style="font-size:13px;color:#64748b">Este link expira em ${expiraHoras} hora(s). Se você não solicitou, ignore este e-mail.</p>
  <p style="font-size:12px;color:#94a3b8;word-break:break-all">${escapeHtml(link)}</p>
</body>
</html>`;

  return { html, text };
}

export function htmlBoasVindasPosto(opts: {
  nome: string;
  usuario: string;
  postoNome?: string;
  senhaTemporaria?: string;
  loginUrl: string;
}): { html: string; text: string } {
  const { nome, usuario, postoNome, senhaTemporaria, loginUrl } = opts;
  const credenciais = senhaTemporaria
    ? `\nLogin: ${usuario}\nSenha temporária: ${senhaTemporaria}\n`
    : `\nLogin: ${usuario}\n(use a senha definida pelo administrador)\n`;

  const text = [
    `Olá, ${nome}.`,
    '',
    `Seu acesso ao portal do posto${postoNome ? ` (${postoNome})` : ''} foi criado.`,
    credenciais.trim(),
    '',
    `Entrar: ${loginUrl}`,
  ].join('\n');

  const senhaBlock = senhaTemporaria
    ? `<p><strong>Login:</strong> ${escapeHtml(usuario)}<br><strong>Senha temporária:</strong> ${escapeHtml(senhaTemporaria)}</p>`
    : `<p><strong>Login:</strong> ${escapeHtml(usuario)}</p>`;

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<body style="font-family:system-ui,sans-serif;line-height:1.5;color:#0f172a;max-width:520px;margin:0 auto;padding:24px">
  <p>Olá, <strong>${escapeHtml(nome)}</strong>.</p>
  <p>Seu acesso ao <strong>portal do posto</strong>${postoNome ? ` — ${escapeHtml(postoNome)}` : ''} foi criado.</p>
  ${senhaBlock}
  <p style="margin:24px 0">
    <a href="${escapeHtml(loginUrl)}" style="display:inline-block;background:#f97316;color:#000;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Acessar portal</a>
  </p>
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

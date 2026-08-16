import { createHash } from 'node:crypto';

export function limparCpf(cpf: string): string {
  return (cpf || '').replace(/\D/g, '');
}

function sha256hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** SHA-256("<cpf>:<senha>") — paridade com o PWA legado. */
export function hashSenhaFuncionario(cpf: string, senha: string): string {
  return sha256hex(`${limparCpf(cpf)}:${senha}`);
}

/** Login gerado: primeiro nome + 3 últimos dígitos do CPF. */
export function gerarLoginOperador(nome: string, cpf: string): string {
  const primeiro = (nome || '').trim().split(/\s+/)[0] ?? '';
  const cpfLimpo = limparCpf(cpf);
  if (!primeiro || cpfLimpo.length < 3) return '';
  return `${primeiro.toLowerCase()}${cpfLimpo.slice(-3)}`;
}

/** SHA-256 da senha em texto — login do portal do posto. */
export function hashSenhaPosto(senha: string): string {
  return createHash('sha256').update(senha).digest('hex');
}

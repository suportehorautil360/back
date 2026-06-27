import { randomBytes } from 'node:crypto';
import type { TipoParceiro } from '../parceiros.types';

const ALFABETO_SENHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface CredenciaisLoginAutomatico {
  nome: string;
  usuario: string;
  senhaInicial: string;
}

/** Normaliza texto para slug de login (a-z, 0-9, ponto). */
export function slugLoginBase(valor: string, max = 20): string {
  const slug = valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .replace(/\.{2,}/g, '.');

  if (!slug) return 'parceiro';
  return slug.length > max ? slug.slice(0, max).replace(/\.$/, '') : slug;
}

export function gerarSenhaInicial(tamanho = 8): string {
  const bytes = randomBytes(tamanho);
  let senha = '';
  for (let i = 0; i < tamanho; i++) {
    senha += ALFABETO_SENHA[bytes[i]! % ALFABETO_SENHA.length];
  }
  return senha;
}

export function montarUsuarioLogin(
  tipo: TipoParceiro,
  slugBase: string,
  parceiroId: string,
): string {
  const base = slugLoginBase(slugBase);
  const sufixo = parceiroId.replace(/-/g, '').slice(0, 6).toLowerCase();
  return `${tipo}.${base}.${sufixo}`;
}

export function credenciaisLoginAutomatico(
  tipo: TipoParceiro,
  parceiroId: string,
  opts: { nomeExibicao: string; slugBase: string },
): CredenciaisLoginAutomatico {
  const nome = opts.nomeExibicao.trim() || 'Gestor';
  return {
    nome,
    usuario: montarUsuarioLogin(tipo, opts.slugBase, parceiroId),
    senhaInicial: gerarSenhaInicial(),
  };
}

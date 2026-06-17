function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function listaTexto(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  return valor.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
}

/** "Linha Amarela" → "Amarela" (compatível com match flexível da OS). */
export function linhaAtuacaoParaEspecialidade(linha: string): string {
  const limpa = linha.trim().replace(/^linha\s+/i, '').trim();
  return limpa || linha.trim();
}

/**
 * Especialidade usada no sorteio OS: campo explícito, primeira linha de atuação
 * ou categorias de serviço.
 */
export function especialidadeFromOficinaDoc(
  data: Record<string, unknown>,
): string {
  const explicita = texto(data.especialidade);
  if (explicita) return explicita;

  const linhas = listaTexto(data.linhasAtuacao);
  if (linhas.length > 0) {
    return linhaAtuacaoParaEspecialidade(linhas[0]);
  }

  return listaTexto(data.categoriasServico).join(', ');
}

export function nomeFromOficinaDoc(
  data: Record<string, unknown>,
  fallbackId = '',
): string {
  return (
    texto(data.nome) ||
    texto(data.nomeFantasia) ||
    texto(data.razaoSocial) ||
    fallbackId
  );
}

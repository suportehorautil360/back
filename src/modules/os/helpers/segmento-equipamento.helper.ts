/** Segmentos de atuação de oficina (cadastro de parceiro + sorteio de OS). */
export const SEGMENTOS_OFICINA = [
  'Carro leve',
  'Máquinas linha amarela',
  'Tratores linha verde',
  'Caminhão linha branca',
] as const;

export type SegmentoOficina = (typeof SEGMENTOS_OFICINA)[number];

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function norm(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function blobEquipamento(raw: Record<string, unknown>): string {
  return norm(
    [
      texto(raw.tipo),
      texto(raw.linha),
      texto(raw.descricao),
      texto(raw.modelo),
      texto(raw.marca),
    ].join(' '),
  );
}

/** Infere o segmento do equipamento para direcionar oficinas na OS. */
export function resolveSegmentoEquipamento(
  raw: Record<string, unknown>,
): SegmentoOficina | '' {
  const blob = blobEquipamento(raw);
  const linha = norm(texto(raw.linha) || texto(raw.tipo));

  if (
    linha.includes('leve') ||
    blob.includes('carro leve') ||
    blob.includes('linha leve') ||
    blob.includes('veiculo leve') ||
    /\b(hatch|sedan|pickup leve|camionete)\b/.test(blob)
  ) {
    return 'Carro leve';
  }

  if (
    linha.includes('verde') ||
    blob.includes('trator') ||
    blob.includes('colheitadeira') ||
    blob.includes('pulverizador')
  ) {
    return 'Tratores linha verde';
  }

  if (
    linha.includes('branca') ||
    blob.includes('caminh') ||
    blob.includes('truck') ||
    blob.includes('onibus') ||
    blob.includes('ônibus')
  ) {
    return 'Caminhão linha branca';
  }

  if (
    linha.includes('amarela') ||
    blob.includes('escavadeira') ||
    blob.includes('retroescavadeira') ||
    blob.includes('carregadeira') ||
    blob.includes('motoniveladora') ||
    blob.includes('rolo compactador') ||
    blob.includes('maquina') ||
    blob.includes('máquina')
  ) {
    return 'Máquinas linha amarela';
  }

  if (linha.includes('amarela')) return 'Máquinas linha amarela';
  if (linha.includes('verde')) return 'Tratores linha verde';
  if (linha.includes('branca')) return 'Caminhão linha branca';

  return '';
}

export function segmentoOficinaValido(valor: string): valor is SegmentoOficina {
  return SEGMENTOS_OFICINA.includes(valor as SegmentoOficina);
}

/** Oficina legada sem segmentos continua elegível (compatibilidade). */
export function oficinaAtendeSegmento(
  segmentosAtuacao: string[],
  segmentoEquipamento: string,
): boolean {
  const alvo = norm(segmentoEquipamento);
  if (!alvo) return true;

  const cadastrados = segmentosAtuacao
    .map((item) => norm(item))
    .filter(Boolean);

  if (cadastrados.length === 0) return true;

  return cadastrados.includes(alvo);
}

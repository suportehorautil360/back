import {
  especialidadeCompativel,
  normEsp,
} from './norm-esp.helper';
import { linhaAtuacaoParaEspecialidade } from './especialidade-oficina.helper';
import {
  oficinaAtendeSegmento,
  type SegmentoOficina,
} from './segmento-equipamento.helper';

function norm(valor: string): string {
  return normEsp(valor).replace(/\s+/g, ' ').trim();
}

const LINHA_PARA_SEGMENTO: Record<string, SegmentoOficina> = {
  'linha leve': 'Carro leve',
  'linha branca': 'Caminhão linha branca',
  'linha amarela': 'Máquinas linha amarela',
  'linha verde': 'Tratores linha verde',
};

/** Segmentos cadastrados + inferidos pelas linhas de atuação marcadas. */
export function segmentosEfetivosOficina(
  segmentosAtuacao: string[],
  linhasAtuacao: string[],
): string[] {
  const cadastrados = segmentosAtuacao.filter(Boolean);
  const inferidos = linhasAtuacao
    .map((linha) => LINHA_PARA_SEGMENTO[norm(linha)] ?? '')
    .filter(Boolean);

  return [...new Set([...cadastrados, ...inferidos])];
}

/** Oficina atende a linha do equipamento (qualquer linha marcada no cadastro). */
export function oficinaAtendeLinha(
  linhasAtuacao: string[],
  especialidade: string,
  linhaEquipamento: string,
): boolean {
  const alvo = linhaEquipamento.trim();
  if (!alvo) return true;

  const linhas = linhasAtuacao.filter(Boolean);
  if (linhas.length > 0) {
    return linhas.some(
      (linha) =>
        especialidadeCompativel(linha, alvo) ||
        especialidadeCompativel(linhaAtuacaoParaEspecialidade(linha), alvo),
    );
  }

  return especialidadeCompativel(especialidade, alvo);
}

export function oficinaAtendeSegmentoEquipamento(
  segmentosAtuacao: string[],
  linhasAtuacao: string[],
  segmentoEquipamento: string,
): boolean {
  const segmentos = segmentosEfetivosOficina(segmentosAtuacao, linhasAtuacao);
  return oficinaAtendeSegmento(segmentos, segmentoEquipamento);
}

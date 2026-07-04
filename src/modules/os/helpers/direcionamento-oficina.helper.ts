import {
  especialidadeCompativel,
  normEsp,
} from './norm-esp.helper';
import { linhaAtuacaoParaEspecialidade } from './especialidade-oficina.helper';
import {
  oficinaAtendeSegmento,
  segmentoParaLinhaEquipamento,
  segmentosEfetivosCadastro,
} from './segmento-equipamento.helper';

function norm(valor: string): string {
  return normEsp(valor).replace(/\s+/g, ' ').trim();
}

/** Segmentos cadastrados; legado infere das linhas só se segmentos estiver vazio. */
export function segmentosEfetivosOficina(
  segmentosAtuacao: string[],
  linhasAtuacao: string[] = [],
): string[] {
  return segmentosEfetivosCadastro(segmentosAtuacao, linhasAtuacao);
}

/** Oficina atende a linha do equipamento via segmentos (ou linhas legadas). */
export function oficinaAtendeLinha(
  linhasAtuacao: string[],
  especialidade: string,
  linhaEquipamento: string,
  segmentosAtuacao: string[] = [],
): boolean {
  const alvo = linhaEquipamento.trim();
  if (!alvo) return true;

  const linhas = linhasAtuacao.filter(Boolean);
  const linhasEfetivas =
    linhas.length > 0
      ? linhas
      : segmentosAtuacao
          .map((segmento) => segmentoParaLinhaEquipamento(segmento))
          .filter(Boolean);

  if (linhasEfetivas.length > 0) {
    return linhasEfetivas.some(
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

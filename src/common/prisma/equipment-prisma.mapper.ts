import type { CreateEquipamentoDto } from '../../modules/equipamentos/dto/create-equipamento.dto';
import type { UpdateEquipamentoDto } from '../../modules/equipamentos/dto/update-equipamento.dto';
import { ehComboioTipo } from './equipment-api.mapper';

function parseDateOnly(value: string | undefined): Date | null {
  if (!value?.trim()) return null;
  const d = new Date(`${value.trim()}T12:00:00.000Z`);
  return Number.isFinite(d.getTime()) ? d : null;
}

function numOrNull(value: number | undefined): number | null {
  if (value === undefined || value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function mapCreateEquipamentoToPrisma(
  dto: CreateEquipamentoDto,
  companyId: string,
  id: string,
) {
  const isComboio = ehComboioTipo(dto.tipo);
  return {
    id,
    legacyId: id,
    companyId,
    descricao: dto.descricao.trim(),
    modelo: dto.modelo?.trim() || null,
    chassi: dto.chassis.trim(),
    placa: dto.placa?.trim() || null,
    tipo: dto.tipo.trim(),
    linha: dto.linha?.trim() || null,
    ano: dto.ano?.trim() || dto.anoFabricacao?.trim() || null,
    marca: dto.marca?.trim() || null,
    medicaoAtual: dto.medicaoAtual,
    intervaloRevisao: dto.intervaloRevisao,
    ultimaRevisao: dto.ultimaRevisao,
    unidadeRevisao: dto.unidadeRevisao,
    obra: dto.obra?.trim() || null,
    status: dto.status ?? 'ativo',
    combustivel: dto.combustivel?.trim() || null,
    cor: dto.cor?.trim() || null,
    renavam: dto.renavam?.trim() || null,
    numeroSerie: dto.numeroSerie?.trim() || null,
    tipoFrota: dto.tipoFrota?.trim() || null,
    vigenciaInicio: parseDateOnly(dto.vigenciaInicio),
    vigenciaFim: parseDateOnly(dto.vigenciaFim),
    inativarAposVigencia: dto.inativarAposVigencia ?? false,
    patrimonioBase: dto.patrimonioBase?.trim() || null,
    anoModelo: dto.anoModelo?.trim() || null,
    capacidadeTanque: numOrNull(dto.capacidadeTanque),
    capacidadeTanqueCaminhao: numOrNull(dto.capacidadeTanqueCaminhao),
    motorizacao: dto.motorizacao?.trim() || null,
    valorVeiculo:
      dto.valorVeiculo != null && Number.isFinite(Number(dto.valorVeiculo))
        ? Number(dto.valorVeiculo).toFixed(2)
        : null,
    gestorResponsavel: dto.gestorResponsavel?.trim() || null,
    centroCusto: dto.centroCusto?.trim() || null,
    cidade: dto.cidade?.trim() || null,
    estado: dto.estado?.trim() || null,
    regiao: dto.regiao?.trim() || null,
    ipva: parseDateOnly(dto.ipva),
    seguro: parseDateOnly(dto.seguro),
    licenciamento: parseDateOnly(dto.licenciamento),
    condutoresIds: dto.condutoresResponsaveis ?? [],
    volumeTanqueAtual: isComboio ? 0 : null,
  };
}

export function mapUpdateEquipamentoToPrisma(dto: UpdateEquipamentoDto) {
  const patch: Record<string, unknown> = {};

  if (dto.descricao !== undefined) patch.descricao = dto.descricao.trim();
  if (dto.modelo !== undefined) patch.modelo = dto.modelo?.trim() || null;
  if (dto.chassis !== undefined) patch.chassi = dto.chassis.trim();
  if (dto.placa !== undefined) patch.placa = dto.placa?.trim() || null;
  if (dto.tipo !== undefined) patch.tipo = dto.tipo.trim();
  if (dto.linha !== undefined) patch.linha = dto.linha?.trim() || null;
  if (dto.ano !== undefined) patch.ano = dto.ano?.trim() || null;
  if (dto.anoFabricacao !== undefined) {
    patch.ano = dto.anoFabricacao?.trim() || null;
  }
  if (dto.marca !== undefined) patch.marca = dto.marca?.trim() || null;
  if (dto.medicaoAtual !== undefined) patch.medicaoAtual = dto.medicaoAtual;
  if (dto.intervaloRevisao !== undefined) {
    patch.intervaloRevisao = dto.intervaloRevisao;
  }
  if (dto.ultimaRevisao !== undefined) patch.ultimaRevisao = dto.ultimaRevisao;
  if (dto.unidadeRevisao !== undefined) {
    patch.unidadeRevisao = dto.unidadeRevisao;
  }
  if (dto.obra !== undefined) patch.obra = dto.obra?.trim() || null;
  if (dto.status !== undefined) patch.status = dto.status;
  if (dto.combustivel !== undefined) {
    patch.combustivel = dto.combustivel?.trim() || null;
  }
  if (dto.cor !== undefined) patch.cor = dto.cor?.trim() || null;
  if (dto.renavam !== undefined) patch.renavam = dto.renavam?.trim() || null;
  if (dto.numeroSerie !== undefined) {
    patch.numeroSerie = dto.numeroSerie?.trim() || null;
  }
  if (dto.tipoFrota !== undefined) {
    patch.tipoFrota = dto.tipoFrota?.trim() || null;
  }
  if (dto.vigenciaInicio !== undefined) {
    patch.vigenciaInicio = parseDateOnly(dto.vigenciaInicio);
  }
  if (dto.vigenciaFim !== undefined) {
    patch.vigenciaFim = parseDateOnly(dto.vigenciaFim);
  }
  if (dto.inativarAposVigencia !== undefined) {
    patch.inativarAposVigencia = dto.inativarAposVigencia;
  }
  if (dto.patrimonioBase !== undefined) {
    patch.patrimonioBase = dto.patrimonioBase?.trim() || null;
  }
  if (dto.anoModelo !== undefined) {
    patch.anoModelo = dto.anoModelo?.trim() || null;
  }
  if (dto.capacidadeTanque !== undefined) {
    patch.capacidadeTanque = numOrNull(dto.capacidadeTanque);
  }
  if (dto.capacidadeTanqueCaminhao !== undefined) {
    patch.capacidadeTanqueCaminhao = numOrNull(dto.capacidadeTanqueCaminhao);
  }
  if (dto.motorizacao !== undefined) {
    patch.motorizacao = dto.motorizacao?.trim() || null;
  }
  if (dto.valorVeiculo !== undefined) {
    patch.valorVeiculo =
      dto.valorVeiculo != null && Number.isFinite(Number(dto.valorVeiculo))
        ? Number(dto.valorVeiculo).toFixed(2)
        : null;
  }
  if (dto.gestorResponsavel !== undefined) {
    patch.gestorResponsavel = dto.gestorResponsavel?.trim() || null;
  }
  if (dto.centroCusto !== undefined) {
    patch.centroCusto = dto.centroCusto?.trim() || null;
  }
  if (dto.cidade !== undefined) patch.cidade = dto.cidade?.trim() || null;
  if (dto.estado !== undefined) patch.estado = dto.estado?.trim() || null;
  if (dto.regiao !== undefined) patch.regiao = dto.regiao?.trim() || null;
  if (dto.ipva !== undefined) patch.ipva = parseDateOnly(dto.ipva);
  if (dto.seguro !== undefined) patch.seguro = parseDateOnly(dto.seguro);
  if (dto.licenciamento !== undefined) {
    patch.licenciamento = parseDateOnly(dto.licenciamento);
  }
  if (dto.condutoresResponsaveis !== undefined) {
    patch.condutoresIds = dto.condutoresResponsaveis;
  }

  return patch;
}

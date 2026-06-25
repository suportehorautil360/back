import type { SolicitacaoOsListItem } from '../os.types';



function texto(valor: unknown): string {

  return typeof valor === 'string' ? valor.trim() : '';

}



function numero(valor: unknown): number {

  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;

  if (typeof valor === 'string') {

    const n = Number(valor.replace(',', '.'));

    return Number.isFinite(n) ? n : 0;

  }

  return 0;

}



export function extractEquipamentoChassis(

  raw: Record<string, unknown> | undefined,

): string {

  if (!raw) return '';

  return (

    texto(raw.chassis) ||

    texto(raw.chassi) ||

    texto(raw.prefixo) ||

    texto(raw.placa) ||

    ''

  );

}



export function formatEquipamentoHorimetro(

  raw: Record<string, unknown>,

): string {

  const medicao = numero(raw.medicaoAtual);

  const unidade = texto(raw.unidadeRevisao) === 'h' ? 'h' : 'km';

  if (medicao <= 0) return '';

  return `${medicao.toLocaleString('pt-BR')} ${unidade}`;

}



export function extractEquipamentoMedicao(

  raw: Record<string, unknown> | undefined,

): Pick<

  SolicitacaoOsListItem,

  | 'horimetro'

  | 'hourMeter'

  | 'currentKm'

  | 'km'

  | 'medicaoAtual'

  | 'unidadeRevisao'

> {

  const empty = {

    horimetro: '',

    hourMeter: '',

    currentKm: '',

    km: '',

    medicaoAtual: null as number | null,

    unidadeRevisao: '' as SolicitacaoOsListItem['unidadeRevisao'],

  };



  if (!raw) return empty;



  const medicao = numero(raw.medicaoAtual);

  if (medicao <= 0) return empty;



  const unidade: 'km' | 'h' =

    texto(raw.unidadeRevisao) === 'h' ? 'h' : 'km';

  const horimetro = formatEquipamentoHorimetro(raw);

  const valorStr = String(medicao).replace('.', ',');



  return {

    horimetro,

    hourMeter: unidade === 'h' ? valorStr : '',

    currentKm: unidade === 'km' ? valorStr : '',

    km: unidade === 'km' ? valorStr : '',

    medicaoAtual: medicao,

    unidadeRevisao: unidade,

  };

}



export function parseHorimetroMedicaoFields(

  horimetro: string,

): Pick<

  SolicitacaoOsListItem,

  'hourMeter' | 'currentKm' | 'km' | 'unidadeRevisao'

> {

  const trimmed = horimetro.trim();

  if (!trimmed) {

    return {

      hourMeter: '',

      currentKm: '',

      km: '',

      unidadeRevisao: '',

    };

  }



  const horasMatch = trimmed.match(/^(.+?)\s*h$/i);

  if (horasMatch) {

    return {

      hourMeter: horasMatch[1].trim(),

      currentKm: '',

      km: '',

      unidadeRevisao: 'h',

    };

  }



  const kmMatch = trimmed.match(/^(.+?)\s*km$/i);

  if (kmMatch) {

    const valor = kmMatch[1].trim();

    return {

      hourMeter: '',

      currentKm: valor,

      km: valor,

      unidadeRevisao: 'km',

    };

  }



  return {

    hourMeter: trimmed,

    currentKm: '',

    km: '',

    unidadeRevisao: '',

  };

}



export function enrichSolicitacoesWithEquipamento(

  items: SolicitacaoOsListItem[],

  equipmentMap: Map<string, Record<string, unknown>>,

): SolicitacaoOsListItem[] {

  return items.map((item) => {

    const equipmentId = item.equipmentId || item.equipamentoId;

    if (!equipmentId) return item;



    const equipamento =

      equipmentMap.get(equipmentId) ??

      equipmentMap.get(item.equipamentoId) ??

      equipmentMap.get(item.equipmentId);



    if (!equipamento) return item;



    const chassis = extractEquipamentoChassis(equipamento);

    const medicao = extractEquipamentoMedicao(equipamento);



    return {

      ...item,

      ...(chassis ? { chassis, chassi: chassis } : {}),

      horimetro: medicao.horimetro || item.horimetro,

      hourMeter: medicao.hourMeter || item.hourMeter,

      currentKm: medicao.currentKm || item.currentKm,

      km: medicao.km || item.km,

      medicaoAtual: medicao.medicaoAtual ?? item.medicaoAtual,

      unidadeRevisao: medicao.unidadeRevisao || item.unidadeRevisao,

    };

  });

}



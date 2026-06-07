export const GREASED_POINT_OPTIONS = [
  'boomPins',
  'bucket',
  'articulation',
  'axles',
  'driveshaft',
  'bearings',
] as const;

export type GreasedPoint = (typeof GREASED_POINT_OPTIONS)[number];

export const READING_UNIT_OPTIONS = ['h', 'km'] as const;

export type ReadingUnit = (typeof READING_UNIT_OPTIONS)[number];

export interface LubrificacaoDoc {
  id: string;
  prefeituraId: string;
  equipmentId: string;
  plateOrChassis: string;
  comboistaNome: string;
  tipo: 'lubrificacao';
  reading: number;
  readingUnit: ReadingUnit;
  greasedPoints: GreasedPoint[];
  observation?: string;
  latitude: number;
  longitude: number;
  createdAt: string;
}

export interface LubrificacaoListItem {
  id: string;
  dateTime: string;
  vehicle: {
    name: string;
    plate: string;
    type: string;
  };
  comboistaNome: string;
  reading: string;
  greasedPoints: GreasedPoint[];
  observation: string | null;
  local: string | null;
  createdAt: string;
}

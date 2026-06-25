import { BadRequestException } from '@nestjs/common';
import type { OrcamentoItemDto } from '../dto/create-orcamento.dto';

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function numero(valor: unknown): number | undefined {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  if (typeof valor === 'string' && valor.trim()) {
    const parsed = Number(valor.replace(',', '.'));
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function assignOptionalNumber(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
) {
  const parsed = numero(value);
  if (parsed !== undefined) {
    target[key] = parsed;
  }
}

export function mapDtoItemsToFirestore(
  items: OrcamentoItemDto[],
): Record<string, unknown>[] {
  return items.map((item) => {
    const descricao = item.description.trim();
    const valor = item.value;
    const record: Record<string, unknown> = {
      descricao,
      valor,
      description: descricao,
      value: valor,
    };

    const category = texto(item.category);
    if (category) record.category = category;

    const code = texto(item.code);
    if (code) record.code = code;

    const brand = texto(item.brand);
    if (brand) record.brand = brand;

    assignOptionalNumber(record, 'quantity', item.quantity);
    assignOptionalNumber(record, 'unitValue', item.unitValue);

    const hourType = texto(item.hourType);
    if (hourType) record.hourType = hourType;

    assignOptionalNumber(record, 'hours', item.hours);
    assignOptionalNumber(record, 'hourlyRate', item.hourlyRate);
    assignOptionalNumber(record, 'km', item.km);
    assignOptionalNumber(record, 'valuePerKm', item.valuePerKm);
    assignOptionalNumber(record, 'travelHours', item.travelHours);
    assignOptionalNumber(record, 'travelHourlyRate', item.travelHourlyRate);
    assignOptionalNumber(record, 'fees', item.fees);

    return record;
  });
}

export function parseOrcamentoItemsFromDto(items: OrcamentoItemDto[]): {
  itens: Record<string, unknown>[];
  valorTotal: number;
} {
  const itens = mapDtoItemsToFirestore(items);

  if (itens.some((item) => !texto(item.descricao))) {
    throw new BadRequestException('Cada item deve ter descrição.');
  }

  const valorTotal = itens.reduce(
    (acc, item) => acc + (numero(item.valor) ?? 0),
    0,
  );

  if (valorTotal <= 0) {
    throw new BadRequestException(
      'O valor total do orçamento deve ser maior que zero.',
    );
  }

  return { itens, valorTotal };
}

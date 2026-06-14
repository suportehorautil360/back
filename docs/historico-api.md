# API — Histórico de Movimentações

Timeline unificada para o portal prefeitura: **abastecimentos**, **lubrificações (engraxe)** e **reabastecimentos do comboio**.

**Base URL (local):** `http://localhost:3000`  
**Swagger:** tag `historico` em `/api/docs`

---

## Endpoint

```
GET /historico/{prefeituraId}?limit=50
```

| Param (path) | Obrigatório | Descrição |
|--------------|-------------|-----------|
| `prefeituraId` | Sim | ID da prefeitura logada |

| Param (query) | Obrigatório | Padrão | Máx. | Descrição |
|---------------|-------------|--------|------|-----------|
| `limit` | Não | `50` | `200` | Quantidade máxima de itens na timeline (após merge e ordenação) |

**Envelope:** não usa `{ data, message }` no topo — a resposta é plana com `summary`, `groups` e `message`.

---

## Resposta completa

```json
{
  "summary": {
    "totalLitersToday": 2840,
    "totalAbastecimentosToday": 11,
    "totalEngraxeToday": 4
  },
  "groups": [
    {
      "dateLabel": "HOJE · 03 JUN",
      "items": [
        {
          "id": "uuid-abast",
          "tipo": "abastecimento",
          "plate": "ABC-1234",
          "equipmentLabel": "Escavadeira · 4.812 h",
          "rightLabel": "320 L",
          "time": "14:20",
          "createdAt": "2026-06-03T14:20:00.000Z"
        },
        {
          "id": "uuid-lub",
          "tipo": "lubrificacao",
          "plate": "9BWZZZ377",
          "equipmentLabel": "Pá carregadeira · 4 pontos",
          "rightLabel": "engraxe",
          "time": "13:55",
          "createdAt": "2026-06-03T13:55:00.000Z"
        },
        {
          "id": "uuid-rea",
          "tipo": "reabastecimento",
          "plate": "Posto",
          "equipmentLabel": "Reabastecimento do comboio",
          "rightLabel": "500 L",
          "time": "08:10",
          "createdAt": "2026-06-03T08:10:00.000Z"
        }
      ]
    },
    {
      "dateLabel": "ONTEM · 02 JUN",
      "items": []
    }
  ],
  "message": "Histórico carregado com sucesso!"
}
```

---

## Cards de resumo (`summary`)

Calculados com base no **dia atual (UTC ISO date prefix)**:

| Campo | Origem | Uso na UI |
|-------|--------|-----------|
| `totalLitersToday` | Soma de `liters` dos **abastecimentos** de hoje | Card “Litros hoje” |
| `totalAbastecimentosToday` | Contagem de abastecimentos de hoje | Card “Abastecimentos hoje” |
| `totalEngraxeToday` | Contagem de **lubrificações** de hoje | Card “Engraxes hoje” |

Reabastecimentos **não entram** nos totais do `summary`.

---

## Grupos por data (`groups[]`)

| Campo | Descrição |
|-------|-----------|
| `dateLabel` | Rótulo pronto para exibir: `HOJE · 03 JUN`, `ONTEM · 02 JUN` ou `01 JUN` |
| `items` | Lista de movimentações daquele dia, já ordenadas por hora (mais recente primeiro dentro do merge global) |

Ordem dos grupos: mesma ordem de aparição na timeline (primeiro grupo = dia mais recente com itens).

---

## Item da timeline (`groups[].items[]`)

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | string | ID do documento na coleção de origem |
| `tipo` | `"abastecimento"` \| `"lubrificacao"` \| `"reabastecimento"` | Define ícone/cor no front |
| `plate` | string | Placa/chassi (abast/lub) ou origem textual (reabast.) |
| `equipmentLabel` | string | Subtítulo formatado pelo back |
| `rightLabel` | string | Destaque à direita (`320 L`, `engraxe`, etc.) |
| `time` | string | Hora `HH:mm` |
| `createdAt` | string | ISO 8601 — ordenação e filtros futuros |

### Por tipo

#### `abastecimento`

- `plate`: placa/chassi do equipamento (Firestore `equipamentos` ou `plateOrChassis` do doc)
- `equipmentLabel`: `{descricao} · {leitura}` — ex.: `Escavadeira · 4.812 h`
- `rightLabel`: `{liters} L`

#### `lubrificacao`

- `equipmentLabel`: `{descricao} · {N} ponto(s)` — pontos engraxados (`greasedPoints`)
- `rightLabel`: sempre `"engraxe"`

#### `reabastecimento`

- `plate`: rótulo da origem (`Posto`, `Tanque fazenda`, `Distribuidora`)
- `equipmentLabel`: `"Reabastecimento do comboio"`
- `rightLabel`: `{receivedLiters} L`

---

## Coleções Firestore consultadas

| Coleção | Filtro | Ordenação |
|---------|--------|-----------|
| `abastecimentos` | `prefeituraId ==` | `createdAt` desc (em memória) |
| `lubrificacoes` | `prefeituraId ==` | `createdAt` desc (em memória) |
| `reabastecimentos` | `prefeituraId ==` | `createdAt` desc (em memória) |

Equipamentos são resolvidos em lote via `equipamentos` (`fetchEquipmentMap`) para montar placa e descrição.

---

## Implementação técnica (back)

- **Helper:** `fetchPrefeituraDocs` (`shared/prefeitura-query.helper.ts`) — busca só por `prefeituraId` e ordena/filtra em memória, **evitando índice composto** Firestore (`prefeituraId` + `createdAt`).
- **Merge:** até `limit` registros de cada coleção → unifica → ordena globalmente → `slice(0, limit)`.
- **Agrupamento:** `groupByDate` usa `buildDateLabel` com regras HOJE / ONTEM / data.

Arquivos:

- `src/modules/movimentacoes/historico/historico.controller.ts`
- `src/modules/movimentacoes/historico/historico.service.ts`
- `src/modules/movimentacoes/historico/historico.types.ts`

---

## Integração front (checklist)

- [ ] `GET /historico/{prefeituraId}?limit=50` ao abrir a tela
- [ ] Renderizar 3 cards com `summary`
- [ ] Iterar `groups` → cabeçalho `dateLabel` + lista `items`
- [ ] Badge/ícone por `tipo`
- [ ] Coluna direita: `rightLabel`; hora: `time`; placa em destaque: `plate`
- [ ] Não confundir com `GET /abastecimentos` (listagem tabular com filtros de período) nem `historicoAbastecimentos` de consumo-custo (por veículo)

---

## Erros

| Status | Situação |
|--------|----------|
| `500` | Falha ao ler Firestore ou montar timeline |
| `200` + `groups: []` | Prefeitura sem movimentações (summary zerado) |

# API — Módulo Movimentações

Documentação das rotas do módulo **movimentacoes** (combustível, engraxe, postos, histórico e consumo).

**Base URL (local):** `http://localhost:3000`  
**Swagger:** `http://localhost:3000/api/docs`

---

## Padrão de resposta

A maioria dos endpoints retorna:

```json
{
  "data": { ... },
  "message": "Mensagem de sucesso"
}
```

| Status | Quando |
|--------|--------|
| `201` | POST de criação |
| `200` | GET de listagem |
| `400` | Validação / regra de negócio |
| `404` | Equipamento ou recurso não encontrado |
| `500` | Erro interno |

**Tenant:** quase todas as rotas usam `prefeituraId` para filtrar dados da prefeitura.

**Filtro de período (query):** `startDate` e `endDate` aceitam `YYYY-MM-DD` ou ISO 8601.

---

## Resumo das rotas

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/abastecimentos` | Registrar abastecimento de equipamento |
| GET | `/abastecimentos/:prefeituraId` | Listar abastecimentos |
| POST | `/lubrificacoes` | Registrar lubrificação (engraxe) |
| GET | `/lubrificacoes/:prefeituraId` | Listar lubrificações |
| POST | `/reabastecimentos` | Registrar reabastecimento do comboio |
| GET | `/reabastecimentos/:prefeituraId` | Listar reabastecimentos |
| POST | `/postos` | Cadastrar posto ou oficina parceira |
| GET | `/postos/:prefeituraId` | Listar postos credenciados |
| GET | `/historico/:prefeituraId` | Timeline unificada (abastec. + lubrif. + reabast.) |
| GET | `/movimentacoes/:prefeituraId` | Listagem de abastecimentos (alias) |
| GET | `/movimentacoes/consumo-custo/:prefeituraId` | Tela Consumo & Custo por Veículo |

---

## 1. Abastecimentos

Abastecimento de **equipamento/veículo** (comboio ou posto). Base para consumo e custo.

### POST `/abastecimentos`

**Body (JSON):**

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `prefeituraId` | string | sim | ID da prefeitura |
| `plateOrChassis` | string | sim | Placa ou chassi do equipamento |
| `liters` | number | sim | Litros abastecidos (> 0) |
| `measurementType` | string | sim | `horimetro` ou `hodometro` |
| `currentReading` | number | sim | Leitura atual do medidor (≥ 0) |
| `latitude` | number | sim | GPS |
| `longitude` | number | sim | GPS |
| `meterPhoto` | string | não | URL/foto do medidor |
| `pricePerLiter` | number | não | Preço por litro (R$) |
| `total` | number | não | Valor total (R$) |
| `postoId` | string | não | ID do posto credenciado |

**Exemplo:**

```json
{
  "prefeituraId": "pref-001",
  "plateOrChassis": "ABC-1234",
  "liters": 85,
  "measurementType": "hodometro",
  "currentReading": 82400,
  "pricePerLiter": 6.12,
  "postoId": "uuid-posto",
  "latitude": -22.9,
  "longitude": -47.06
}
```

**Resposta (`201`):** `{ data: AbastecimentoDoc, message: "Abastecimento criado com sucesso!" }`

---

### GET `/abastecimentos/:prefeituraId`

**Query params:** `startDate`, `endDate` (opcionais)

**Resposta (`200`):**

```json
{
  "data": [
    {
      "id": "uuid",
      "dateTime": "04/06, 10:20",
      "vehicle": { "name": "...", "plate": "...", "type": "..." },
      "origin": "Comboio",
      "liters": 85,
      "pricePerLiter": 6.12,
      "value": 520.2,
      "reading": "82.400 km",
      "currentReading": 82400,
      "measurementType": "hodometro",
      "postoId": "uuid-posto",
      "meterPhoto": null,
      "local": "Rodovia ...",
      "createdAt": "2026-06-04T10:20:00.000Z"
    }
  ],
  "message": "Abastecimentos buscados com sucesso!"
}
```

---

## 2. Lubrificações

Registro de **engraxe** em equipamentos.

### POST `/lubrificacoes`

**Body (JSON):**

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `prefeituraId` | string | sim | ID da prefeitura |
| `plateOrChassis` | string | sim | Placa ou chassi |
| `comboistaNome` | string | sim | Nome do comboista |
| `reading` | number | sim | Horímetro ou km (≥ 0) |
| `readingUnit` | string | sim | `h` ou `km` |
| `greasedPoints` | string[] | sim | Pontos engraxados (mín. 1) |
| `latitude` | number | sim | GPS |
| `longitude` | number | sim | GPS |
| `observation` | string | não | Observação |

**Valores de `greasedPoints`:**  
`boomPins`, `bucket`, `articulation`, `axles`, `driveshaft`, `bearings`

**Exemplo:**

```json
{
  "prefeituraId": "pref-001",
  "plateOrChassis": "CAT-001",
  "comboistaNome": "João da Silva",
  "reading": 1840,
  "readingUnit": "h",
  "greasedPoints": ["boomPins", "bucket"],
  "latitude": -22.9,
  "longitude": -47.06
}
```

**Resposta (`201`):** `{ data: LubrificacaoDoc, message: "Lubrificação criada com sucesso!" }`

---

### GET `/lubrificacoes/:prefeituraId`

**Query params:** `startDate`, `endDate` (opcionais)

**Resposta (`200`):**

```json
{
  "data": [
    {
      "id": "uuid",
      "dateTime": "04/06, 10:20",
      "vehicle": { "name": "...", "plate": "...", "type": "..." },
      "comboistaNome": "João da Silva",
      "reading": "1.840 h",
      "greasedPoints": ["boomPins", "bucket"],
      "observation": null,
      "local": "Talhão 14",
      "createdAt": "2026-06-04T10:20:00.000Z"
    }
  ],
  "message": "Lubrificações buscadas com sucesso!"
}
```

---

## 3. Reabastecimentos

Recarga do **comboio/tanque** (posto, tanque da fazenda ou distribuidora). Não é abastecimento de veículo.

### POST `/reabastecimentos`

**Body (JSON):**

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `prefeituraId` | string | sim | ID da prefeitura |
| `sourceType` | string | sim | `gasStation`, `farmTank` ou `distributor` |
| `receivedLiters` | number | sim | Litros recebidos (> 0) |
| `invoiceNumber` | string | não | Número da NF |
| `clientRequestId` | string | não | Idempotência (sync offline) |

**Resposta (`201`):** `{ data: ReabastecimentoDoc, message: "Reabastecimento criado com sucesso!" }`

---

### GET `/reabastecimentos/:prefeituraId`

**Query params:** `startDate`, `endDate` (opcionais)

**Resposta (`200`):**

```json
{
  "data": [
    {
      "id": "uuid",
      "dateTime": "04/06, 10:20",
      "sourceType": "farmTank",
      "receivedLiters": 320,
      "invoiceNumber": "NF 0455123",
      "createdAt": "2026-06-04T10:20:00.000Z"
    }
  ],
  "message": "Reabastecimentos buscados com sucesso!"
}
```

---

## 4. Postos

Cadastro de **postos e oficinas** credenciados.

### POST `/postos`

**Body (JSON):**

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `prefeituraId` | string | sim | ID da prefeitura |
| `tipoParceiro` | string | sim | `posto` ou `oficina` |
| `cnpj` | string | sim | CNPJ |
| `telefonePrincipal` | string | sim | Telefone |
| `razaoSocial` | string | sim | Razão social |
| `nomeFantasia` | string | sim | Nome fantasia |
| `emailComercial` | string | sim | E-mail |
| `cidadeUf` | string | sim | Ex.: `Campinas/SP` |
| `endereco` | string | sim | Endereço completo |

**Resposta (`201`):** `{ data: PostoDoc, message: "Posto cadastrado com sucesso!" }`  
Campos gerados: `id`, `createdAt`.

---

### GET `/postos/:prefeituraId`

**Query params:** `startDate`, `endDate` (opcionais — filtram métricas de abastecimento vinculados)

**Resposta (`200`):** lista apenas parceiros `tipoParceiro: posto`.

```json
{
  "data": [
    {
      "id": "uuid",
      "code": "P1",
      "name": "Posto Trevo BR-153",
      "endereco": "Rod. BR-153, km 42",
      "precoPorLitro": 6.12,
      "precoPorLitroLabel": "R$ 6,12",
      "abastecimentos": 3,
      "totalLitros": 140,
      "totalLitrosLabel": "140 L",
      "totalGasto": 856.8,
      "totalGastoLabel": "R$ 856,80",
      "razaoSocial": "...",
      "cnpj": "...",
      "telefonePrincipal": "...",
      "emailComercial": "...",
      "cidadeUf": "Campinas/SP",
      "tipoParceiro": "posto",
      "createdAt": "2026-06-01T10:00:00.000Z"
    }
  ],
  "message": "Postos buscados com sucesso!"
}
```

> Métricas de abastecimento exigem abastecimentos com `postoId` vinculado.

---

## 5. Histórico

Timeline **unificada**: abastecimentos + lubrificações + reabastecimentos.

### GET `/historico/:prefeituraId`

**Query params:**

| Param | Tipo | Padrão | Descrição |
|-------|------|--------|-----------|
| `limit` | number | 50 | Máximo de registros (máx. 200) |

**Resposta (`200`):**

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
          "id": "uuid",
          "tipo": "abastecimento",
          "plate": "ABC-1234",
          "equipmentLabel": "Escavadeira · 4.812 h",
          "rightLabel": "320 L",
          "time": "14:20",
          "createdAt": "2026-06-03T14:20:00.000Z"
        }
      ]
    }
  ],
  "message": "Histórico carregado com sucesso!"
}
```

**Tipos de item:** `abastecimento`, `lubrificacao`, `reabastecimento`

---

## 6. Movimentações (alias)

### GET `/movimentacoes/:prefeituraId`

**Query params:** `startDate`, `endDate` (opcionais)

Retorna a **mesma estrutura** do GET `/abastecimentos/:prefeituraId` (listagem de abastecimentos).

---

## 7. Consumo & Custo por Veículo

Tela agregada. **Base:** abastecimentos (não reabastecimentos).

### GET `/movimentacoes/consumo-custo/:prefeituraId`

**Query params:** `startDate`, `endDate` (opcionais, formato `YYYY-MM-DD`)

**Fórmulas:**
- Consumo = litros do abastecimento ÷ (leitura atual − leitura anterior)
- Custo = valor do abastecimento ÷ distância/horas (quando há `total` ou `pricePerLiter`)

**Resposta (`200`):**

```json
{
  "data": {
    "titulo": "Consumo & Custo por Veículo",
    "periodo": {
      "label": "27/05/2026 — 03/06/2026",
      "startDate": "2026-05-27",
      "endDate": "2026-06-03"
    },
    "calculo": {
      "titulo": "Como o consumo e o custo são calculados",
      "formulaConsumo": "Consumo = litros do abastecimento ÷ (leitura atual − leitura anterior)",
      "formulaCusto": "Quando o abastecimento tem valor (R$), o sistema calcula também o custo por km ou hora rodada.",
      "observacao": "Válido para carros, caminhões e máquinas pesadas."
    },
    "veiculos": [
      {
        "equipmentId": "eq-001",
        "nome": "Escavadeira CAT 320",
        "placa": "ABC-1234",
        "tipo": "Máquina",
        "setor": "Talhão Norte",
        "subtitulo": "ABC-1234 · Máquina · Talhão Norte",
        "measurementType": "horimetro",
        "unidadeMedicao": "h",
        "temCusto": false,
        "consumoMedio": {
          "rotulo": "MÉDIO L/H",
          "valor": 3.43,
          "valorExibicao": "3,43 L/h"
        },
        "custoMedio": {
          "rotulo": "CUSTO /H",
          "valor": null,
          "valorExibicao": "—"
        },
        "totalDestaque": {
          "tipo": "litros",
          "rotulo": "LITROS TOTAL",
          "valor": 900,
          "valorExibicao": "900 L"
        },
        "totais": {
          "litros": 900,
          "litrosExibicao": "900 L",
          "gasto": 0,
          "gastoExibicao": "R$ 0,00"
        },
        "historicoIntervalos": [
          {
            "periodoLabel": "28/05, 08:10 → 30/05, 07:50",
            "distanciaLabel": "78 h",
            "consumoLabel": "3,59 L/h",
            "custoLabel": "—"
          }
        ]
      }
    ]
  },
  "message": "Consumo e custo buscados com sucesso!"
}
```

**Regras:**
- `measurementType` na resposta: `horimetro` ou `odometro`
- `totalDestaque.tipo`: `litros` (sem custo) ou `gasto` (com valor R$)
- Intervalos exigem **2+ abastecimentos** consecutivos com leitura crescente
- Custo exige `pricePerLiter` ou `total` no abastecimento

---

## Coleções Firestore

| Coleção | Uso |
|---------|-----|
| `abastecimentos` | Abastecimento de equipamentos |
| `lubrificacoes` | Engraxe |
| `reabastecimentos` | Carga do comboio |
| `postos` | Postos e oficinas credenciados |
| `equipamentos` | Join para nome, placa, tipo, obra |

---

## Mapa rápido — qual rota usar?

| Tela / funcionalidade | Rota |
|----------------------|------|
| Registrar abastecimento no app | POST `/abastecimentos` |
| Lista de abastecimentos | GET `/abastecimentos/:prefeituraId` |
| Registrar engraxe | POST `/lubrificacoes` |
| Recarregar comboio | POST `/reabastecimentos` |
| Cadastrar posto parceiro | POST `/postos` |
| Tabela de postos credenciados | GET `/postos/:prefeituraId` |
| Feed / timeline do dia | GET `/historico/:prefeituraId` |
| Consumo & Custo por Veículo | GET `/movimentacoes/consumo-custo/:prefeituraId` |

# Handoff Front — Criar e listar Solicitação de O.S.

Documento para integração do portal com o backend NestJS (módulo `os`).

**Base URL (dev):** `http://localhost:3000`  
**Swagger:** `http://localhost:3000/api/docs` (tag `os`)

---

## 1. Criar solicitação (salvar)

### `POST /os/solicitacoes`

Cria um documento na coleção Firestore `solicitacoesOS`, gera protocolo, sorteia até **3 oficinas ativas** e define status inicial `aguardando_orcamento`.

### Headers

```
Content-Type: application/json
```

### Body (JSON)

| Campo | Obrigatório | Tipo | Descrição |
|-------|-------------|------|-----------|
| `prefeituraId` | sim | string | ID da prefeitura |
| `equipmentId` | sim | string | ID do equipamento — aceita o campo `id` do doc ou o **document ID** do Firestore |
| `operator` | sim | string | Nome do operador / solicitante |
| `report` | sim | string | Relato do problema / defeito |
| `serviceType` | não | string | Tipo de manutenção. Ver tabela abaixo. **Default:** `corrective` |
| `scheduledDate` | não | string | Data agendada no formato `YYYY-MM-DD` (ex.: preventiva) |
| `type` | não | string | **Depreciado.** Use `serviceType`. Ainda aceita `C` / `P` |

#### `serviceType` — valores aceitos

| Valor na API | Significado | Gravado em `tipoOs` (legado) |
|--------------|-------------|------------------------------|
| `corrective` | Corretiva (quebra / reparo) | `C` |
| `preventive` | Preventiva (agendada) | `P` |

Também aceitos na normalização: `C`, `P`, `corretiva`, `preventiva` (case insensitive).

### Exemplo — corretiva (caso mais comum)

```http
POST /os/solicitacoes
Content-Type: application/json

{
  "prefeituraId": "pref-abc-123",
  "equipmentId": "equip-uuid-ou-doc-id",
  "operator": "João Silva",
  "report": "Vazamento na caixa hidráulica",
  "serviceType": "corrective"
}
```

### Exemplo — preventiva com data

```json
{
  "prefeituraId": "pref-abc-123",
  "equipmentId": "equip-uuid-ou-doc-id",
  "operator": "Maria Souza",
  "report": "Revisão programada 500h",
  "serviceType": "preventive",
  "scheduledDate": "2026-06-14"
}
```

### Resposta `201 Created`

```json
{
  "data": {
    "id": "firestore-doc-id",
    "protocol": "OS-2026-001",
    "serviceType": "corrective",
    "serviceTypeLabel": "Corretiva",
    "invitedWorkshops": [
      { "id": "oficina-doc-id-1", "name": "Oficina Alpha" },
      { "id": "oficina-doc-id-2", "name": "Oficina Beta" },
      { "id": "oficina-doc-id-3", "name": "Oficina Gama" }
    ],
    "status": "aguardando_orcamento"
  },
  "message": "Service order request created successfully."
}
```

### Erros comuns

| HTTP | Quando |
|------|--------|
| `400` | Body inválido, equipamento sem `linha`/`tipo`, ou equipamento de outra prefeitura |
| `404` | `equipmentId` não encontrado em `equipamentos` |
| `422` | Nenhuma oficina ativa para a prefeitura |
| `500` | Erro interno ao gravar |

---

## 2. O que o back grava no Firestore

Coleção: **`solicitacoesOS`**

| Campo Firestore | Origem | Observação |
|-----------------|--------|------------|
| `protocolo` | back | Formato `OS-{ano}-{seq}` (ex.: `OS-2026-001`) |
| `prefeituraId` | body | |
| `equipamentoId` | back | Resolvido a partir de `equipmentId` |
| `equipamento` | back | Nome montado do doc do equipamento |
| `linha` | back | `equipamento.linha` ou `equipamento.tipo` |
| `operador` | body `operator` | |
| `horimetro` | back | Ex.: `"1.250 h"` — se `medicaoAtual` > 0 |
| `relato` | body `report` | |
| `oficinas` | back | Nomes das oficinas convidadas |
| `oficinasIds` | back | **Document IDs** das oficinas — crítico para tela da oficina |
| `oficinasResponderam` | back | `[]` na criação |
| `status` | back | Sempre `aguardando_orcamento` na criação |
| `serviceType` | body | `corrective` \| `preventive` |
| `tipoOs` | back | Legado `C` \| `P` (compatível com formulário antigo) |
| `dataAgendamento` | body `scheduledDate` | Só se enviado |
| `criadoEm` | back | `serverTimestamp()` |

> **Importante:** `oficinasIds` deve conter os **IDs reais** dos documentos em `oficinas`. A tela da oficina filtra por esse campo.

---

## 3. Regra das 3 oficinas (automática no POST)

1. Busca oficinas com `prefeituraId` igual e `status` começando com `"Ativ"` (ex.: `"Ativa"`).
2. Filtra por especialidade compatível com a **linha** do equipamento (match flexível por `includes`).
3. Se nenhuma bater → usa **todas** as oficinas ativas (fallback).
4. Embaralha o pool e pega até **3**.

O front **não precisa** sortear oficinas se usar este endpoint.

---

## 4. Listar solicitações

### `GET /os/solicitacoes/:prefeituraId`

Query params opcionais:

| Param | Valores | Descrição |
|-------|---------|-----------|
| `status` | `aguardando_orcamento`, `aguardando_aprovacao`, `aprovado`, `concluido`, `todos` | Filtro por status |
| `startDate` | `YYYY-MM-DD` | Data inicial (inclusiva) |
| `endDate` | `YYYY-MM-DD` | Data final (inclusiva) |

### Exemplo

```http
GET /os/solicitacoes/pref-abc-123?status=aguardando_orcamento&startDate=2026-06-01
```

### Resposta `200`

```json
{
  "data": [
    {
      "id": "doc-id",
      "protocol": "OS-2026-001",
      "equipment": "Retroescavadeira CAT 416",
      "line": "Pesados",
      "operator": "João Silva",
      "report": "Vazamento na caixa hidráulica",
      "workshops": ["Oficina Alpha", "Oficina Beta"],
      "workshopIds": ["id1", "id2"],
      "status": "aguardando_orcamento",
      "statusLabel": "Aguard. Orçamento",
      "serviceType": "corrective",
      "serviceTypeLabel": "Corretiva",
      "dateLabel": "05/06/2026",
      "createdAt": "2026-06-05T14:30:00.000Z",
      "protocolo": "OS-2026-001",
      "equipamento": "Retroescavadeira CAT 416",
      "linha": "Pesados",
      "operador": "João Silva",
      "relato": "Vazamento na caixa hidráulica",
      "oficinas": ["Oficina Alpha", "Oficina Beta"],
      "oficinasIds": ["id1", "id2"],
      "criadoEm": { "seconds": 1749136200 }
    }
  ],
  "message": "Service order requests loaded successfully."
}
```

Campos em inglês (`protocol`, `equipment`, …) são o contrato preferido. Campos em português (`protocolo`, `equipamento`, …) existem para compatibilidade com telas legadas.

Documentos antigos só com `tipoOs: "C"` / `"P"` são lidos normalmente; o back deriva `serviceType` na listagem.

---

## 5. Exemplo TypeScript (front)

```ts
const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export type OsServiceType = 'corrective' | 'preventive';

export interface CriarSolicitacaoOsInput {
  prefeituraId: string;
  equipmentId: string;
  operator: string;
  report: string;
  serviceType?: OsServiceType;
  scheduledDate?: string;
}

export async function criarSolicitacaoOsViaApi(input: CriarSolicitacaoOsInput) {
  const res = await fetch(`${API_BASE}/os/solicitacoes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prefeituraId: input.prefeituraId,
      equipmentId: input.equipmentId,
      operator: input.operator,
      report: input.report,
      serviceType: input.serviceType ?? 'corrective',
      ...(input.scheduledDate ? { scheduledDate: input.scheduledDate } : {}),
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message ?? `Erro ${res.status} ao criar O.S.`);
  }

  return res.json() as Promise<{
    data: {
      id: string;
      protocol: string;
      serviceType: OsServiceType;
      serviceTypeLabel: string;
      invitedWorkshops: { id: string; name: string }[];
      status: string;
    };
    message: string;
  }>;
}
```

### Mapeamento formulário → API

| Campo no formulário (PT) | Campo na API |
|--------------------------|--------------|
| Prefeitura | `prefeituraId` |
| Equipamento (id) | `equipmentId` |
| Operador | `operator` |
| Relato | `report` |
| Tipo O.S. Corretiva | `serviceType: "corrective"` |
| Tipo O.S. Preventiva | `serviceType: "preventive"` |
| Data agendamento | `scheduledDate` |

---

## 6. Migração do Firestore direto → API

Se hoje o front grava direto em `solicitacoesOS`:

| Antes (Firestore direto) | Com API |
|--------------------------|---------|
| Front sorteia oficinas | Back sorteia automaticamente |
| Front gera protocolo | Back gera `OS-{ano}-{seq}` |
| `tipoOs: "C"` | Enviar `serviceType: "corrective"` (back grava os dois) |
| `equipmentId` no doc | Enviar `equipmentId` no body; back grava `equipamentoId` |

**Recomendação:** passar a usar `POST /os/solicitacoes` para centralizar regras de negócio e evitar divergência de protocolo / oficinas.

---

## 7. Status do fluxo (referência)

| `status` | Label na listagem |
|----------|-------------------|
| `aguardando_orcamento` | Aguard. Orçamento |
| `aguardando_aprovacao` | Aguard. Aprovação |
| `aprovado` | Aprovado |
| `concluido` | Concluído |

Endpoints de orçamento, aprovação e devolução ainda **não** estão nesta fase — apenas criar e listar.

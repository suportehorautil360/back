# API — Ordens de Serviço (solicitacoesOS)

Fase 1: criação da solicitação com sorteio de até 3 oficinas e listagem por prefeitura.

**Base URL (local):** `http://localhost:3000`  
**Swagger:** tag `os` em `/api/docs`

Documentação relacionada: [movimentacoes-api.md](./movimentacoes-api.md)

---

## POST `/os/solicitacoes`

Cria um documento em `solicitacoesOS` com status `aguardando_orcamento`.

### Body (inglês)

```json
{
  "prefeituraId": "municipio-abc",
  "equipmentId": "uuid-do-equipamento",
  "operator": "João Silva",
  "report": "caixa hidráulica com vazamento",
  "serviceType": "corrective",
  "scheduledDate": "2026-06-14"
}
```

| Campo | Obrigatório | Descrição |
|-------|-------------|-----------|
| `prefeituraId` | Sim | Município dono da OS |
| `equipmentId` | Sim | Campo `id` do equipamento ou document id Firestore |
| `operator` | Sim | Nome do solicitante → gravado como `operador` |
| `report` | Sim | Relato do defeito → gravado como `relato` |
| `serviceType` | Não | `corrective` (corretiva) ou `preventive` (preventiva). Aceita legado `C`/`P`. Padrão: `corrective` |
| `type` | Não | **Depreciado** — use `serviceType` |
| `scheduledDate` | Não | `YYYY-MM-DD` → `dataAgendamento` |

### Regras de negócio

1. Busca equipamento e valida `prefeituraId`.
2. Linha do equipamento: `linha` ou `tipo`.
3. Busca oficinas `status` ativo + `prefeituraId`.
4. Filtra por especialidade compatível (igualdade ou `includes` bidirecional após `normEsp`).
5. Se nenhuma match → sorteia entre **todas** as oficinas ativas (fallback do front antigo).
6. Sorteia até **3** oficinas.
7. Gera protocolo sequencial `OS-{ano}-{seq}` por prefeitura/ano.

### Resposta `201`

```json
{
  "data": {
    "id": "firestore-doc-id",
    "protocol": "OS-2026-048",
    "invitedWorkshops": [
      { "id": "oficinaDoc1", "name": "Avantec" },
      { "id": "oficinaDoc2", "name": "Gava" }
    ],
    "status": "aguardando_orcamento"
  },
  "message": "Service order request created successfully."
}
```

### Erros

| HTTP | Quando |
|------|--------|
| `400` | Equipamento sem linha, equipamento de outra prefeitura |
| `404` | Equipamento não encontrado |
| `422` | Nenhuma oficina ativa no município |

---

## GET `/os/solicitacoes/{prefeituraId}`

Lista solicitações do município, ordenadas por data decrescente.

### Query params

| Param | Obrigatório | Descrição |
|-------|-------------|-----------|
| `status` | Não | `aguardando_orcamento`, `aguardando_aprovacao`, `aprovado`, `concluido` ou `todos` |
| `startDate` | Não | `YYYY-MM-DD` — filtro em `criadoEm` |
| `endDate` | Não | `YYYY-MM-DD` — filtro em `criadoEm` |

### Exemplo

```
GET /os/solicitacoes/municipio-abc?status=aguardando_orcamento&startDate=2026-06-01
```

A resposta inclui campos em inglês e em português (`protocolo`, `equipamento`, etc.) para compatibilidade com o front atual.

---

## GET `/os/solicitacoes/oficina/{oficinaId}`

Lista OS em que a oficina foi convidada (`oficinasIds`). **Por padrão retorna todas as fases** — o app da oficina separa por aba usando o campo `status`.

### Query params

| Param | Obrigatório | Descrição |
|-------|-------------|-----------|
| `status` | Não | Opcional: filtra no servidor (`aguardando_orcamento`, `pregao`, `todos`, etc.) |
| `prefeituraId` | Não | Filtra por município |
| `startDate` | Não | `YYYY-MM-DD` |
| `endDate` | Não | `YYYY-MM-DD` |

### Regras

1. Firestore: `oficinasIds array-contains oficinaId`.
2. Sem `status` na query → **todas** as OS convidadas (recebidas, pregão, aprovado, etc.).
3. Resposta inclui `lances[]`, `valorOrcado`, `oficinasResponderam[]` para montar as abas no front.

### Exemplo

```
GET /os/solicitacoes/oficina/3fd6c5ba-be6f-4038-93ac-55dfddfb037c
```

---

## POST `/os/orcamentos`

Oficina envia orçamento completo. Grava `ordensServico`, atualiza `solicitacoesOS.lances[]` e avança o status.

### Body

```json
{
  "solicitacaoOsId": "firestore-sol-id",
  "oficinaId": "3fd6c5ba-be6f-4038-93ac-55dfddfb037c",
  "prazoDias": 7,
  "items": [
    { "description": "Kit reparo", "value": 420 },
    { "description": "Mão de obra", "value": 150 }
  ]
}
```

### O que o backend faz

1. Cria documento em `ordensServico` (`status: em_pregao`).
2. Adiciona lance em `solicitacoesOS.lances[]` (`oficinaId`, `valor`, `prazoDias`).
3. Adiciona `oficinaId` em `oficinasResponderam[]`.
4. Atualiza status da solicitação:
   - `em_orcamento` — ainda faltam oficinas responder
   - `pregao` — todas as convidadas já enviaram orçamento

### Resposta `201`

```json
{
  "data": {
    "id": "ordem-doc-id",
    "protocol": "OS-2026-004",
    "valorTotal": 570,
    "prazoDias": 7,
    "solicitacaoStatus": "em_orcamento"
  },
  "message": "Orçamento enviado com sucesso."
}
```

### Erros

| HTTP | Quando |
|------|--------|
| `400` | Solicitação não está em `aguardando_orcamento`, oficina não convidada, itens inválidos |
| `404` | Solicitação não encontrada |
| `409` | Oficina já enviou orçamento |

---

## GET `/os/solicitacoes/{prefeituraId}/com-orcamentos`

Lista solicitações **com orçamentos aninhados** (`ordensServico`) — tela **Orçamentos e Aprovações**.

Mesmos query params do GET por prefeitura (`status`, `startDate`, `endDate`).

Cada item inclui:

| Campo | Descrição |
|-------|-----------|
| `quotes` / `orcamentos` | Orçamentos enviados pelas oficinas |
| `quotesReceived` | Quantidade recebida |
| `invitedCount` | Oficinas convidadas (`oficinasIds.length`) |

### Exemplo

```
GET /os/solicitacoes/municipio-abc/com-orcamentos
```

---

## PATCH `/os/solicitacoes/{solicitacaoId}/aprovar`

Prefeitura escolhe **um** orçamento. Recusa automaticamente as demais propostas pendentes.

### Body

```json
{
  "ordemServicoId": "id-do-documento-ordensServico"
}
```

### Regras

- Orçamento elegível: `em_pregao` ou `aguardando_aprovacao`
- Solicitação não pode estar `aprovado`, `concluido` ou `recusado`
- Transação: aprova 1 ordem, recusa as outras, `solicitacoesOS.status = aprovado`

### Resposta `200`

```json
{
  "data": {
    "solicitacaoId": "D2WLJz4bgAss8BiRL5J3",
    "approvedOrdemId": "ordem-id",
    "status": "aprovado"
  },
  "message": "Orçamento aprovado com sucesso."
}
```

---

## Próximas fases (não implementadas)

| Endpoint | Descrição |
|----------|-----------|
| `PATCH /os/solicitacoes/:id/lance` | Oficina ajusta valor/prazo no pregão |
| `POST /os/devolucao/checklists` | Checklist de devolução |

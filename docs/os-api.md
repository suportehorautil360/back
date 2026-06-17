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

## Próximas fases (não implementadas)

| Endpoint | Descrição |
|----------|-----------|
| `GET /os/solicitacoes/oficina/:oficinaId` | OS pendentes para a oficina |
| `POST /os/orcamentos` | Oficina envia orçamento |
| `PATCH /os/orcamentos/:id/approve` | Prefeitura aprova orçamento |
| `POST /os/devolucao/checklists` | Checklist de devolução |

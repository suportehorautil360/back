# Handoff — Plano preventivo (Fase 5a)

## Endpoints

| Método | Rota |
|--------|------|
| `GET` | `/planos-preventivos/:prefeituraId` |
| `PUT` | `/planos-preventivos/:prefeituraId` |
| `POST` | `/planos-preventivos/:prefeituraId/restaurar-padrao` |

## Firestore

Coleção: `planosPreventivos`  
Doc id: `prefeituraId`

## GET 200

```json
{
  "data": {
    "prefeituraId": "id-cliente",
    "ciclos": [],
    "linhas": [],
    "atualizadoEm": "2026-06-16T20:00:00.000Z"
  },
  "message": "Preventive plan loaded."
}
```

**404** → front usa `MATRIZ_PADRAO` local.

## PUT body

```json
{
  "ciclos": [{ "id": "c1", "horas": 250, "km": 10000, "titulo": "..." }],
  "linhas": [{
    "id": "l1",
    "categoria": "Fluidos",
    "item": "Óleo do Motor",
    "especificacao": "SAE 15W-40",
    "acoes": { "c1": "inspecionar", "c2": "trocar" }
  }]
}
```

## Front — integrar

1. Abrir tela → `GET /planos-preventivos/:prefeituraId` (404 → padrão)
2. Botão **Salvar** → `PUT`
3. **Restaurar padrão** → `POST .../restaurar-padrao`
4. CSV continua no browser

Não impacta OS Fase 1 corretiva.

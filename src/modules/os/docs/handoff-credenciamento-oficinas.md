# Handoff — Credenciamento de oficinas (OS Fase 1)

## Decisão de produto

| Conceito | Onde |
|----------|------|
| **Parceiro global** | `POST /parceiros` → coleção `oficinas` (sem `prefeituraId`) |
| **Credenciamento municipal** | Oficina autorizada a receber OS daquele cliente |
| **Sorteio OS** | Só oficinas com `prefeituraId` + `status: "Ativa"` |

Parceiro cadastrado **sem credenciar** → **não entra** no `POST /os/solicitacoes` (422).

---

## Fluxo Admin

1. Cadastrar parceiro: `POST /parceiros` (`tipo: "oficina"`)
2. Credenciar no município: `POST /clientes/:prefeituraId/parceiros/:parceiroId/credenciar`
3. Criar OS: `POST /os/solicitacoes`

---

## Endpoints novos

### Listar oficinas credenciadas (preview + sorteio)

```
GET /clientes/:prefeituraId/oficinas
```

Resposta:
```json
{
  "data": [
    {
      "id": "uuid",
      "nome": "Oficina Silva",
      "especialidade": "Amarela",
      "status": "Ativa",
      "parceiroId": "uuid-parceiro-global",
      "cidadeUf": "São Paulo/SP",
      "linhasAtuacao": ["Linha Amarela"]
    }
  ],
  "message": "Oficinas credenciadas carregadas com sucesso."
}
```

**Front P1:** trocar aba Oficina do form de Firestore direto para esta API.

### Credenciar

```
POST /clientes/:prefeituraId/parceiros/:parceiroId/credenciar
```

Grava/atualiza doc em `oficinas` com:
```json
{
  "prefeituraId": "<id cliente>",
  "nome": "...",
  "especialidade": "Amarela",
  "status": "Ativa",
  "parceiroId": "<uuid parceiro global>"
}
```

- **1º município:** atualiza o doc global do parceiro com `prefeituraId` (mesmo `id` → compatível com login da oficina).
- **Outro município:** cria doc clone com novo UUID + `parceiroId` apontando para o global.

`especialidade` deriva de: `especialidade` → `linhasAtuacao[0]` (`"Linha Amarela"` → `"Amarela"`) → `categoriasServico`.

### Descredenciar

```
DELETE /clientes/:prefeituraId/parceiros/:parceiroId/descredenciar
```

Define `status: "Suspensa"` no credenciamento municipal. **Não** apaga o parceiro global.

---

## OS (inalterado no contrato)

```
POST /os/solicitacoes
GET  /os/solicitacoes/:prefeituraId
```

Sorteio: `oficinas` onde `prefeituraId` + `Ativa` → match linha × especialidade → fallback todas → até 3.

`oficinasIds` = **document IDs** retornados no sorteio (mesmo ID que a OficinaPage usa em `array-contains`).

---

## Teste de aceite

1. `POST /parceiros` oficina com `linhasAtuacao: ["Linha Amarela"]`
2. `POST /clientes/{pref}/parceiros/{id}/credenciar`
3. `GET /clientes/{pref}/oficinas` → lista a oficina
4. `POST /os/solicitacoes` com equipamento linha `Amarela` → **201**, `invitedWorkshops.length >= 1`
5. Parceiro sem passo 2 → **422**

# 🚜 Backend de Gestão de Frota e Operações de Campo

Este é um repositório backend construído com **NestJS** e **Firebase/Firestore**, focado no gerenciamento de maquinário pesado, veículos, alocações, frentes de trabalho e controle de jornada (RH) para múltiplas organizações (isolamento por `prefeituraId`).

---

## 🤖 Nota para Inteligências Artificiais (AI Context)

Se você é uma IA lendo este repositório para auxiliar o desenvolvedor, foque nestes pilares de arquitetura e regras de negócio:

### 1. Stack Tecnológica

- **Framework:** NestJS (TypeScript).
- **Banco de Dados:** Firebase Firestore (NoSQL). O acesso é injetado via `FirebaseService`.
- **Documentação da API:** Swagger (`@nestjs/swagger`) através de decorators nos Controllers e DTOs.
- **Validação:** `class-validator` e `class-transformer` acoplados aos DTOs.
- **Testes & CI:** Jest para testes, formatadores padrão da comunidade. CI/CD via GitHub Actions (Lint, Testes unitários, e Nest Build).

### 2. Padrões de Arquitetura

- **Módulos (Domain-Driven):** Separação estrita de domínios em módulos (`movimentacoes`, `equipamentos`, `time-records`, etc.).
- **Multi-tenancy Isolado:** A base inteira usa o conceito de isolamento de inquilino através da chave `prefeituraId`. Praticamente toda listagem e criação (Consultas ao Firestore) deve filtrar por `where('prefeituraId', '==', prefeituraId)`.
- **Sem ORM Relacional:** Como o banco é NoSQL (Firestore), as "joins" são feitas na camada de Service. Por exemplo, a listagem de `historico` busca os documentos de abastecimento/lubrificação e faz o merge manual consultando a coleção de `equipamentos`.
- **Offline-First no Client:** Os apps mobile podem operar offline, logo, o backend está preparado para processar geolocalização bruta (`latitude` / `longitude`) e suporta `clientRequestId` em alguns recursos para evitar duplicidade em sincronizações atrasadas.

### 3. Domínios e Módulos Principais

#### A. Movimentações de Equipamentos (`/src/modules/movimentacoes`)

Lida com os apontamentos feitos em campo sobre as máquinas:

- **Abastecimentos:** Lançamentos de combustível (diesel, etc) via comboio. Exige horímetro/hodômetro atual, coordenadas de GPS e quantidade.
- **Lubrificações:** Registro de engraxamento de pontos específicos da máquina (ex: buchas, eixos).
- **Reabastecimentos:** Registro do recarregamento do comboio de combustível (via Posto, Tanque da Fazenda ou Distribuidora).
- **Histórico:** Módulo de consolidação que junta Abastecimentos, Lubrificações e Reabastecimentos em uma linha do tempo unificada para o usuário final. Usa Nominatim (OpenStreetMap) para _Reverse Geocoding_ reverso convertendo Lat/Lon do momento do apontamento para um endereço textual.

#### B. Gestão de Frotas

- **Vehicles & Equipamentos:** Cadastros base do maquinário e de carros de apoio. Eles são frequentemente referenciados via Placa, Chassi ou ID interno em apontamentos (resolvidos pelo utilitário `matchesPlateOrChassis`).
- **Revision (Manutenções):** Módulo para gerenciar a rotina de manutenções preventivas/corretivas. Possui ações avançadas como `completeRevision`, que atualiza a quilometragem atual do veículo de acordo com o apontamento mecânico.

#### C. Frentes de Trabalho e Alocação

- **Work Fronts (Frentes de Trabalho):** Agrupamento físico/lógico onde a operação está ocorrendo.
- **Allocations:** Relação de um Equipamento ou Veículo com uma Frente de Trabalho específica.

#### D. Controle de Jornada (RH)

- **Time Records (Batidas de Ponto):** Apontamentos de entrada, saída, pausas dos colaboradores operacionais.
- **Solicitações de Ponto:** Workflow de aprovação/reprovação. Caso o operador esqueça de bater o ponto, ele cria uma solicitação que fica pendente de aprovação (via endpoints `/aprovar` ou `/reprovar` por um gestor/RH).

---

## 💡 Boas Práticas Estabelecidas (Regras de Escrita de Código)

Ao sugerir alterações ou refatorações neste projeto, a IA deve respeitar:

1. **Retorno Padronizado das Controllers:** A maioria das APIs retorna objetos no formato `{ data: T | T[], message: string }`. Use DTOs explícitos e bem tipados para o Swagger.
2. **Geração de IDs:** O backend cuida da geração de IDs (via `randomUUID()` do Node.js puro) na gravação de novos documentos Firestore.
3. **Injeção de Dependência:** Consultas e lógicas envolvendo serviços externos sempre ocorrem em Providers (`@Injectable()`). Exemplo: `this.firebaseService.getFirestore().collection(...)`.
4. **Datas:** Tratamento cuidadoso e padronizado usando os helpers isolados (ex: `parseDateStart`, `parseDateEnd` que normalizam buscas `>= 00:00:00` e `<= 23:59:59`). As datas são armazenadas como string ISO 8601 (`new Date().toISOString()`) no Firestore.
5. **Validação de Entrada:** Tudo que vem das Rotas (Body/Query) deve passar pelo `class-validator` (como `@IsString()`, `@IsNotEmpty()`, `@Min()`). Tipos literais são definidos em constantes de Arrays (`as const`) e validados por `@IsIn()`.

---

## Estrutura de Diretórios Base

```text
src/
 ├── config/                 # Configurações globais (Firebase, Swagger, etc)
 ├── modules/                # Agrupamento modular da arquitetura do Nest
 │    ├── abastecimentos/
 │    ├── equipamentos/
 │    ├── movimentacoes/     # Módulo "Guarda-chuva" aglutinando Sub-módulos Operacionais
 │    ├── solicitacoes-ponto/
 │    ├── time-records/
 │    ├── user/
 │    └── ...
 └── main.ts                 # Bootstrap da aplicação
```

## Como Executar

```bash
# Instalar dependências (O projeto usa pnpm)
pnpm install

# Subir a aplicação localmente
pnpm start:dev
```

A documentação Swagger estará disponível em `http://localhost:<PORTA>/api/docs`.

/**
 * As notificações do almoxarifado.
 *
 * Grava na mesma tabela `notificacoes` que o painel usa por
 * `lib/company/notificacoes/enviar.ts` — não há serviço compartilhado entre os
 * dois repos, e duplicar os CAMPOS da escrita é mais barato que inventar um.
 * O que NÃO se duplica é regra de saldo.
 *
 * RULING da rodada 2 (achado Important I4, reabre a versão anterior deste
 * comentário): `notificacoes` tem FORCE ROW LEVEL SECURITY com policies só de
 * SELECT e UPDATE — nenhuma de INSERT (conferido em `pg_policies`). Hoje o
 * INSERT passa porque o `back` conecta como o `postgres` do Supabase
 * (BYPASSRLS); com qualquer role de privilégio menor ele falha com `42501`,
 * que `erroDeContencaoTransitoria` não trata — a exceção sobe. Receber `tx` e
 * escrever DENTRO da transação de negócio (o desenho original) significa que
 * essa exceção derrubaria o ato: todo kit fechado e toda OS liberada
 * responderiam 500 com rollback de uma conferência que já aconteceu na
 * prateleira. `enviarNotificacao` (`lib/company/notificacoes/enviar.ts`), o
 * OUTRO escritor desta mesma tabela, decidiu o oposto e documentou por quê:
 * "Nunca lança. […] o aviso vem depois do commit e uma falha aqui não pode
 * desfazer um ato que já aconteceu" e "sem `tx` no parâmetro: quem chamar não
 * tem como, nem por engano, prender a aprovação a este insert". Este módulo
 * segue o mesmo contrato agora:
 *
 * - `montarNotificacaoKitCompleto`/`montarNotificacaoOsLiberada` RESOLVEM
 *   destinatários (leem `operator`/`equipment_programadores`/`company_roles`/
 *   `access_groups`/`companies` — nenhuma delas com o mesmo risco de RLS) e
 *   DEVOLVEM as linhas prontas para gravar. Recebem `tx` DE PROPÓSITO e
 *   PODEM lançar: rodam DENTRO da transação de negócio, onde o estado
 *   (cargo do operador, kit fechado) é lido fresco, e uma falha aqui é uma
 *   falha de leitura comum — deve dar rollback como qualquer outra.
 * - `enviarNotificacoes` GRAVA. Roda DEPOIS do commit, com o client normal
 *   (nunca `tx` — por isso o parâmetro é tipado `PrismaClient`, que um `tx`
 *   não satisfaz) e NUNCA LANÇA: uma falha de INSERT vira log, o sino fica
 *   sem a linha, e o ato de negócio que já comitou não é desfeito.
 */
import { Prisma, PrismaClient } from '../../../prisma/generated/client';

/** Para RESOLVER destinatários — roda dentro da transação de negócio. */
type ClienteDaTransacao = Prisma.TransactionClient;

/** Para GRAVAR — roda depois do commit. Um `tx` não tem este tipo. */
type ClienteDeEnvio = PrismaClient;

/** Uma linha já pronta para `notificacao.createMany` — mesmo shape da tabela. */
export type NotificacaoPronta = Prisma.NotificacaoCreateManyInput;

interface LinhaDeNotificacao {
  destinatarioId: string;
  titulo: string;
  mensagem: string;
  referenciaTipo: string;
  referenciaId: string;
}

/**
 * `prefeitura_legacy_id` é NOT NULL e `Company.legacyId` é nullable: empresa
 * nascida no horautil não tem docId do Firestore. Mesmo fallback do painel.
 *
 * Só MONTA as linhas — não escreve nada. Roda dentro da transação (lê
 * `company`, sem risco de RLS de INSERT).
 */
async function montarLinhas(
  tx: ClienteDaTransacao,
  companyId: string,
  linhas: LinhaDeNotificacao[],
): Promise<NotificacaoPronta[]> {
  // Gestor que também é programador é um destinatário só. Mantém a PRIMEIRA
  // ocorrência (achado minor m6 da revisão): hoje é inofensivo (mecânico e
  // programador recebem `titulo`/`mensagem` idênticos por caminho), mas fixa
  // um critério determinístico para o dia em que divergirem por
  // destinatário, em vez de depender da ordem de inserção no `Map`.
  const unicos = new Map<string, LinhaDeNotificacao>();
  for (const l of linhas) {
    if (l.destinatarioId && !unicos.has(l.destinatarioId)) unicos.set(l.destinatarioId, l);
  }
  if (unicos.size === 0) return [];

  const company = await tx.company.findUnique({
    where: { id: companyId },
    select: { legacyId: true },
  });

  return [...unicos.values()].map((l) => ({
    companyId,
    destinatarioTipo: 'company_user',
    destinatarioId: l.destinatarioId,
    prefeituraLegacyId: company?.legacyId ?? companyId,
    titulo: l.titulo,
    mensagem: l.mensagem,
    tipo: 'info',
    referenciaTipo: l.referenciaTipo,
    referenciaId: l.referenciaId,
  }));
}

/**
 * Kit conferido: o almoxarife é quem age em seguida (libera). Só MONTA as
 * linhas — quem chama grava depois do commit, com `enviarNotificacoes`.
 */
export async function montarNotificacaoKitCompleto(
  tx: ClienteDaTransacao,
  input: {
    companyId: string;
    requisicaoId: string;
    numero: string;
    protocolo: string;
    destinatarios: string[];
  },
): Promise<NotificacaoPronta[]> {
  return montarLinhas(
    tx,
    input.companyId,
    input.destinatarios.map((id) => ({
      destinatarioId: id,
      titulo: `Kit da ${input.numero} conferido`,
      // A mensagem cita `numero` E `protocolo`: só `protocolo` (o texto
      // original do brief da Task 8) não dizia qual REQUISIÇÃO fechou — o
      // teste de integração cobra as duas strings.
      mensagem: `Todos os itens impeditivos da ${input.numero} (${input.protocolo}) estão separados. Libere a ordem para o mecânico.`,
      referenciaTipo: 'requisicao_material',
      referenciaId: input.requisicaoId,
    })),
  );
}

/**
 * OS liberada: mecânico E todo programador do equipamento. Só MONTA as
 * linhas — quem chama grava depois do commit, com `enviarNotificacoes`.
 *
 * A mensagem diz ONDE retirar — sem isso o mecânico sabe que pode começar e
 * não sabe para onde ir.
 */
export async function montarNotificacaoOsLiberada(
  tx: ClienteDaTransacao,
  input: {
    companyId: string;
    serviceOrderId: string;
    protocolo: string;
    equipmentNome: string | null;
    equipmentId: string | null;
    responsavelOperatorId: string | null;
    local: string;
  },
): Promise<NotificacaoPronta[]> {
  const destinatarios: string[] = [];

  if (input.responsavelOperatorId) {
    const mecanico = await tx.operator.findFirst({
      where: { id: input.responsavelOperatorId, companyId: input.companyId },
      select: { companyUserId: true },
    });
    // Mecânico sem login no painel não vira destinatário: notificar quem não
    // consegue abrir a tela é o mesmo que não notificar. Mesma regra de
    // `destinatariosDoOperador` no painel.
    if (mecanico?.companyUserId) destinatarios.push(mecanico.companyUserId);
  }

  if (input.equipmentId) {
    // CORREÇÃO DO COORDENADOR (preflight, Task 8): `equipment_programadores`
    // NÃO tem coluna `company_id` — o isolamento por empresa vai pela
    // relação (`equipment: { companyId }`), não por coluna própria.
    //
    // Achado minor m3 da revisão: `EquipmentProgramador` tem
    // `@@unique([equipmentId, companyUserId])` — um equipamento pode ter
    // MAIS de um programador. Um `findFirst` avisava só um, escolhido pelo
    // plano do Postgres (não determinístico); `findMany` avisa todos, e o
    // dedupe de `montarLinhas` já cobre o caso de o mesmo programador
    // também ser o mecânico responsável.
    const programadores = await tx.equipmentProgramador.findMany({
      where: {
        equipmentId: input.equipmentId,
        equipment: { companyId: input.companyId },
      },
      select: { companyUserId: true },
    });
    for (const p of programadores) {
      if (p.companyUserId) destinatarios.push(p.companyUserId);
    }
  }

  return montarLinhas(
    tx,
    input.companyId,
    destinatarios.map((id) => ({
      destinatarioId: id,
      titulo: `${input.protocolo} liberada`,
      mensagem: `Todos os itens impeditivos${input.equipmentNome ? ` da ${input.equipmentNome}` : ''} foram separados. Retire o kit no ${input.local} ou confirme o recebimento em campo.`,
      referenciaTipo: 'service_order',
      referenciaId: input.serviceOrderId,
    })),
  );
}

/**
 * Grava as notificações já montadas. Roda DEPOIS do commit da transação de
 * negócio — nunca dentro dela, nunca com `tx` (o parâmetro é `PrismaClient`
 * de propósito: um `tx` não tem os métodos que esse tipo exige, então quem
 * chama não tem como, nem por engano, prender o ato de negócio a este
 * insert).
 *
 * NUNCA LANÇA — mesmo contrato de `enviarNotificacao`
 * (`lib/company/notificacoes/enviar.ts`): uma falha aqui (inclusive o
 * `42501` de RLS descrito no comentário do módulo) vira log, o sino fica sem
 * a linha, e o ato de negócio que já comitou não é desfeito.
 */
export async function enviarNotificacoes(
  prisma: ClienteDeEnvio,
  linhas: NotificacaoPronta[],
): Promise<void> {
  if (linhas.length === 0) return;
  try {
    await prisma.notificacao.createMany({ data: linhas });
  } catch (err) {
    // Achado minor n4 da rodada 3: sem identificador, o log só dizia "um
    // sino falhou" — nunca QUAL kit ou OS. Todas as linhas de UMA chamada
    // compartilham a mesma referência (a requisição que fechou o kit, ou a
    // OS que foi liberada) — `console.error` é a convenção do repo para
    // isto (precedente em `solicitacoes-ponto.service.ts:188`).
    console.error(
      `[almoxarifado-notificacoes] falha ao gravar notificação (${linhas[0]?.referenciaTipo}:${linhas[0]?.referenciaId})`,
      err,
    );
  }
}

/**
 * Quem age depois do kit conferido é quem tem a tela do almoxarifado. O cargo
 * mora no `Operator` (`CompanyRole.operators`), não no `CompanyUser` — e quem
 * recebe notificação é o `companyUserId` do operador, que é nullable: operador
 * sem login no painel não vira destinatário.
 */
export async function usuariosDoAlmoxarifado(tx: ClienteDaTransacao, companyId: string): Promise<string[]> {
  // Duas etapas de propósito: o espelho do `back` declara só a COLUNA
  // `Operator.companyRoleId`, sem a relação `companyRole` (e `CompanyRole` não
  // tem a volta `operators`). Um `where: { companyRole: { ... } }` não compila
  // aqui, embora compile no horautil. Não invente a relação no schema: é
  // espelho, e mudá-lo é do coordenador.
  const cargos = await tx.companyRole.findMany({
    where: {
      companyId,
      ativo: true,
      accessGroups: { some: { enabled: true, group: { key: 'almoxarifado' } } },
    },
    select: { id: true },
  });
  if (cargos.length === 0) return [];

  const operadores = await tx.operator.findMany({
    where: {
      companyId,
      companyRoleId: { in: cargos.map((c) => c.id) },
      companyUserId: { not: null },
    },
    select: { companyUserId: true },
  });
  return operadores.map((o) => o.companyUserId).filter((id): id is string => !!id);
}

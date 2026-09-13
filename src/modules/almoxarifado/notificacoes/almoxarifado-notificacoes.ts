/**
 * As notificações do almoxarifado.
 *
 * Grava direto em `notificacoes`, a mesma tabela que o painel usa por
 * `lib/company/notificacoes/enviar.ts` — não há serviço compartilhado entre os
 * dois repos, e duplicar a ESCRITA de duas linhas é mais barato que inventar
 * um. O que NÃO se duplica é regra de saldo.
 *
 * Recebe o `tx` de propósito: a notificação nasce na mesma transação do ato que
 * a motivou. Avisar que a OS foi liberada e a liberação dar rollback é pior que
 * não avisar.
 */
import { Prisma } from '../../../prisma/generated/client';

type Cliente = Prisma.TransactionClient;

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
 */
async function gravar(
  tx: Cliente,
  companyId: string,
  linhas: LinhaDeNotificacao[],
): Promise<void> {
  // Gestor que também é programador é um destinatário só.
  const unicos = new Map<string, LinhaDeNotificacao>();
  for (const l of linhas) {
    if (l.destinatarioId) unicos.set(l.destinatarioId, l);
  }
  if (unicos.size === 0) return;

  const company = await tx.company.findUnique({
    where: { id: companyId },
    select: { legacyId: true },
  });

  await tx.notificacao.createMany({
    data: [...unicos.values()].map((l) => ({
      companyId,
      destinatarioTipo: 'company_user',
      destinatarioId: l.destinatarioId,
      prefeituraLegacyId: company?.legacyId ?? companyId,
      titulo: l.titulo,
      mensagem: l.mensagem,
      tipo: 'info',
      referenciaTipo: l.referenciaTipo,
      referenciaId: l.referenciaId,
    })),
  });
}

/** Kit conferido: o almoxarife é quem age em seguida (libera). */
export async function notificarKitCompleto(
  tx: Cliente,
  input: {
    companyId: string;
    requisicaoId: string;
    numero: string;
    protocolo: string;
    destinatarios: string[];
  },
): Promise<void> {
  await gravar(
    tx,
    input.companyId,
    input.destinatarios.map((id) => ({
      destinatarioId: id,
      titulo: `Kit da ${input.numero} conferido`,
      // Achado da implementação: a versão original do brief só citava
      // `protocolo` aqui — a mensagem não dizia qual REQUISIÇÃO fechou (o
      // teste desta task cobra `numero` na mensagem, não só no título).
      // Mantém `protocolo` também: é o que liga o kit à OS.
      mensagem: `Todos os itens impeditivos da ${input.numero} (${input.protocolo}) estão separados. Libere a ordem para o mecânico.`,
      referenciaTipo: 'requisicao_material',
      referenciaId: input.requisicaoId,
    })),
  );
}

/**
 * OS liberada: mecânico E programador.
 *
 * A mensagem diz ONDE retirar — sem isso o mecânico sabe que pode começar e
 * não sabe para onde ir.
 */
export async function notificarOsLiberada(
  tx: Cliente,
  input: {
    companyId: string;
    serviceOrderId: string;
    protocolo: string;
    equipmentNome: string | null;
    equipmentId: string | null;
    responsavelOperatorId: string | null;
    local: string;
  },
): Promise<void> {
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
    // CORREÇÃO DO COORDENADOR (preflight): `equipment_programadores` NÃO tem
    // coluna `company_id` — conferido no schema. O isolamento por empresa vai
    // pela relação, não por coluna própria. Sem isso o `tsc` quebra no
    // `npm run build` (e o `npx jest` NÃO pegaria: o teste mocka este
    // `findFirst`).
    const programador = await tx.equipmentProgramador.findFirst({
      where: {
        equipmentId: input.equipmentId,
        equipment: { companyId: input.companyId },
      },
      select: { companyUserId: true },
    });
    if (programador?.companyUserId) destinatarios.push(programador.companyUserId);
  }

  await gravar(
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
 * Quem age depois do kit conferido é quem tem a tela do almoxarifado. O cargo
 * mora no `Operator` (`CompanyRole.operators`), não no `CompanyUser` — e quem
 * recebe notificação é o `companyUserId` do operador, que é nullable: operador
 * sem login no painel não vira destinatário.
 */
export async function usuariosDoAlmoxarifado(tx: Cliente, companyId: string): Promise<string[]> {
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

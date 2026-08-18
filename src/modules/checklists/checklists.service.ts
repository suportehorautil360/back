import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../prisma/generated/client';
import { resolverCompanyId } from '../../common/prisma/company-resolver';
import { PrismaService } from '../../prisma/prisma.service';
import { EmergenciesService } from '../emergencies/emergencies.service';
import {
  AnswerChecklistQuestionDto,
  ChecklistRuleActionDto,
} from './dto/answer-checklist-question.dto';
import { CreateChecklistRunDto } from './dto/create-checklist-run.dto';
import { ChecklistFlowService } from './checklist-flow.service';

function toSafeString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

function toSafeMillis(value: unknown): number {
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function normalizeAnswerValue(value: unknown): 'sim' | 'nao' | 'outro' {
  if (typeof value === 'boolean') {
    return value ? 'sim' : 'nao';
  }

  const normalized = toSafeString(value)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (normalized === 'sim' || normalized === 'yes' || normalized === 'ok') {
    return 'sim';
  }

  if (normalized === 'nao' || normalized === 'no') {
    return 'nao';
  }

  return 'outro';
}

function toDateFilterIso(value?: string): string | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return undefined;
  return new Date(parsed).toISOString();
}

function normalizeText(value?: string): string {
  return toSafeString(value)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

type WorkflowAnswer = {
  id: string;
  runId: string;
  questionId: string;
  questionLabel: string | null;
  value: unknown;
  problemDescription: string | null;
  photoUrls: string[];
  impeditivo: boolean;
  answeredAt: string;
};

type WorkflowMeta = {
  status: string;
  blockReason?: string | null;
  generatedEmergencyIds: string[];
  definitionId?: string | null;
  definitionVersion?: number;
  equipamentoId?: string;
  localizacaoGps?: string | null;
  startedAt: string;
};

type WorkflowState = {
  meta: WorkflowMeta;
  answers: WorkflowAnswer[];
};

function parseWorkflow(respostas: unknown): WorkflowState | null {
  if (!respostas || typeof respostas !== 'object') return null;
  const wf = (respostas as { _workflow?: WorkflowState })._workflow;
  if (!wf?.meta || !Array.isArray(wf.answers)) return null;
  return wf;
}

function buildWorkflowDoc(
  row: {
    id: string;
    legacyId: string | null;
    definitionLegacyId: string | null;
    chassi: string | null;
    operadorNome: string | null;
    categoria: string | null;
    executedAt: Date | null;
    updatedAt: Date;
  },
  prefeituraId: string,
  workflow: WorkflowState,
) {
  const runId = row.legacyId ?? row.id;
  const respostas = workflow.answers.map((answer) => ({
    ...answer,
    valueNormalized: normalizeAnswerValue(answer.value),
  }));
  const totalOk = respostas.filter((r) => r.valueNormalized === 'sim').length;
  const totalNao = respostas.filter((r) => r.valueNormalized === 'nao').length;

  return {
    id: runId,
    definitionId: workflow.meta.definitionId ?? row.definitionLegacyId,
    definitionVersion: workflow.meta.definitionVersion ?? 1,
    prefeituraId,
    equipamentoId: workflow.meta.equipamentoId ?? null,
    chassis: row.chassi ?? '',
    operadorNome: row.operadorNome ?? '',
    categoria: row.categoria,
    status: workflow.meta.status,
    blockReason: workflow.meta.blockReason ?? null,
    generatedEmergencyIds: workflow.meta.generatedEmergencyIds,
    localizacaoGps: workflow.meta.localizacaoGps ?? null,
    startedAt: workflow.meta.startedAt,
    updatedAt: row.updatedAt.toISOString(),
    resumo: {
      totalPerguntas: respostas.length,
      totalOk,
      totalNao,
    },
    respostas,
  };
}

@Injectable()
export class ChecklistsService {
  constructor(
    private readonly prisma: PrismaService,
    private emergencies: EmergenciesService,
    private flow: ChecklistFlowService,
  ) {}

  async createRun(dto: CreateChecklistRunDto) {
    const id = randomUUID();
    const agora = new Date().toISOString();
    const companyId = await resolverCompanyId(this.prisma, dto.prefeituraId);
    if (!companyId) {
      throw new InternalServerErrorException('Empresa não encontrada.');
    }

    const localizacaoGps = dto.localizacaoGps?.trim() || null;

    const workflow: WorkflowState = {
      meta: {
        status: 'in_progress',
        blockReason: null,
        generatedEmergencyIds: [],
        definitionId: dto.definitionId ?? null,
        definitionVersion: dto.definitionVersion ?? 1,
        equipamentoId: dto.equipamentoId,
        localizacaoGps,
        startedAt: agora,
      },
      answers: [],
    };

    const doc = {
      id,
      definitionId: dto.definitionId ?? null,
      definitionVersion: dto.definitionVersion ?? 1,
      prefeituraId: dto.prefeituraId,
      equipamentoId: dto.equipamentoId,
      chassis: dto.chassis,
      operadorNome: dto.operadorNome,
      categoria: dto.categoria ?? null,
      status: 'in_progress',
      generatedEmergencyIds: [],
      startedAt: agora,
      updatedAt: agora,
    };

    try {
      await this.prisma.checklistRun.create({
        data: {
          id,
          legacyId: id,
          companyId,
          definitionLegacyId: dto.definitionId ?? null,
          chassi: dto.chassis,
          operadorNome: dto.operadorNome,
          categoria: dto.categoria ?? null,
          localizacaoGps,
          respostas: { _workflow: workflow } as Prisma.InputJsonValue,
          executedAt: new Date(agora),
        },
      });
      return { data: doc, message: 'Execução de checklist iniciada.' };
    } catch (error) {
      console.error('Erro ao iniciar checklist:', error);
      throw new InternalServerErrorException(
        'Não foi possível iniciar o checklist.',
      );
    }
  }

  async answer(runId: string, dto: AnswerChecklistQuestionDto) {
    const row = await this.prisma.checklistRun.findFirst({
      where: { OR: [{ id: runId }, { legacyId: runId }] },
    });
    if (!row) {
      throw new NotFoundException('Checklist não encontrado.');
    }

    const company = await this.prisma.company.findUnique({
      where: { id: row.companyId },
      select: { legacyId: true },
    });
    const prefeituraId = company?.legacyId ?? row.companyId;
    const workflow = parseWorkflow(row.respostas);
    if (!workflow) {
      throw new NotFoundException('Checklist não encontrado.');
    }

    const agora = new Date().toISOString();
    const answerDoc: WorkflowAnswer = {
      id: randomUUID(),
      runId: row.legacyId ?? row.id,
      questionId: dto.questionId,
      questionLabel: dto.questionLabel ?? null,
      value: dto.value,
      problemDescription: dto.problemDescription ?? null,
      photoUrls: Array.isArray(dto.photoUrls) ? dto.photoUrls : [],
      impeditivo: dto.impeditivo === true,
      answeredAt: agora,
    };

    const result = this.flow.evaluateAnswer({
      questionId: dto.questionId,
      questionLabel: dto.questionLabel,
      value: dto.value,
      problemDescription: dto.problemDescription,
      actions: dto.actions,
    });

    const runDoc = buildWorkflowDoc(row, prefeituraId, workflow);
    const generatedEmergencyIds = [...workflow.meta.generatedEmergencyIds];

    try {
      workflow.answers.push(answerDoc);

      for (const action of result.actions) {
        if (action.type !== 'CREATE_EMERGENCY') continue;
        const created = await this.createEmergencyFromAction(runDoc, dto, action);
        generatedEmergencyIds.push(created.id);
      }

      workflow.meta.status = result.status;
      workflow.meta.blockReason = result.blockReason ?? null;
      workflow.meta.generatedEmergencyIds = generatedEmergencyIds;

      await this.prisma.checklistRun.update({
        where: { id: row.id },
        data: {
          respostas: { _workflow: workflow } as Prisma.InputJsonValue,
        },
      });

      return {
        data: {
          answer: answerDoc,
          flow: result,
          generatedEmergencyIds,
        },
        message: 'Resposta registrada.',
      };
    } catch (error) {
      console.error('Erro ao responder checklist:', error);
      throw new InternalServerErrorException(
        'Não foi possível registrar a resposta do checklist.',
      );
    }
  }

  async listRunsByPrefeitura(params: {
    prefeituraId: string;
    startDate?: string;
    endDate?: string;
    chassis?: string;
    operadorNome?: string;
  }) {
    try {
      const { prefeituraId, startDate, endDate, chassis, operadorNome } =
        params;
      const companyId = await resolverCompanyId(this.prisma, prefeituraId);
      if (!companyId) {
        return { data: [], message: 'Execuções de checklist listadas.' };
      }

      const startDateIso = toDateFilterIso(startDate);
      const endDateIso = toDateFilterIso(endDate);
      const chassisTerm = normalizeText(chassis);
      const operadorTerm = normalizeText(operadorNome);

      const rows = await this.prisma.checklistRun.findMany({
        where: {
          companyId,
          ...(startDateIso || endDateIso
            ? {
                executedAt: {
                  ...(startDateIso ? { gte: new Date(startDateIso) } : {}),
                  ...(endDateIso ? { lte: new Date(endDateIso) } : {}),
                },
              }
            : {}),
        },
        orderBy: { executedAt: 'desc' },
      });

      let filteredRows = rows
        .map((row) => {
          const workflow = parseWorkflow(row.respostas);
          if (!workflow) return null;
          return buildWorkflowDoc(row, prefeituraId, workflow);
        })
        .filter((row): row is NonNullable<typeof row> => row !== null);

      if (chassisTerm) {
        filteredRows = filteredRows.filter((row) =>
          normalizeText(toSafeString(row.chassis)).includes(chassisTerm),
        );
      }
      if (operadorTerm) {
        filteredRows = filteredRows.filter((row) =>
          normalizeText(toSafeString(row.operadorNome)).includes(operadorTerm),
        );
      }

      filteredRows.sort(
        (a, b) => toSafeMillis(b.startedAt) - toSafeMillis(a.startedAt),
      );

      return {
        data: filteredRows,
        message: 'Execuções de checklist listadas.',
      };
    } catch (error) {
      console.error('Erro ao listar execuções de checklist:', error);
      throw new InternalServerErrorException(
        'Não foi possível listar as execuções de checklist.',
      );
    }
  }

  private async createEmergencyFromAction(
    run: Record<string, unknown>,
    answer: AnswerChecklistQuestionDto,
    action: Extract<ChecklistRuleActionDto, { type: 'CREATE_EMERGENCY' }>,
  ) {
    const created = await this.emergencies.create({
      prefeituraId: toSafeString(run.prefeituraId),
      source: 'checklist_auto',
      severity: action.severity ?? 'critical',
      equipamentoId: toSafeString(run.equipamentoId),
      chassis: toSafeString(run.chassis),
      operadorNome: toSafeString(run.operadorNome),
      localizacaoGps: toSafeString(run.localizacaoGps) || null,
      tipoFalha: action.failureType,
      descricao:
        action.description ??
        answer.problemDescription ??
        `Emergência gerada pela pergunta: ${answer.questionLabel ?? answer.questionId}`,
      fotos: answer.photoUrls,
      checklistRunId: toSafeString(run.id),
      checklistId: toSafeString(run.definitionId),
      questionId: answer.questionId,
      questionLabel: answer.questionLabel ?? null,
      answerValue: answer.value,
    });
    return created.data;
  }
}

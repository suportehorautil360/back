import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FirebaseService } from '../../config/firebase.service';
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

  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate: () => Date }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate().getTime();
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

@Injectable()
export class ChecklistsService {
  constructor(
    private firebase: FirebaseService,
    private emergencies: EmergenciesService,
    private flow: ChecklistFlowService,
  ) {}

  private get runs() {
    return this.firebase.getFirestore().collection('checklistRuns');
  }

  private get answers() {
    return this.firebase.getFirestore().collection('checklistAnswers');
  }

  async createRun(dto: CreateChecklistRunDto) {
    const id = randomUUID();
    const agora = new Date().toISOString();
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
      await this.runs.doc(id).set(doc);
      return { data: doc, message: 'Execução de checklist iniciada.' };
    } catch (error) {
      console.error('Erro ao iniciar checklist:', error);
      throw new InternalServerErrorException(
        'Não foi possível iniciar o checklist.',
      );
    }
  }

  async answer(runId: string, dto: AnswerChecklistQuestionDto) {
    const runRef = this.runs.doc(runId);
    const runSnap = await runRef.get();
    if (!runSnap.exists) {
      throw new NotFoundException('Checklist não encontrado.');
    }

    const run = runSnap.data() as Record<string, unknown>;
    const agora = new Date().toISOString();
    const answerDoc = {
      id: randomUUID(),
      runId,
      questionId: dto.questionId,
      questionLabel: dto.questionLabel ?? null,
      value: dto.value,
      problemDescription: dto.problemDescription ?? null,
      photoUrls: Array.isArray(dto.photoUrls) ? dto.photoUrls : [],
      // Impeditivo reprovado: triagem de risco usa este flag para forçar Alto
      // (mesmo quando já gerou emergência).
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
    const generatedEmergencyIds: string[] = Array.isArray(
      run.generatedEmergencyIds,
    )
      ? (run.generatedEmergencyIds as string[])
      : [];

    try {
      await this.answers.doc(answerDoc.id).set(answerDoc);

      for (const action of result.actions) {
        if (action.type !== 'CREATE_EMERGENCY') continue;
        const created = await this.createEmergencyFromAction(run, dto, action);
        generatedEmergencyIds.push(created.id);
      }

      await runRef.update({
        status: result.status,
        blockReason: result.blockReason,
        generatedEmergencyIds,
        updatedAt: agora,
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
      const startDateIso = toDateFilterIso(startDate);
      const endDateIso = toDateFilterIso(endDate);
      const chassisTerm = normalizeText(chassis);
      const operadorTerm = normalizeText(operadorNome);

      let runsQuery = this.runs.where('prefeituraId', '==', prefeituraId);
      if (startDateIso) {
        runsQuery = runsQuery.where('startedAt', '>=', startDateIso);
      }
      if (endDateIso) {
        runsQuery = runsQuery.where('startedAt', '<=', endDateIso);
      }

      const snap = await runsQuery.get();

      const rows = await Promise.all(
        snap.docs.map(async (doc) => {
          const runData = doc.data() as Record<string, unknown>;
          const runId = toSafeString(runData.id) || doc.id;

          const answersSnap = await this.answers
            .where('runId', '==', runId)
            .get();

          const respostas = answersSnap.docs
            .map((answerDoc) => {
              const answer = answerDoc.data() as Record<string, unknown>;
              const normalized = normalizeAnswerValue(answer.value);
              return {
                id: toSafeString(answer.id) || answerDoc.id,
                runId,
                questionId: toSafeString(answer.questionId),
                questionLabel: toSafeString(answer.questionLabel),
                value: answer.value,
                valueNormalized: normalized,
                problemDescription: toSafeString(answer.problemDescription),
                photoUrls: Array.isArray(answer.photoUrls)
                  ? answer.photoUrls.filter(
                      (url: unknown): url is string => typeof url === 'string',
                    )
                  : [],
                answeredAt: toSafeString(answer.answeredAt),
              };
            })
            .sort(
              (a, b) => toSafeMillis(b.answeredAt) - toSafeMillis(a.answeredAt),
            );

          const totalOk = respostas.filter(
            (resposta) => resposta.valueNormalized === 'sim',
          ).length;
          const totalNao = respostas.filter(
            (resposta) => resposta.valueNormalized === 'nao',
          ).length;

          return {
            ...runData,
            id: runId,
            startedAt: runData.startedAt ?? null,
            chassis: toSafeString(runData.chassis),
            operadorNome: toSafeString(runData.operadorNome),
            resumo: {
              totalPerguntas: respostas.length,
              totalOk,
              totalNao,
            },
            respostas,
          };
        }),
      );

      let filteredRows = rows;
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


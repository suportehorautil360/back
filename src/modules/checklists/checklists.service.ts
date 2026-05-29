import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { FirebaseService } from '../../config/firebase.service';
import { EmergenciesService } from '../emergencies/emergencies.service';
import {
  AnswerChecklistQuestionDto,
  ChecklistRuleActionDto,
} from './dto/answer-checklist-question.dto';
import { CreateChecklistRunDto } from './dto/create-checklist-run.dto';
import { ChecklistFlowService } from './checklist-flow.service';

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
    const id = uuid();
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
      id: uuid(),
      runId,
      questionId: dto.questionId,
      questionLabel: dto.questionLabel ?? null,
      value: dto.value,
      problemDescription: dto.problemDescription ?? null,
      photoUrls: Array.isArray(dto.photoUrls) ? dto.photoUrls : [],
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

  private async createEmergencyFromAction(
    run: Record<string, unknown>,
    answer: AnswerChecklistQuestionDto,
    action: Extract<ChecklistRuleActionDto, { type: 'CREATE_EMERGENCY' }>,
  ) {
    const created = await this.emergencies.create({
      prefeituraId: String(run.prefeituraId ?? ''),
      source: 'checklist_auto',
      severity: action.severity ?? 'critical',
      equipamentoId: String(run.equipamentoId ?? ''),
      chassis: String(run.chassis ?? ''),
      operadorNome: String(run.operadorNome ?? ''),
      tipoFalha: action.failureType,
      descricao:
        action.description ??
        answer.problemDescription ??
        `Emergência gerada pela pergunta: ${answer.questionLabel ?? answer.questionId}`,
      fotos: answer.photoUrls,
      checklistRunId: String(run.id ?? ''),
      checklistId: String(run.definitionId ?? ''),
      questionId: answer.questionId,
      questionLabel: answer.questionLabel ?? null,
      answerValue: answer.value,
    });
    return created.data;
  }
}

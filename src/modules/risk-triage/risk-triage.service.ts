import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { FirebaseService } from '../../config/firebase.service';
import {
  classifyRisk,
  extractAnswerRawValue,
  extractProblemDescription,
  getAcaoSugerida,
  getNomeEquipamento,
  getNomeOperador,
  normalizeAnswerValue,
  normalizeText,
  resolveDefeito,
  RiskLevel,
  toDateFilterIso,
  toSafeMillis,
  toSafeString,
} from './helpers/risk-triage.helpers';

type RiskTriageParams = {
  prefeituraId: string;
  startDate?: string;
  endDate?: string;
  chassis?: string;
  operadorNome?: string;
  riskLevel?: RiskLevel;
};

@Injectable()
export class RiskTriageService {
  constructor(private firebase: FirebaseService) {}

  private get runs() {
    return this.firebase.getFirestore().collection('checklistRuns');
  }

  private get answers() {
    return this.firebase.getFirestore().collection('checklistAnswers');
  }

  async listByPrefeitura(params: RiskTriageParams) {
    try {
      const {
        prefeituraId,
        startDate,
        endDate,
        chassis,
        operadorNome,
        riskLevel,
      } = params;

      const startDateIso = toDateFilterIso(startDate);
      const endDateIso = toDateFilterIso(endDate);
      const chassisTerm = normalizeText(chassis);
      const operadorTerm = normalizeText(operadorNome);
      const riskLevelTerm = normalizeText(riskLevel) as RiskLevel | '';

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

          const respostas = answersSnap.docs.map((answerDoc) => {
            const answer = answerDoc.data() as Record<string, unknown>;
            const rawValue = extractAnswerRawValue(answer.value);
            const normalized = normalizeAnswerValue(answer.value);
            return {
              id: toSafeString(answer.id) || answerDoc.id,
              runId,
              questionId: toSafeString(answer.questionId),
              questionLabel: toSafeString(answer.questionLabel),
              problemDescription: extractProblemDescription(
                answer,
                answer.value,
              ),
              value: rawValue,
              valueNormalized: normalized,
              answeredAt: toSafeString(answer.answeredAt),
            };
          });

          const totalNao = respostas.filter(
            (r) => r.valueNormalized === 'nao',
          ).length;
          const risco = classifyRisk(totalNao);
          const primeiraFalha = respostas.find(
            (r) => r.valueNormalized === 'nao',
          );
          const defeito = resolveDefeito({
            questionId: primeiraFalha?.questionId,
            questionLabel: primeiraFalha?.questionLabel,
            problemDescription: primeiraFalha?.problemDescription,
          });

          return {
            id: runId,
            prefeituraId: toSafeString(runData.prefeituraId),
            chassis: toSafeString(runData.chassis),
            nomeEquipamento: getNomeEquipamento(runData),
            nomeOperador: getNomeOperador(runData),
            defeito,
            acaoSugerida: getAcaoSugerida(runData, totalNao),
            startedAt: runData.startedAt ?? null,
            risco: risco.nivel,
            prioridadeRisco: risco.prioridade,
            totalNao,
          };
        }),
      );

      let filteredRows = rows;
      if (chassisTerm) {
        filteredRows = filteredRows.filter((row) =>
          normalizeText(row.chassis).includes(chassisTerm),
        );
      }
      if (operadorTerm) {
        filteredRows = filteredRows.filter((row) =>
          normalizeText(row.nomeOperador).includes(operadorTerm),
        );
      }
      if (
        riskLevelTerm === 'alto' ||
        riskLevelTerm === 'medio' ||
        riskLevelTerm === 'baixo'
      ) {
        filteredRows = filteredRows.filter(
          (row) => row.risco === riskLevelTerm,
        );
      }

      filteredRows.sort((a, b) => {
        if (b.prioridadeRisco !== a.prioridadeRisco) {
          return b.prioridadeRisco - a.prioridadeRisco;
        }
        return toSafeMillis(b.startedAt) - toSafeMillis(a.startedAt);
      });

      const data = filteredRows.map((row) => ({
        risco: row.risco,
        nomeEquipamento: row.nomeEquipamento,
        defeito: row.defeito,
        nomeOperador: row.nomeOperador,
        acaoSugerida: row.acaoSugerida,
      }));

      return {
        data,
        message: 'Triagem de risco carregada.',
      };
    } catch (error) {
      console.error('Erro ao listar triagem de risco:', error);
      throw new InternalServerErrorException(
        'Nao foi possivel carregar a triagem de risco.',
      );
    }
  }
}

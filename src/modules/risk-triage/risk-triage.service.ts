import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { FirebaseService } from '../../config/firebase.service';
import {
  classifyRisk,
  extractAnswerRawValue,
  extractProblemDescription,
  getAcaoSugerida,
  getNomeEquipamento,
  getNomeOperador,
  isAnswerImpeditivo,
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

  private get equipamentos() {
    return this.firebase.getFirestore().collection('equipamentos');
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

      const [snap, equipamentosSnap] = await Promise.all([
        runsQuery.get(),
        this.equipamentos.where('prefeituraId', '==', prefeituraId).get(),
      ]);

      const equipamentos = equipamentosSnap.docs.map((doc) => {
        const data = doc.data() as Record<string, unknown>;
        return {
          docId: doc.id,
          id: toSafeString(data.id),
          chassis: toSafeString(data.chassis),
          tipo: toSafeString(data.tipo),
          nome:
            toSafeString(data.descricao) ||
            toSafeString(data.modelo) ||
            toSafeString(data.tipo),
        };
      });
      const equipamentoPorId = new Map<string, (typeof equipamentos)[number]>();
      const equipamentoPorChassis = new Map<
        string,
        (typeof equipamentos)[number]
      >();
      equipamentos.forEach((equipamento) => {
        if (equipamento.docId) {
          equipamentoPorId.set(equipamento.docId, equipamento);
        }
        if (equipamento.id) equipamentoPorId.set(equipamento.id, equipamento);
        const chassisNormalizado = normalizeText(equipamento.chassis);
        if (chassisNormalizado) {
          equipamentoPorChassis.set(chassisNormalizado, equipamento);
        }
      });

      const rows = await Promise.all(
        snap.docs.map(async (doc) => {
          const runData = doc.data() as Record<string, unknown>;
          const runId = toSafeString(runData.id) || doc.id;
          const chassisRun = toSafeString(runData.chassis);
          const equipamento =
            equipamentoPorId.get(toSafeString(runData.equipamentoId)) ??
            equipamentoPorChassis.get(normalizeText(chassisRun));

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
              impeditivo: isAnswerImpeditivo(answer),
              answeredAt: toSafeString(answer.answeredAt),
            };
          });

          const totalNao = respostas.filter(
            (r) => r.valueNormalized === 'nao',
          ).length;
          const generatedEmergencyIds = Array.isArray(
            runData.generatedEmergencyIds,
          )
            ? runData.generatedEmergencyIds
            : [];
          // Impeditivo no answer OU emergência/bloqueio no run → risco Alto.
          // Assim o item vai para triagem mesmo quando só abriu emergência.
          const temImpeditivo =
            respostas.some(
              (r) => r.valueNormalized === 'nao' && r.impeditivo,
            ) ||
            generatedEmergencyIds.length > 0 ||
            Boolean(toSafeString(runData.blockReason)) ||
            toSafeString(runData.status) === 'blocked';
          const risco = classifyRisk(totalNao, { temImpeditivo });
          // Prefere o primeiro "Não" impeditivo como defeito principal.
          const primeiraFalha =
            respostas.find(
              (r) => r.valueNormalized === 'nao' && r.impeditivo,
            ) ?? respostas.find((r) => r.valueNormalized === 'nao');
          const defeito = resolveDefeito({
            questionId: primeiraFalha?.questionId,
            questionLabel: primeiraFalha?.questionLabel,
            problemDescription: primeiraFalha?.problemDescription,
          });

          return {
            id: runId,
            prefeituraId: toSafeString(runData.prefeituraId),
            chassis: chassisRun || equipamento?.chassis || '',
            nomeEquipamento:
              equipamento?.nome || getNomeEquipamento(runData),
            tipoEquipamento:
              equipamento?.tipo ||
              toSafeString(runData.tipoEquipamento) ||
              toSafeString(runData.tipo) ||
              toSafeString(runData.categoria),
            nomeOperador: getNomeOperador(runData),
            defeito,
            acaoSugerida: getAcaoSugerida(runData, totalNao, {
              temImpeditivo,
            }),
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
        tipoEquipamento: row.tipoEquipamento,
        chassis: row.chassis,
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

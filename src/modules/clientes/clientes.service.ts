import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { FirebaseService } from '../../config/firebase.service';
import { ClienteOverviewRow, TipoClienteApi } from './clientes.types';

/** Converte um campo solto do Firestore (unknown) em string segura. */
function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor : '';
}

@Injectable()
export class ClientesService {
  constructor(private firebaseService: FirebaseService) {}

  /**
   * Lista todos os clientes contratantes com métricas agregadas por cliente:
   * frota ativa, em manutenção e checklists. Custo e O.S. ficam zerados até a
   * fonte desses números ser definida. As coleções são lidas no servidor
   * (firebase-admin), então o front não toca no Firestore direto.
   */
  async overview(): Promise<{ data: ClienteOverviewRow[] }> {
    const db = this.firebaseService.getFirestore();

    try {
      const [clientesSnap, equipamentosSnap, checklistsSnap] =
        await Promise.all([
          db.collection('clientes').get(),
          db.collection('equipamentos').get(),
          db.collection('checklists').get(),
        ]);

      // Agrupa equipamentos por cliente (prefeituraId): ativos x manutenção.
      const frotaPorCliente = new Map<
        string,
        { ativos: number; emManutencao: number }
      >();
      for (const doc of equipamentosSnap.docs) {
        const d = doc.data() as Record<string, unknown>;
        const clienteId = texto(d.prefeituraId);
        if (!clienteId) continue;
        const atual = frotaPorCliente.get(clienteId) ?? {
          ativos: 0,
          emManutencao: 0,
        };
        const status = texto(d.status).toLowerCase();
        if (status === 'ativo') atual.ativos += 1;
        if (status === 'manutencao' || status === 'manutenção')
          atual.emManutencao += 1;
        frotaPorCliente.set(clienteId, atual);
      }

      // Conta checklists por cliente.
      const checklistsPorCliente = new Map<string, number>();
      for (const doc of checklistsSnap.docs) {
        const d = doc.data() as Record<string, unknown>;
        const clienteId = texto(d.prefeituraId);
        if (!clienteId) continue;
        checklistsPorCliente.set(
          clienteId,
          (checklistsPorCliente.get(clienteId) ?? 0) + 1,
        );
      }

      const data: ClienteOverviewRow[] = clientesSnap.docs.map((doc) => {
        const d = doc.data() as Record<string, unknown>;
        const id = doc.id;
        const frota = frotaPorCliente.get(id) ?? { ativos: 0, emManutencao: 0 };
        const tipoCliente: TipoClienteApi =
          d.tipoCliente === 'locacao' ? 'locacao' : 'prefeitura';

        return {
          id,
          nome: texto(d.nome),
          uf: texto(d.uf),
          tipoCliente,
          ativos: frota.ativos,
          emManutencao: frota.emManutencao,
          checklists: checklistsPorCliente.get(id) ?? 0,
          custoAcumulado: 0,
          osCotacao: 0,
          osNfPagamento: 0,
        };
      });

      return { data };
    } catch (error) {
      console.error('Erro ao montar overview de clientes:', error);
      throw new InternalServerErrorException(
        'Não foi possível carregar os clientes.',
      );
    }
  }
}

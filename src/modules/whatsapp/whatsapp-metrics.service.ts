import { Injectable } from '@nestjs/common';
import { FirebaseService } from '../../config/firebase.service';
import {
  contarEmpresasComWhats,
  ultimosDias,
  type ConfigWhats,
  type EventoWhats,
  type StatusEventoWhats,
  type TipoEventoWhats,
} from './whatsapp-metrics';

/** Persistência das métricas do Hub WhatsApp (stats diários, eventos, empresas). */
@Injectable()
export class WhatsAppMetricsService {
  constructor(private firebase: FirebaseService) {}

  private get db() {
    return this.firebase.getFirestore();
  }

  private diaId(d = new Date()): string {
    return d.toISOString().slice(0, 10);
  }

  async incrementarMensagens(qtd = 1): Promise<void> {
    await this.db
      .collection('whatsappStats')
      .doc(this.diaId())
      .set(
        { mensagens: this.firebase.FieldValue.increment(qtd) },
        { merge: true },
      );
  }

  async mensagensHoje(): Promise<number> {
    const snap = await this.db
      .collection('whatsappStats')
      .doc(this.diaId())
      .get();
    return (snap.data() as { mensagens?: number } | undefined)?.mensagens ?? 0;
  }

  async mensagens30d(agora = new Date()): Promise<number> {
    const refs = ultimosDias(30, agora).map((d) =>
      this.db.collection('whatsappStats').doc(d),
    );
    const snaps = await this.db.getAll(...refs);
    return snaps.reduce(
      (acc, s) =>
        acc + ((s.data() as { mensagens?: number } | undefined)?.mensagens ?? 0),
      0,
    );
  }

  async registrarEvento(
    tipo: TipoEventoWhats,
    status: StatusEventoWhats,
  ): Promise<void> {
    await this.db.collection('whatsappEvents').add({
      tipo,
      status,
      timestamp: new Date().toISOString(),
    });
  }

  async eventosRecentes(limite = 20): Promise<EventoWhats[]> {
    const snap = await this.db
      .collection('whatsappEvents')
      .orderBy('timestamp', 'desc')
      .limit(limite)
      .get();
    return snap.docs.map((d) => {
      const data = d.data() as Omit<EventoWhats, 'id'>;
      return { id: d.id, ...data };
    });
  }

  async eventosJanela(
    janelaDias = 30,
    agora = new Date(),
  ): Promise<{ tipo: TipoEventoWhats; timestamp: string }[]> {
    const desde = new Date(
      agora.getTime() - janelaDias * 86_400_000,
    ).toISOString();
    const snap = await this.db
      .collection('whatsappEvents')
      .where('timestamp', '>=', desde)
      .orderBy('timestamp', 'asc')
      .get();
    return snap.docs.map((d) => {
      const data = d.data() as { tipo: TipoEventoWhats; timestamp: string };
      return { tipo: data.tipo, timestamp: data.timestamp };
    });
  }

  async contarEmpresasUtilizando(): Promise<number> {
    const snap = await this.db.collection('configuracoes').get();
    return contarEmpresasComWhats(snap.docs.map((d) => d.data() as ConfigWhats));
  }
}

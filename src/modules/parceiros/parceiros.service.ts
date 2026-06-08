import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { FirebaseService } from '../../config/firebase.service';
import {
  OficinaParceiro,
  ParceirosOverview,
  PostoParceiro,
} from './parceiros.types';

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor : '';
}

/** "Ativa"/"ativo" => true; "Suspensa"/etc => false. */
function ehAtivo(status: unknown): boolean {
  return texto(status).toLowerCase().startsWith('ativ');
}

@Injectable()
export class ParceirosService {
  constructor(private firebaseService: FirebaseService) {}

  /**
   * Rede de parceiros credenciados (todos os clientes): postos e oficinas.
   * A cidade/UF do parceiro vem do cliente vinculado (`prefeituraId`); para
   * postos, usa o `cidadeUf` próprio quando existir.
   */
  async overview(): Promise<{ data: ParceirosOverview }> {
    const db = this.firebaseService.getFirestore();
    try {
      const [clientesSnap, postosSnap, oficinasSnap] = await Promise.all([
        db.collection('clientes').get(),
        db.collection('postos').get(),
        db.collection('oficinas').get(),
      ]);

      const clientePorId = new Map<string, { nome: string; uf: string }>();
      for (const doc of clientesSnap.docs) {
        const d = doc.data() as Record<string, unknown>;
        clientePorId.set(doc.id, { nome: texto(d.nome), uf: texto(d.uf) });
      }

      const localDoCliente = (prefeituraId: string): string => {
        const c = clientePorId.get(prefeituraId);
        if (!c || !c.nome) return '';
        return c.uf ? `${c.nome}/${c.uf}` : c.nome;
      };

      const postos: PostoParceiro[] = postosSnap.docs.map((doc) => {
        const d = doc.data() as Record<string, unknown>;
        const cidadeUf =
          texto(d.cidadeUf) || localDoCliente(texto(d.prefeituraId));
        return {
          id: doc.id,
          nome: texto(d.nomeFantasia) || texto(d.razaoSocial) || '—',
          cidadeUf,
          bandeira: texto(d.bandeira),
          ativo: ehAtivo(d.status ?? 'Ativa'),
        };
      });

      const oficinas: OficinaParceiro[] = oficinasSnap.docs.map((doc) => {
        const d = doc.data() as Record<string, unknown>;
        return {
          id: doc.id,
          nome: texto(d.nome) || '—',
          cidadeUf: localDoCliente(texto(d.prefeituraId)),
          especialidade: texto(d.especialidade),
          ativo: ehAtivo(d.status ?? 'Ativa'),
        };
      });

      postos.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
      oficinas.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

      return { data: { postos, oficinas } };
    } catch (error) {
      console.error('Erro ao montar overview de parceiros:', error);
      throw new InternalServerErrorException(
        'Não foi possível carregar os parceiros.',
      );
    }
  }
}

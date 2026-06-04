import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirebaseService } from '../../config/firebase.service';
import { formatD } from './afd';
import {
  montarAEJ,
  type EmpresaAEJ,
  type HorarioAEJ,
  type LedgerAEJ,
  type PtrpAEJ,
  type ResultadoAEJ,
} from './aej';
import {
  assinaturaConfigurada,
  assinarP7sDestacado,
  carregarCertificado,
} from './afd-signer';

interface EmpresaDoc {
  razaoSocial?: string;
  cnpj?: string;
  caepf?: string;
}
interface EscalaDoc {
  inicio?: string;
  fim?: string;
  almocoMinutos?: number;
}

@Injectable()
export class AejService {
  constructor(
    private firebase: FirebaseService,
    private config: ConfigService,
  ) {}

  private ptrp(): PtrpAEJ {
    return {
      nome: this.config.get<string>('AEJ_PTRP_NOME') ?? 'Hora Útil 360',
      versao: this.config.get<string>('AEJ_PTRP_VERSAO') ?? '1.0',
      tpIdtDesenv:
        (this.config.get<string>('AEJ_PTRP_DESENV_TIPO') as '1' | '2') ?? '1',
      documento: this.config.get<string>('AEJ_PTRP_DESENV_DOC') ?? '',
      razaoNome:
        this.config.get<string>('AEJ_PTRP_DESENV_NOME') ?? 'Hora Útil 360',
      email: this.config.get<string>('AEJ_PTRP_DESENV_EMAIL') ?? '',
    };
  }

  /** Minutos de jornada a partir da escala (fim − início − almoço). */
  private durJornada(esc: EscalaDoc): number {
    const min = (hm?: string) => {
      const [h, m] = (hm ?? '').split(':').map(Number);
      return (h || 0) * 60 + (m || 0);
    };
    return Math.max(0, min(esc.fim) - min(esc.inicio) - (esc.almocoMinutos ?? 0));
  }

  private assinar(aej: ResultadoAEJ): ResultadoAEJ {
    if (!assinaturaConfigurada(this.config)) return aej;
    try {
      const cred = carregarCertificado(
        this.config.get<string>('AFD_CERT_PFX_BASE64') ?? '',
        this.config.get<string>('AFD_CERT_PFX_PASSWORD') ?? '',
      );
      const p7s = assinarP7sDestacado(aej.conteudo, cred);
      return { ...aej, assinado: true, assinaturaP7sBase64: p7s.toString('base64') };
    } catch (e) {
      console.error('Erro ao assinar o AEJ:', e);
      throw new InternalServerErrorException(
        `Não foi possível assinar o AEJ com o certificado configurado: ${
          e instanceof Error ? e.message : 'erro desconhecido'
        }`,
      );
    }
  }

  /** Gera o AEJ (tratado) da prefeitura no período [de, ate] (YYYY-MM-DD). */
  async gerar(
    prefeituraId: string,
    de?: string,
    ate?: string,
  ): Promise<ResultadoAEJ> {
    const db = this.firebase.getFirestore();

    // A configuração é armazenada com id automático + campo `prefeituraId`
    // (não keyed pelo prefeituraId), então buscamos pela query.
    const cfgSnap = await db
      .collection('configuracoes')
      .where('prefeituraId', '==', prefeituraId)
      .get();
    const empDoc = (cfgSnap.docs[0]?.data()?.empresa as EmpresaDoc) ?? {};
    const cnpj = (empDoc.cnpj ?? '').replace(/\D/g, '');
    const caepf = (empDoc.caepf ?? '').replace(/\D/g, '');
    const razaoSocial = (empDoc.razaoSocial ?? '').trim();
    if (!razaoSocial || (!cnpj && !caepf)) {
      throw new BadRequestException(
        'Dados fiscais do empregador incompletos (razão social e CNPJ ou CAEPF). Preencha em Configurações antes de gerar o AEJ.',
      );
    }
    const empresa: EmpresaAEJ = { razaoSocial, documento: cnpj, caepf };

    try {
      // Horário contratual (escala da prefeitura), se houver.
      const escSnap = await db
        .collection('escalas')
        .where('prefeituraId', '==', prefeituraId)
        .get();
      let horario: HorarioAEJ | null = null;
      if (!escSnap.empty) {
        const esc = escSnap.docs[0].data() as EscalaDoc;
        if (esc.inicio && esc.fim) {
          horario = {
            codigo: 'PADRAO',
            durJornadaMin: this.durJornada(esc),
            entrada1: esc.inicio,
            saida1: esc.fim,
          };
        }
      }

      const snap = await db
        .collection('timeRecords')
        .where('prefeituraId', '==', prefeituraId)
        .get();

      const registros: LedgerAEJ[] = snap.docs
        .map((d) => d.data() as Record<string, unknown>)
        .filter((r) => {
          if (!de && !ate) return true;
          const dia = formatD(r.timestampOriginal as string);
          if (de && dia < de) return false;
          if (ate && dia > ate) return false;
          return true;
        })
        .map((r) => ({
          id: r.id as string,
          registro: (r.registro as LedgerAEJ['registro']) ?? 'original',
          nsr: r.nsr as number | undefined,
          refNsr: (r.refNsr as number | null) ?? null,
          refId: r.refId as string | undefined,
          tipo: r.tipo as string,
          timestampOriginal: r.timestampOriginal as string,
          cpf: (r.cpf as string | null) ?? null,
          name: (r.name as string) ?? '',
          aplicado: r.aplicado as boolean | undefined,
          motivo: (r.motivo as string | null) ?? null,
        }));

      const aej = montarAEJ({
        empresa,
        inpi: this.config.get<string>('AFD_INPI') ?? '00000000000000000',
        ptrp: this.ptrp(),
        horario,
        registros,
        dataGeracaoIso: new Date().toISOString(),
      });

      return this.assinar(aej);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Erro ao gerar AEJ:', error);
      throw new InternalServerErrorException(
        'Não foi possível gerar o AEJ. Tente novamente mais tarde.',
      );
    }
  }
}

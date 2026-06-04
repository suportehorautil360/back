import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirebaseService } from '../../config/firebase.service';
import {
  formatD,
  montarAFD,
  type EmpresaAFD,
  type FabricanteAFD,
  type MarcacaoAFD,
  type ResultadoAFD,
} from './afd';
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

@Injectable()
export class AfdService {
  constructor(
    private firebase: FirebaseService,
    private config: ConfigService,
  ) {}

  /** Identificação do fabricante/desenvolvedor do REP (placeholder até o INPI). */
  private fabricante(): FabricanteAFD {
    return {
      inpi: this.config.get<string>('AFD_INPI') ?? '00000000000000000',
      tipoDoc:
        (this.config.get<string>('AFD_FABRICANTE_TIPO') as '1' | '2') ?? '1',
      documento: this.config.get<string>('AFD_FABRICANTE_DOC') ?? '',
      modelo: this.config.get<string>('AFD_FABRICANTE_MODELO') ?? '',
    };
  }

  /**
   * Assina o AFD com o certificado ICP-Brasil (se configurado). Sem certificado,
   * devolve sem assinatura (assinado:false) — o `.txt` continua válido para
   * conferência. Certificado configurado mas inválido → erro claro (não engole).
   */
  private assinar(afd: ResultadoAFD): ResultadoAFD {
    if (!assinaturaConfigurada(this.config)) return afd;
    try {
      const cred = carregarCertificado(
        this.config.get<string>('AFD_CERT_PFX_BASE64') ?? '',
        this.config.get<string>('AFD_CERT_PFX_PASSWORD') ?? '',
      );
      const p7s = assinarP7sDestacado(afd.conteudo, cred);
      return { ...afd, assinado: true, assinaturaP7sBase64: p7s.toString('base64') };
    } catch (e) {
      console.error('Erro ao assinar o AFD:', e);
      throw new InternalServerErrorException(
        `Não foi possível assinar o AFD com o certificado configurado: ${
          e instanceof Error ? e.message : 'erro desconhecido'
        }`,
      );
    }
  }

  /**
   * Gera o AFD (REP-P) da prefeitura no período [de, ate] (YYYY-MM-DD locais,
   * opcionais). Inclui apenas marcações `original` (cruas), ordenadas por NSR.
   */
  async gerar(
    prefeituraId: string,
    de?: string,
    ate?: string,
  ): Promise<ResultadoAFD> {
    const db = this.firebase.getFirestore();

    // Empregador (configuracoes). Sem razão social + (CNPJ ou CAEPF) o AFD não
    // identifica o empregador — barra com 400 (Portaria 671).
    // A configuração é armazenada com id automático + campo `prefeituraId`
    // (não keyed pelo prefeituraId), então buscamos pela query.
    const cfgSnap = await db
      .collection('configuracoes')
      .where('prefeituraId', '==', prefeituraId)
      .get();
    const empresaDoc =
      ((cfgSnap.docs[0]?.data()?.empresa as EmpresaDoc) ?? {}) as EmpresaDoc;
    const cnpj = (empresaDoc.cnpj ?? '').replace(/\D/g, '');
    const caepf = (empresaDoc.caepf ?? '').replace(/\D/g, '');
    const razaoSocial = (empresaDoc.razaoSocial ?? '').trim();
    if (!razaoSocial || (!cnpj && !caepf)) {
      throw new BadRequestException(
        'Dados fiscais do empregador incompletos (razão social e CNPJ ou CAEPF). Preencha em Configurações antes de gerar o AFD.',
      );
    }
    const empresa: EmpresaAFD = {
      razaoSocial,
      documento: cnpj,
      caepf,
    };

    try {
      const snap = await db
        .collection('timeRecords')
        .where('prefeituraId', '==', prefeituraId)
        .get();

      const marcacoes: MarcacaoAFD[] = snap.docs
        .map((d) => d.data() as Record<string, unknown>)
        .filter((r) => (r.registro ?? 'original') === 'original')
        .filter((r) => typeof r.nsr === 'number')
        .filter((r) => {
          if (!de && !ate) return true;
          const dia = formatD(r.timestampOriginal as string); // data local SP
          if (de && dia < de) return false;
          if (ate && dia > ate) return false;
          return true;
        })
        .map((r) => ({
          nsr: r.nsr as number,
          timestampOriginal: r.timestampOriginal as string,
          cpf: (r.cpf as string | null) ?? null,
          createdAt: (r.createdAt as string) ?? (r.timestampOriginal as string),
        }));

      const afd = montarAFD({
        empresa,
        fabricante: this.fabricante(),
        marcacoes,
        dataGeracaoIso: new Date().toISOString(),
      });

      return this.assinar(afd);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Erro ao gerar AFD:', error);
      throw new InternalServerErrorException(
        'Não foi possível gerar o AFD. Tente novamente mais tarde.',
      );
    }
  }
}

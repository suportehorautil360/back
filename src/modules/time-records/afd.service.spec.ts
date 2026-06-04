import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as forge from 'node-forge';
import { AfdService } from './afd.service';
import { FirebaseService } from '../../config/firebase.service';

/** PFX autoassinado (base64) só para teste — substitui o ICP real. */
function gerarPfxBase64(senha: string): string {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date('2026-01-01T00:00:00Z');
  cert.validity.notAfter = new Date('2030-01-01T00:00:00Z');
  const attrs = [{ name: 'commonName', value: 'Teste' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], senha, {
    algorithm: '3des',
  });
  return forge.util.encode64(forge.asn1.toDer(p12).getBytes());
}

/** Mock do Firestore: roteia por nome de coleção. */
function makeFirebase(
  empresa: Record<string, unknown> | undefined,
  timeRecords: Record<string, unknown>[],
) {
  const collection = jest.fn((name: string) => {
    if (name === 'configuracoes') {
      return {
        where: () => ({
          get: async () => ({ docs: [{ data: () => ({ empresa }) }] }),
        }),
      };
    }
    // timeRecords
    return {
      where: () => ({
        get: async () => ({ docs: timeRecords.map((d) => ({ data: () => d })) }),
      }),
    };
  });
  return {
    getFirestore: () => ({ collection }),
  } as unknown as FirebaseService;
}

const config = { get: () => undefined } as unknown as ConfigService;

const empresaOk = { razaoSocial: 'ABC Ltda.', cnpj: '11.222.333/0001-81' };

describe('AfdService', () => {
  it('barra (400) quando o empregador está incompleto', async () => {
    const svc = new AfdService(makeFirebase({ razaoSocial: '' }, []), config);
    await expect(svc.gerar('pref-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('gera o AFD com as marcações original ordenadas por NSR', async () => {
    const svc = new AfdService(
      makeFirebase(empresaOk, [
        {
          registro: 'original',
          nsr: 2,
          timestampOriginal: '2026-05-25T18:00:00Z',
          cpf: '12345678901',
          createdAt: '2026-05-25T18:00:00Z',
        },
        {
          registro: 'original',
          nsr: 1,
          timestampOriginal: '2026-05-25T11:00:00Z',
          cpf: '12345678901',
          createdAt: '2026-05-25T11:00:00Z',
        },
        // ajuste deve ser ignorado no AFD (é tratamento → AEJ).
        {
          registro: 'ajuste',
          nsr: 3,
          timestampOriginal: '2026-05-25T12:00:00Z',
          cpf: '12345678901',
          createdAt: '2026-05-25T12:00:00Z',
        },
      ]),
      config,
    );

    const r = await svc.gerar('pref-1');
    expect(r.totalMarcacoes).toBe(2); // ajuste fora
    const linhas = r.conteudo.split('\r\n');
    expect(linhas[1].slice(0, 9)).toBe('000000001');
    expect(linhas[2].slice(0, 9)).toBe('000000002');
    expect(linhas[1][9]).toBe('7'); // tipo 7
  });

  it('filtra por período (de/ate) na data local da marcação', async () => {
    const svc = new AfdService(
      makeFirebase(empresaOk, [
        {
          registro: 'original',
          nsr: 1,
          timestampOriginal: '2026-05-10T11:00:00Z',
          cpf: '12345678901',
          createdAt: '2026-05-10T11:00:00Z',
        },
        {
          registro: 'original',
          nsr: 2,
          timestampOriginal: '2026-05-25T11:00:00Z',
          cpf: '12345678901',
          createdAt: '2026-05-25T11:00:00Z',
        },
      ]),
      config,
    );

    const r = await svc.gerar('pref-1', '2026-05-20', '2026-05-31');
    expect(r.totalMarcacoes).toBe(1);
  });

  it('sem certificado configurado, retorna assinado:false', async () => {
    const svc = new AfdService(
      makeFirebase(empresaOk, [
        {
          registro: 'original',
          nsr: 1,
          timestampOriginal: '2026-05-25T11:00:00Z',
          cpf: '12345678901',
          createdAt: '2026-05-25T11:00:00Z',
        },
      ]),
      config,
    );
    const r = await svc.gerar('pref-1');
    expect(r.assinado).toBe(false);
    expect(r.assinaturaP7sBase64).toBeUndefined();
  });

  it('com certificado configurado, assina e devolve o .p7s em base64', async () => {
    const senha = 'segredo';
    const pfx = gerarPfxBase64(senha);
    const cfgComCert = {
      get: (k: string) =>
        k === 'AFD_CERT_PFX_BASE64'
          ? pfx
          : k === 'AFD_CERT_PFX_PASSWORD'
            ? senha
            : undefined,
    } as unknown as ConfigService;

    const svc = new AfdService(
      makeFirebase(empresaOk, [
        {
          registro: 'original',
          nsr: 1,
          timestampOriginal: '2026-05-25T11:00:00Z',
          cpf: '12345678901',
          createdAt: '2026-05-25T11:00:00Z',
        },
      ]),
      cfgComCert,
    );
    const r = await svc.gerar('pref-1');
    expect(r.assinado).toBe(true);
    expect(typeof r.assinaturaP7sBase64).toBe('string');
    // O base64 decodifica para um PKCS#7 SignedData.
    const der = forge.util.decode64(r.assinaturaP7sBase64 as string);
    const p7 = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(der));
    expect(p7.type).toBe(forge.pki.oids.signedData);
  });
});

import { ConfigService } from '@nestjs/config';
import * as forge from 'node-forge';
import {
  assinarP7sDestacado,
  assinaturaConfigurada,
  carregarCertificado,
} from './afd-signer';

/** Gera um PFX autoassinado (base64) só para teste — substitui o ICP real. */
export function gerarPfxBase64(senha: string): string {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date('2026-01-01T00:00:00Z');
  cert.validity.notAfter = new Date('2030-01-01T00:00:00Z');
  const attrs = [
    { name: 'commonName', value: 'Teste HU360' },
    { name: 'organizationName', value: 'HU360' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], senha, {
    algorithm: '3des',
  });
  return forge.util.encode64(forge.asn1.toDer(p12).getBytes());
}

function parsearP7s(buf: Buffer): forge.pkcs7.PkcsSignedData {
  const asn1 = forge.asn1.fromDer(forge.util.createBuffer(buf.toString('binary')));
  return forge.pkcs7.messageFromAsn1(asn1) as forge.pkcs7.PkcsSignedData;
}

describe('afd-signer', () => {
  it('assinaturaConfigurada reflete a env AFD_CERT_PFX_BASE64', () => {
    const semCert = { get: () => undefined } as unknown as ConfigService;
    const comCert = {
      get: (k: string) => (k === 'AFD_CERT_PFX_BASE64' ? 'xxx' : undefined),
    } as unknown as ConfigService;
    expect(assinaturaConfigurada(semCert)).toBe(false);
    expect(assinaturaConfigurada(comCert)).toBe(true);
  });

  it('carrega o certificado e produz uma assinatura PKCS#7 destacada válida', () => {
    const senha = 'segredo';
    const pfx = gerarPfxBase64(senha);
    const cred = carregarCertificado(pfx, senha);
    expect(cred.certificado.subject.getField('CN')?.value).toBe('Teste HU360');

    const p7s = assinarP7sDestacado('CONTEUDO-AFD-DE-TESTE\r\n', cred);
    expect(p7s.length).toBeGreaterThan(0);

    const p7 = parsearP7s(p7s);
    expect(p7.type).toBe(forge.pki.oids.signedData);
    expect(p7.certificates.length).toBeGreaterThan(0);
    const cns = p7.certificates.map((c) => c.subject.getField('CN')?.value);
    expect(cns).toContain('Teste HU360');
    // Destacada: tem assinatura, sem embutir o conteúdo.
    expect(p7.rawCapture.signature).toBeTruthy();
  });

  it('senha errada falha ao carregar o certificado', () => {
    const pfx = gerarPfxBase64('certa');
    expect(() => carregarCertificado(pfx, 'errada')).toThrow();
  });
});

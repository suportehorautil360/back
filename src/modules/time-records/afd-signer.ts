/**
 * Assinatura digital do AFD (Portaria 671 §3.3) com certificado ICP-Brasil.
 * Produz a assinatura **destacada** no padrão CMS/PKCS#7 (SHA-256) — o arquivo
 * `.p7s` que acompanha o `.txt` do AFD. Pure-JS via node-forge (sem dependência
 * nativa). O certificado vem como PFX/P12 em base64 (env), ideal p/ deploy
 * efêmero (Railway).
 */
import { ConfigService } from '@nestjs/config';
import * as forge from 'node-forge';

export interface CredencialAFD {
  privateKey: forge.pki.rsa.PrivateKey;
  certificado: forge.pki.Certificate;
  cadeia: forge.pki.Certificate[];
}

/** Há certificado configurado para assinar? */
export function assinaturaConfigurada(config: ConfigService): boolean {
  return !!config.get<string>('AFD_CERT_PFX_BASE64');
}

/** Extrai chave privada + certificado(s) de um PFX/P12 em base64. */
export function carregarCertificado(
  pfxBase64: string,
  senha: string,
): CredencialAFD {
  const der = forge.util.decode64(pfxBase64);
  const asn1 = forge.asn1.fromDer(der);
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, senha);

  // Chave privada (cifrada ou em claro).
  const shrouded = p12.getBags({
    bagType: forge.pki.oids.pkcs8ShroudedKeyBag,
  })[forge.pki.oids.pkcs8ShroudedKeyBag];
  const plain = p12.getBags({ bagType: forge.pki.oids.keyBag })[
    forge.pki.oids.keyBag
  ];
  const keyBag = shrouded?.[0] ?? plain?.[0];
  if (!keyBag?.key) {
    throw new Error('Chave privada não encontrada no certificado (PFX).');
  }

  // Certificados: o titular + cadeia.
  const certBags =
    p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ??
    [];
  const certs = certBags
    .map((b) => b.cert)
    .filter((c): c is forge.pki.Certificate => !!c);
  if (!certs.length) {
    throw new Error('Certificado não encontrado no PFX.');
  }

  return {
    privateKey: keyBag.key as forge.pki.rsa.PrivateKey,
    certificado: certs[0],
    cadeia: certs.slice(1),
  };
}

/**
 * Assina `conteudo` (bytes latin1) e devolve a assinatura **destacada** em DER
 * (o conteúdo do `.p7s`). PKCS#7 SignedData, digest SHA-256, com atributos
 * autenticados (contentType, messageDigest, signingTime) e a cadeia de certs.
 */
export function assinarP7sDestacado(
  conteudo: string,
  cred: CredencialAFD,
): Buffer {
  const p7 = forge.pkcs7.createSignedData();
  // Encoding padrão do forge é 'raw' (1 char = 1 byte) — correto p/ latin1.
  p7.content = forge.util.createBuffer(conteudo);
  p7.addCertificate(cred.certificado);
  for (const c of cred.cadeia) p7.addCertificate(c);
  p7.addSigner({
    key: cred.privateKey,
    certificate: cred.certificado,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date().toString() },
    ],
  });
  // Destacada: a assinatura não embute o conteúdo (que vai no .txt à parte).
  p7.sign({ detached: true });
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return Buffer.from(der, 'binary');
}

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  extractAccessKeys,
  inferNotaFiscalCategory,
  parseAccessKeyFields,
  parseDanfePdf,
  parseDanfeText,
} from './parse-danfe-pdf.helper';

const DEMO_POSTO_PDF = join(
  __dirname,
  '..',
  'fixtures',
  'danfe_posto_combustivel_demo.pdf',
);
const DEMO_POSTO_EXTRACTED = join(
  __dirname,
  '..',
  'fixtures',
  'danfe_posto_combustivel_demo.extracted.txt',
);
const DEMO_POSTO_EXPECTED = join(
  __dirname,
  '..',
  'fixtures',
  'danfe_posto_combustivel_demo.expected.json',
);
const SAMPLE_XML = `
<nfeProc>
  <NFe>
    <infNFe Id="NFe35260612345678000190550010000045121001234567">
      <ide><mod>55</mod><nNF>004512</nNF><dhEmi>2026-06-03T10:00:00-03:00</dhEmi></ide>
      <emit><xNome>Oficina Mecânica Silva Ltda</xNome></emit>
      <det><prod><xProd>Serviços em retroescavadeira CAT 416</xProd></prod></det>
      <total><ICMSTot><vNF>3420.00</vNF></ICMSTot></total>
    </infNFe>
  </NFe>
  <protNFe><infProt><chNFe>35260612345678000190550010000045121001234567</chNFe></infProt></protNFe>
</nfeProc>
`;

describe('parse-danfe-pdf.helper', () => {
  it('extrai campos da chave de acesso', () => {
    expect(
      parseAccessKeyFields(
        '35260612345678000190550010000045121001234567',
      ),
    ).toMatchObject({
      documentType: 'nfe-55',
      number: '4512',
    });
  });

  it('encontra chaves de 44 dígitos no texto', () => {
    expect(
      extractAccessKeys(
        'CHAVE DE ACESSO 3526 0612 3456 7800 0190 5500 1000 0045 1210 0123 4567',
      ),
    ).toContain('35260612345678000190550010000045121001234567');
  });

  it('parseia XML embutido no PDF', () => {
    const parsed = parseDanfeText(SAMPLE_XML, 'NFe004512.pdf');

    expect(parsed).toMatchObject({
      accessKey: '35260612345678000190550010000045121001234567',
      documentType: 'nfe-55',
      number: '4512',
      issuerName: 'Oficina Mecânica Silva Ltda',
      value: 3420,
      category: 'servico',
      parseCompleteness: 'completo',
    });
    expect(parsed.description).toContain('retroescavadeira');
  });

  it('infere categoria de combustível', () => {
    expect(inferNotaFiscalCategory('Abastecimento diesel S10')).toBe(
      'combustivel',
    );
  });

  it('aceita PDF sem chave com leitura parcial', () => {
    const parsed = parseDanfeText('PDF sem dados fiscais', 'nota-servico.pdf');

    expect(parsed).toMatchObject({
      accessKey: '',
      parseCompleteness: 'parcial',
      description: 'nota servico',
    });
  });

  it('aceita PDF sem texto extraível', () => {
    const parsed = parseDanfeText('', 'NFe004512.pdf');

    expect(parsed.parseCompleteness).toBe('parcial');
    expect(parsed.accessKey).toBe('');
    expect(parsed.description).toBe('NFe004512');
  });

  describe('fixture danfe_posto_combustivel_demo.pdf', () => {
    const expected = JSON.parse(
      readFileSync(DEMO_POSTO_EXPECTED, 'utf8'),
    ) as ReturnType<typeof parseDanfeText>;

    it('parseia o texto extraído do PDF demo de posto', () => {
      const extracted = readFileSync(DEMO_POSTO_EXTRACTED, 'utf8');
      expect(extracted.length).toBeGreaterThan(0);

      const parsed = parseDanfeText(
        extracted,
        'danfe_posto_combustivel_demo.pdf',
      );

      expect(parsed).toMatchObject({
        accessKey: expected.accessKey,
        documentType: expected.documentType,
        number: expected.number,
        value: expected.value,
        parseCompleteness: expected.parseCompleteness,
      });
      expect(parsed.issuerName).toContain('TRANSPORTES');
    });

    it('o PDF demo existe e tem tamanho válido', () => {
      const buffer = readFileSync(DEMO_POSTO_PDF);
      expect(buffer.length).toBeGreaterThan(1000);
      expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
    });
  });

  it('PDF corrompido não lança — devolve leitura parcial', async () => {
    const parsed = await parseDanfePdf(
      Buffer.from('%PDF-1.4 estrutura-invalida'),
      'nota-corrompida.pdf',
    );

    expect(parsed).toMatchObject({
      accessKey: '',
      parseCompleteness: 'parcial',
      description: 'nota corrompida',
    });
  });
});

import { computeCredLevel, type CredChecklist } from './cred-checklist.policy';

const allFalse: CredChecklist = {
  fisc_cndt: false,
  fisc_estadual: false,
  fisc_federal: false,
  fisc_fgts: false,
  fisc_municipal: false,
  hab_balanco: false,
  hab_falencia: false,
  id_cnpj: false,
  id_contrato: false,
  id_endereco: false,
  id_socios: false,
  tec_alvara: false,
  tec_ambiental: false,
  tec_atestado: false,
  tec_avcb: false,
};

const allTrue: CredChecklist = {
  fisc_cndt: true,
  fisc_estadual: true,
  fisc_federal: true,
  fisc_fgts: true,
  fisc_municipal: true,
  hab_balanco: true,
  hab_falencia: true,
  id_cnpj: true,
  id_contrato: true,
  id_endereco: true,
  id_socios: true,
  tec_alvara: true,
  tec_ambiental: true,
  tec_atestado: true,
  tec_avcb: true,
};

describe('computeCredLevel', () => {
  it('retorna PENDING quando nenhum item está completo', () => {
    expect(computeCredLevel(allFalse)).toBe('PENDING');
  });

  it('retorna FULL quando todos os itens estão completos', () => {
    expect(computeCredLevel(allTrue)).toBe('FULL');
  });

  it('retorna PARTIAL quando apenas alguns itens estão completos', () => {
    expect(
      computeCredLevel({ ...allFalse, id_cnpj: true, fisc_federal: true }),
    ).toBe('PARTIAL');
  });
});

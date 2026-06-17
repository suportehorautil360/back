import {
  normalizeOsServiceType,
  osServiceTypeFromFirestore,
  osServiceTypeLabel,
  tipoOsLegacyCode,
} from './os-service-type.helper';

describe('normalizeOsServiceType', () => {
  it('aceita valores explícitos em inglês', () => {
    expect(normalizeOsServiceType('corrective')).toBe('corrective');
    expect(normalizeOsServiceType('preventive')).toBe('preventive');
  });

  it('aceita legado C/P e português', () => {
    expect(normalizeOsServiceType('C')).toBe('corrective');
    expect(normalizeOsServiceType('P')).toBe('preventive');
    expect(normalizeOsServiceType('corretiva')).toBe('corrective');
    expect(normalizeOsServiceType('preventiva')).toBe('preventive');
  });

  it('default corretiva', () => {
    expect(normalizeOsServiceType()).toBe('corrective');
    expect(normalizeOsServiceType('')).toBe('corrective');
  });
});

describe('tipoOsLegacyCode / label', () => {
  it('mapeia para C e P', () => {
    expect(tipoOsLegacyCode('corrective')).toBe('C');
    expect(tipoOsLegacyCode('preventive')).toBe('P');
    expect(osServiceTypeLabel('corrective')).toBe('Corretiva');
  });
});

describe('osServiceTypeFromFirestore', () => {
  it('prefere serviceType e faz fallback em tipoOs', () => {
    expect(
      osServiceTypeFromFirestore({ serviceType: 'preventive', tipoOs: 'C' }),
    ).toBe('preventive');
    expect(osServiceTypeFromFirestore({ tipoOs: 'P' })).toBe('preventive');
    expect(osServiceTypeFromFirestore({ tipoOs: 'C' })).toBe('corrective');
  });
});

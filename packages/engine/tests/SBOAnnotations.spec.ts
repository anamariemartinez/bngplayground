import { describe, it, expect } from 'vitest';
import { inferReactionSBO, inferRateLawSBO, SBO } from '../src/services/export/SBOAnnotations';

describe('inferReactionSBO', () => {
  it('binding rule → SBO:0000177', () => {
    expect(inferReactionSBO({
      reactants: ['A(b)', 'B(a)'],
      products: ['A(b!1).B(a!1)'],
    })).toBe(SBO.BINDING);
  });

  it('phosphorylation rule → SBO:0000216', () => {
    expect(inferReactionSBO({
      reactants: ['A(Y~U)'],
      products: ['A(Y~P)'],
    })).toBe(SBO.PHOSPHORYLATION);
  });

  it('dephosphorylation rule → SBO:0000330', () => {
    expect(inferReactionSBO({
      reactants: ['A(Y~P)'],
      products: ['A(Y~U)'],
    })).toBe(SBO.DEPHOSPHORYLATION);
  });

  it('degradation rule (product = 0) → SBO:0000179', () => {
    expect(inferReactionSBO({
      reactants: ['A()'],
      products: ['0'],
    })).toBe(SBO.DEGRADATION);
  });

  it('synthesis rule (reactant = 0) → SBO:0000393', () => {
    expect(inferReactionSBO({
      reactants: ['0'],
      products: ['A()'],
    })).toBe(SBO.SYNTHESIS);
  });

  it('plain mass-action → SBO:0000012', () => {
    expect(inferReactionSBO({
      reactants: ['A()'],
      products: ['B()'],
    })).toBe(SBO.MASS_ACTION);
  });
});

describe('inferRateLawSBO', () => {
  it('MM rate → SBO:0000028', () => {
    expect(inferRateLawSBO('MM(kcat, Km, S)')).toBe(SBO.MICHAELIS_MENTEN);
  });

  it('Sat rate → SBO:0000028', () => {
    expect(inferRateLawSBO('Sat(kcat, Km)')).toBe(SBO.MICHAELIS_MENTEN);
  });

  it('Hill rate → SBO:0000192', () => {
    expect(inferRateLawSBO('Hill(Vmax, Kd, n, S)')).toBe(SBO.HILL);
  });

  it('plain rate constant → SBO:0000012', () => {
    expect(inferRateLawSBO('kf')).toBe(SBO.MASS_ACTION);
  });

  it('simple expression → SBO:0000012', () => {
    expect(inferRateLawSBO('kf * A')).toBe(SBO.MASS_ACTION);
  });
});

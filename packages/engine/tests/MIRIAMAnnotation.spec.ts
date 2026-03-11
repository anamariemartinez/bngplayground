import { describe, it, expect } from 'vitest';
import {
  generateMIRIAMBlock,
  suggestMIRIAMAnnotations,
  resolveAnnotations,
} from '../src/services/export/MIRIAMAnnotation';
import type { IdentifierResolver } from '../src/services/export/MIRIAMAnnotation';

describe('generateMIRIAMBlock', () => {
  it('generates valid RDF/XML structure', () => {
    const block = generateMIRIAMBlock('species1', [
      {
        qualifierType: 'bqbiol',
        qualifier: 'is',
        resources: ['https://identifiers.org/uniprot:P00533'],
      },
    ]);

    expect(block).toContain('<annotation>');
    expect(block).toContain('</annotation>');
    expect(block).toContain('rdf:RDF');
    expect(block).toContain('bqbiol:is');
    expect(block).toContain('uniprot:P00533');
    expect(block).toContain('rdf:about="#species1"');
  });

  it('handles multiple annotations', () => {
    const block = generateMIRIAMBlock('r1', [
      { qualifierType: 'bqbiol', qualifier: 'is', resources: ['https://identifiers.org/uniprot:P01'] },
      { qualifierType: 'bqbiol', qualifier: 'isVersionOf', resources: ['https://identifiers.org/go/GO:0006468'] },
    ]);

    expect(block).toContain('bqbiol:is');
    expect(block).toContain('bqbiol:isVersionOf');
  });

  it('returns empty string for no annotations', () => {
    expect(generateMIRIAMBlock('test', [])).toBe('');
  });
});

describe('suggestMIRIAMAnnotations', () => {
  it('maps EGFR to UniProt P00533', () => {
    const annotations = suggestMIRIAMAnnotations('EGFR');
    expect(annotations.length).toBeGreaterThan(0);
    const uniprotAnn = annotations.find((a) => a.qualifier === 'is');
    expect(uniprotAnn).toBeDefined();
    expect(uniprotAnn!.resources.some((r) => r.includes('P00533'))).toBe(true);
  });

  it('maps p53 to UniProt P04637', () => {
    const annotations = suggestMIRIAMAnnotations('p53');
    expect(annotations.length).toBeGreaterThan(0);
    expect(annotations[0].resources.some((r) => r.includes('P04637'))).toBe(true);
  });

  it('maps ERK to UniProt P27361', () => {
    const annotations = suggestMIRIAMAnnotations('ERK');
    expect(annotations.some((a) => a.resources.some((r) => r.includes('P27361')))).toBe(true);
  });

  it('maps ATP to CHEBI', () => {
    const annotations = suggestMIRIAMAnnotations('ATP');
    expect(annotations.some((a) => a.resources.some((r) => r.includes('chebi')))).toBe(true);
  });

  it('includes Reactome pathway for EGFR', () => {
    const annotations = suggestMIRIAMAnnotations('EGFR');
    const reactome = annotations.find((a) => a.qualifier === 'isPartOf');
    expect(reactome).toBeDefined();
    expect(reactome!.resources[0]).toContain('reactome');
  });

  it('returns empty for unknown molecule', () => {
    const annotations = suggestMIRIAMAnnotations('XyzUnknown123');
    expect(annotations.length).toBe(0);
  });

  it('case-insensitive lookup works', () => {
    const annotations = suggestMIRIAMAnnotations('egfr');
    expect(annotations.length).toBeGreaterThan(0);
  });

  it('covers multiple pathway modules', () => {
    // Test coverage of different signaling pathways
    for (const name of ['GRB2', 'SOS', 'RAF', 'MEK', 'AKT', 'PTEN', 'BCL2', 'BAX', 'STAT3', 'NFkB']) {
      const anns = suggestMIRIAMAnnotations(name);
      expect(anns.length, `Expected annotation for ${name}`).toBeGreaterThan(0);
    }
  });
});

describe('resolveAnnotations', () => {
  it('uses static dictionary when no resolver given', async () => {
    const result = await resolveAnnotations(['EGFR', 'p53']);
    expect(Object.keys(result)).toEqual(['EGFR', 'p53']);
    expect(result['EGFR'].length).toBeGreaterThan(0);
    expect(result['p53'].length).toBeGreaterThan(0);
  });

  it('uses resolver when provided and returns results', async () => {
    const mockResolver: IdentifierResolver = async (name) => {
      if (name === 'CustomProtein') {
        return [{
          qualifierType: 'bqbiol',
          qualifier: 'is',
          resources: ['https://identifiers.org/uniprot:Q99999'],
        }];
      }
      return null;
    };

    const result = await resolveAnnotations(['CustomProtein', 'EGFR'], mockResolver);
    expect(result['CustomProtein'][0].resources[0]).toContain('Q99999');
    // EGFR should fall back to static since resolver returns null for it
    expect(result['EGFR'][0].resources.some((r) => r.includes('P00533'))).toBe(true);
  });

  it('falls back to static when resolver throws', async () => {
    const failingResolver: IdentifierResolver = async () => {
      throw new Error('Network error');
    };

    const result = await resolveAnnotations(['EGFR'], failingResolver);
    expect(result['EGFR'].length).toBeGreaterThan(0);
  });
});

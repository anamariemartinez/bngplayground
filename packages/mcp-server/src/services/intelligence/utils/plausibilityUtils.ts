import type { PlausibilityCheck } from '../types.js';

export function checkPlausibility(
    parameters: Record<string, number>,
    speciesNames: string[],
    maxChecks: number = 5
): PlausibilityCheck[] {
    const checks: PlausibilityCheck[] = [];

    for (const [name, value] of Object.entries(parameters)) {
        if (checks.length >= maxChecks) break;

        if (Math.abs(value) > 1e12) {
            checks.push({
                parameter: name,
                value,
                issue: 'extreme_magnitude',
                physicalBound: 1e12,
                message: `${name} = ${value.toExponential(1)} — magnitude suggests a unit conversion error.`,
            });
        }
        if (value < 0 && speciesNames.some(s => s.includes(name))) {
            checks.push({
                parameter: name,
                value,
                issue: 'negative_concentration',
                physicalBound: 0,
                message: `${name} = ${value} — negative concentrations are unphysical.`,
            });
        }
    }

    return checks;
}

export function detectCompilationSurprise(
    numRules: number,
    numGeneratedSpecies: number,
    numGeneratedReactions: number
): { ratio: number; level: 'high' | 'moderate' | 'none'; warning?: string } {
    const ratio = numRules > 0 ? numGeneratedSpecies / numRules : 0;
    
    const level = ratio > 50 ? 'high' : ratio > 10 ? 'moderate' : 'none';
    
    let warning: string | undefined;
    if (ratio > 10) {
        warning = `This model has ${numRules} rules but generates ${numGeneratedSpecies} species and ${numGeneratedReactions} reactions. ` +
            (ratio > 50
                ? 'The combinatorial complexity may cause slow simulation. Consider network limits or NFsim.'
                : 'Moderate combinatorial growth. Monitor simulation time.');
    }

    return { ratio, level, warning };
}
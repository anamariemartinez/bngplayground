import { parseModelOrThrow, validateModel } from '../../services/engine.js';
import { formatBNGL } from '@bngplayground/engine';
import type { SuggestedFix } from './types.js';
import { ensureModelEnvelope, insertIntoBlock } from './utils/codeUtils.js';

export function suggestModelFixes(code: string, includeAutoCorrectedCode: boolean): {
    fixes: SuggestedFix[];
    auto_corrected_code?: string;
} {
    const model = parseModelOrThrow(code);
    const validation = validateModel(model, true);

    const fixes: SuggestedFix[] = [];

    if (model.observables.length === 0) {
        fixes.push({
            issue: 'No observables are defined.',
            suggestion: 'Add at least one observable in a begin observables block to inspect simulation output.',
            severity: 'error',
        });
    }

    if ((model.species ?? []).length === 0) {
        fixes.push({
            issue: 'No seed species are defined.',
            suggestion: 'Add seed species with initial concentrations in begin seed species.',
            severity: 'error',
        });
    }

    for (const warning of validation.warnings) {
        fixes.push({
            issue: warning.message,
            suggestion: warning.code === 'UNUSUAL_PARAMETER_MAGNITUDE'
                ? 'Rescale parameters to a numerically stable range when possible.'
                : 'Inspect the referenced model element and adjust the rule/pattern.',
            severity: warning.severity,
        });
    }

    let autoCorrectedCode: string | undefined;
    if (includeAutoCorrectedCode) {
        let candidate = ensureModelEnvelope(code);
        if (model.observables.length === 0) {
            const firstSpecies = model.species[0]?.name ?? 'A()';
            candidate = insertIntoBlock(candidate, 'observables', `Molecules auto_obs ${firstSpecies}`);
        }

        autoCorrectedCode = (() => {
            try {
                return formatBNGL(candidate);
            } catch {
                return candidate;
            }
        })();
    }

    return {
        fixes,
        ...(autoCorrectedCode ? { auto_corrected_code: autoCorrectedCode } : {}),
    };
}
import { sobolSensitivity, simulate, loadEvaluator } from '@bngplayground/engine';
import type { ToolArgs, ToolResult } from '../types/index.js';
import { sobolSensitivityArgsSchema } from '../schemas/index.js';
import { createToolResult, parseArgs, applyNetworkOptions, parseModelOrThrow, expandModel, buildSimulationOptions, cloneExpandedModel, updateMassActionRates } from '../services/engine.js';

export async function handleSobolSensitivity(args: ToolArgs): Promise<ToolResult<any>> {
    const parsedArgs = parseArgs('sobol_sensitivity', sobolSensitivityArgsSchema, args);
    const model = applyNetworkOptions(parseModelOrThrow(parsedArgs.code), parsedArgs);
    const expandedModel = await expandModel(model);

    const simOptions = buildSimulationOptions(parsedArgs);
    await loadEvaluator();

    const results = await sobolSensitivity({
        simulate: async (overrides) => {
            const runModel = cloneExpandedModel(expandedModel);
            Object.entries(overrides).forEach(([k, v]) => {
                runModel.parameters[k] = v;
            });
            updateMassActionRates(runModel);
            return simulate(0, runModel, simOptions, {
                checkCancelled: () => { },
                postMessage: () => { },
            });
        },
        params: parsedArgs.parameters.map((p: any) => ({
            name: p.name,
            min: p.min,
            max: p.max,
        })),
        observables: parsedArgs.observables,
        N: parsedArgs.n_samples ?? 512,
        seed: parsedArgs.seed ?? 42,
        nBootstrap: parsedArgs.n_bootstrap ?? 500,
        logScale: parsedArgs.log_scale,
    });

    return createToolResult(results);
}

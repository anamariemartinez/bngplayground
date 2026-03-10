import { NetworkGenerationLimitError, simulate, loadEvaluator } from '@bngplayground/engine';
import { ToolArgs, ToolResult } from '../types/index.js';
import { simulateArgsSchema } from '../schemas/index.js';
import { createToolResult, parseArgs, applyNetworkOptions, parseModelOrThrow, buildSimulationOptions, expandModel } from '../services/engine.js';

export async function handleSimulate(args: ToolArgs): Promise<ToolResult<any>> {
    const parsedArgs = parseArgs('simulate', simulateArgsSchema, args);
    try {
        const model = applyNetworkOptions(parseModelOrThrow(parsedArgs.code), parsedArgs);
        const expandedModel = await expandModel(model);
        const simulationOptions = buildSimulationOptions(parsedArgs);
        if (parsedArgs.include_species_data !== undefined) {
            simulationOptions.includeSpeciesData = parsedArgs.include_species_data;
        }

        await loadEvaluator();
        const results = await simulate(0, expandedModel, simulationOptions, {
            checkCancelled: () => { },
            postMessage: () => { },
        });
        return createToolResult(results);
    } catch (error: any) {
        let stage = 'simulation';
        if (error instanceof NetworkGenerationLimitError) {
            stage = 'network_expansion';
            return createToolResult({
                success: false,
                stage,
                error: error.message,
                species_generated: error.speciesCount,
                reactions_generated: error.reactionCount,
                last_rule: error.lastRule,
            });
        }
        return createToolResult({
            success: false,
            stage,
            error: error.message || 'Unknown simulation error',
        });
    }
}

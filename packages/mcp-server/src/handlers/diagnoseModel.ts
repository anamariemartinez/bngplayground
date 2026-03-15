import { ToolArgs, ToolResult } from '../types/index.js';
import { diagnoseModelArgsSchema } from '../schemas/index.js';
import { createToolResult, parseArgs } from '../services/engine.js';
import { diagnoseModelDeep } from '../services/intelligence.js';

export async function handleDiagnoseModel(args: ToolArgs): Promise<ToolResult<any>> {
    const parsedArgs = parseArgs('diagnose_model', diagnoseModelArgsSchema, args);
    const result = await diagnoseModelDeep(parsedArgs);
    return createToolResult(result);
}

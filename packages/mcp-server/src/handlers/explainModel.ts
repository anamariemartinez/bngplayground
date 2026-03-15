import { ToolArgs, ToolResult } from '../types/index.js';
import { explainModelArgsSchema } from '../schemas/index.js';
import { createToolResult, parseArgs } from '../services/engine.js';
import { explainModelNarrative } from '../services/intelligence.js';

export async function handleExplainModel(args: ToolArgs): Promise<ToolResult<any>> {
    const parsedArgs = parseArgs('explain_model', explainModelArgsSchema, args);
    const explanation = explainModelNarrative(parsedArgs.code);
    return createToolResult(explanation);
}

import { ToolArgs, ToolResult } from '../types/index.js';
import { composeModelArgsSchema } from '../schemas/index.js';
import { createToolResult, parseArgs } from '../services/engine.js';
import { composeModelFromStatements } from '../services/intelligence.js';

export async function handleComposeModel(args: ToolArgs): Promise<ToolResult<any>> {
    const parsedArgs = parseArgs('compose_model', composeModelArgsSchema, args);
    const composed = composeModelFromStatements(parsedArgs);
    return createToolResult(composed);
}

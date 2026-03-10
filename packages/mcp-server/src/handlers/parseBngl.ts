import { parseBNGLWithANTLR } from '@bngplayground/engine';
import { ToolArgs, ToolResult } from '../types/index.js';
import { parseBnglArgsSchema } from '../schemas/index.js';
import { createToolResult, parseArgs } from '../services/engine.js';

export async function handleParseBngl(args: ToolArgs): Promise<ToolResult<ReturnType<typeof parseBNGLWithANTLR>>> {
    const parsedArgs = parseArgs('parse_bngl', parseBnglArgsSchema, args);
    const result = parseBNGLWithANTLR(parsedArgs.code);
    return createToolResult(result);
}

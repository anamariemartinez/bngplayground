import { ToolArgs, ToolResult } from '../types/index.js';
import { editModelArgsSchema } from '../schemas/index.js';
import { createToolResult, parseArgs } from '../services/engine.js';
import { applyModelEdits } from '../services/intelligence.js';

export async function handleEditModel(args: ToolArgs): Promise<ToolResult<any>> {
    const parsedArgs = parseArgs('edit_model', editModelArgsSchema, args);
    const result = applyModelEdits(parsedArgs.code, parsedArgs.operations as unknown as Array<Record<string, unknown>>);

    return createToolResult(result);
}

import { ToolArgs, ToolResult } from '../types/index.js';
import { suggestFixArgsSchema } from '../schemas/index.js';
import { createToolResult, parseArgs } from '../services/engine.js';
import { suggestModelFixes } from '../services/intelligence.js';

export async function handleSuggestFix(args: ToolArgs): Promise<ToolResult<any>> {
    const parsedArgs = parseArgs('suggest_fix', suggestFixArgsSchema, args);
    const suggestions = suggestModelFixes(parsedArgs.code, parsedArgs.include_auto_corrected_code ?? false);
    return createToolResult(suggestions);
}

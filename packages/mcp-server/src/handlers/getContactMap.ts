import { ToolArgs, ToolResult, ContactMap } from '../types/index.js';
import { getContactMapArgsSchema } from '../schemas/index.js';
import { createToolResult, parseArgs, parseModelOrThrow, buildContactMap } from '../services/engine.js';

export async function handleGetContactMap(args: ToolArgs): Promise<ToolResult<ContactMap>> {
    const parsedArgs = parseArgs('get_contact_map', getContactMapArgsSchema, args);
    const model = parseModelOrThrow(parsedArgs.code);
    return createToolResult(buildContactMap(model.reactionRules ?? [], model.moleculeTypes ?? []));
}

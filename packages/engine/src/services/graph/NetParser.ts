/**
 * NetParser.ts - Parser for BioNetGen .net files
 *
 * Reads post-network-generation .net format files produced by BNG2's writeNetwork action.
 * This enables the readFile action for .net files and supports 'continue' simulation workflows.
 *
 * Format reference: BNG2/bng2/Perl2/BNGOutput.pm::writeNetwork()
 */

import type { BNGLModel, BNGLSpecies, BNGLObservable, BNGLReaction, BNGLFunction, BNGLCompartment } from '../../types';

export interface NetFileParseResult {
  model: BNGLModel;
  success: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Parse a BioNetGen .net file into a BNGLModel
 * @param content The full text content of the .net file
 * @returns Parse result with model and any errors/warnings
 */
export function parseNetFile(content: string): NetFileParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const lines = content.split('\n');

  const model: BNGLModel = {
    parameters: {},
    moleculeTypes: [],
    species: [],
    observables: [],
    reactions: [],
    reactionRules: [],
    compartments: [],
    functions: [],
    actions: []
  };

  let currentSection: string | null = null;
  let lineNum = 0;

  for (const rawLine of lines) {
    lineNum++;
    // Remove comments (everything after #)
    const line = rawLine.split('#')[0].trim();
    if (!line) continue;

    // Check for section headers
    if (line.startsWith('begin')) {
      const match = line.match(/^begin\s+(\w+)/);
      if (match) {
        currentSection = match[1];
        continue;
      }
    }

    if (line.startsWith('end')) {
      currentSection = null;
      continue;
    }

    // Parse section content
    try {
      if (currentSection === 'parameters') {
        parseParameterLine(line, model, lineNum);
      } else if (currentSection === 'compartments') {
        parseCompartmentLine(line, model, lineNum);
      } else if (currentSection === 'species') {
        parseSpeciesLine(line, model, lineNum);
      } else if (currentSection === 'reactions') {
        parseReactionLine(line, model, lineNum);
      } else if (currentSection === 'groups') {
        parseObservableLine(line, model, lineNum);
      } else if (currentSection === 'functions') {
        parseFunctionLine(line, model, lineNum);
      }
    } catch (err: any) {
      errors.push(`Line ${lineNum}: ${err.message}`);
    }
  }

  return {
    model,
    success: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Parse a parameter line: <index> <name> <value>
 * Example: "1 NA 6.02e+23"
 */
function parseParameterLine(line: string, model: BNGLModel, lineNum: number): void {
  const parts = line.trim().split(/\s+/);
  if (parts.length < 3) {
    throw new Error(`Invalid parameter format (expected: index name value)`);
  }

  const index = parseInt(parts[0]);
  const name = parts[1];
  const value = parseFloat(parts[2]);

  if (isNaN(index) || isNaN(value)) {
    throw new Error(`Invalid parameter: index or value not a number`);
  }

  model.parameters[name] = value;
}

/**
 * Parse a compartment line: <index> <name> <dimension> <size> [<parent>]
 * Example: "1 EC 3 1.0e-10"
 */
function parseCompartmentLine(line: string, model: BNGLModel, lineNum: number): void {
  const parts = line.trim().split(/\s+/);
  if (parts.length < 4) {
    throw new Error(`Invalid compartment format (expected: index name dimension size [parent])`);
  }

  const index = parseInt(parts[0]);
  const name = parts[1];
  const dimension = parseInt(parts[2]);
  const size = parseFloat(parts[3]);
  const parent = parts.length > 4 ? parts[4] : undefined;

  if (isNaN(index) || isNaN(dimension) || isNaN(size)) {
    throw new Error(`Invalid compartment: numeric values not valid`);
  }

  model.compartments!.push({
    name,
    dimension,
    size,
    parent
  });
}

/**
 * Parse a species line: <index> <pattern> <initialConcentration>
 * Example: "1 EGFR(L,CR1,Y1068~U) 1.8e5"
 */
function parseSpeciesLine(line: string, model: BNGLModel, lineNum: number): void {
  // Format: index pattern concentration
  // The pattern may contain spaces, so we can't just split on whitespace
  // Typical format: "1 A(b!1).B(a!1) 100"

  const match = line.match(/^(\d+)\s+(.+?)\s+([\d.eE+-]+)$/);
  if (!match) {
    throw new Error(`Invalid species format (expected: index pattern concentration)`);
  }

  const index = parseInt(match[1]);
  const pattern = match[2].trim();
  const concentration = parseFloat(match[3]);

  if (isNaN(index) || isNaN(concentration)) {
    throw new Error(`Invalid species: index or concentration not a number`);
  }

  model.species.push({
    name: pattern,
    initialConcentration: concentration
  });
}

/**
 * Parse a reaction line: <index> <reactants> -> <products> <rate> [<label>]
 * Example: "1 S1,S2 S3 k1*S1*S2"
 * Example: "2 S3 S1,S2 k2*S3 #_reverse__R1"
 */
function parseReactionLine(line: string, model: BNGLModel, lineNum: number): void {
  // Format: index reactants products rate [label]
  // reactants and products are comma-separated species indices or patterns

  const parts = line.trim().split(/\s+/);
  if (parts.length < 4) {
    throw new Error(`Invalid reaction format (expected: index reactants products rate [label])`);
  }

  const index = parseInt(parts[0]);
  if (isNaN(index)) {
    throw new Error(`Invalid reaction index`);
  }

  const reactants = parts[1].split(',').map(s => s.trim()).filter(s => s);
  const products = parts[2].split(',').map(s => s.trim()).filter(s => s);
  const rateExpr = parts[3];
  const label = parts.length > 4 ? parts.slice(4).join(' ').trim() : undefined;

  // Try to parse rate as a number, otherwise keep as expression
  let rateConstant = parseFloat(rateExpr);
  if (isNaN(rateConstant)) {
    rateConstant = 0; // Will be evaluated from rateExpression
  }

  model.reactions!.push({
    reactants,
    products,
    rate: rateExpr,
    rateConstant,
    rateExpression: rateExpr,
    name: label,
    isFunctionalRate: !/^[\d.eE+-]+$/.test(rateExpr)
  });
}

/**
 * Parse an observable (group) line: <index> <name> <type> <patterns...>
 * Example: "1 Dimers Molecules EGFR(CR1!+)"
 * Example: "2 TotalEGFR Species EGFR()"
 */
function parseObservableLine(line: string, model: BNGLModel, lineNum: number): void {
  const parts = line.trim().split(/\s+/);
  if (parts.length < 4) {
    throw new Error(`Invalid observable format (expected: index name type pattern)`);
  }

  const index = parseInt(parts[0]);
  const name = parts[1];
  const type = parts[2].toLowerCase(); // 'Molecules' or 'Species'
  const patterns = parts.slice(3).join(' ');

  if (isNaN(index)) {
    throw new Error(`Invalid observable index`);
  }

  model.observables.push({
    name,
    type,
    pattern: patterns
  });
}

/**
 * Parse a function line: <index> <name>() = <expression>
 * Example: "1 TotEGFR() = EGFR_free + EGFR_bound"
 */
function parseFunctionLine(line: string, model: BNGLModel, lineNum: number): void {
  // Format: index name(args) = expression
  const match = line.match(/^(\d+)\s+(\w+)\s*\(([^)]*)\)\s*=\s*(.+)$/);
  if (!match) {
    throw new Error(`Invalid function format (expected: index name(args) = expression)`);
  }

  const index = parseInt(match[1]);
  const name = match[2];
  const argsStr = match[3].trim();
  const expression = match[4].trim();

  if (isNaN(index)) {
    throw new Error(`Invalid function index`);
  }

  const args = argsStr ? argsStr.split(',').map(a => a.trim()) : [];

  model.functions!.push({
    name,
    args,
    expression
  });
}

/**
 * Load a .net file and return the parsed model
 * @param filepath Path to the .net file
 * @returns Parsed model or throws error
 */
export async function loadNetFile(filepath: string): Promise<BNGLModel> {
  // This is a placeholder - actual implementation depends on runtime environment
  // In Node.js, use fs.readFileSync; in browser, use fetch
  throw new Error('loadNetFile not implemented - use parseNetFile with file content');
}

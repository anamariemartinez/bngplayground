/**
 * SBOAnnotations.ts — SBO term mappings for BNGL constructs.
 *
 * Provides inference functions to determine appropriate SBO terms
 * for reaction rules and rate laws based on BNGL structure.
 */

/** SBO term constants */
export const SBO = {
  // Reaction types
  BINDING: 'SBO:0000177',
  PHOSPHORYLATION: 'SBO:0000216',
  DEPHOSPHORYLATION: 'SBO:0000330',
  DEGRADATION: 'SBO:0000179',
  SYNTHESIS: 'SBO:0000393',
  TRANSPORT: 'SBO:0000185',
  CATALYSIS: 'SBO:0000013',

  // Rate law types
  MASS_ACTION: 'SBO:0000012',
  MICHAELIS_MENTEN: 'SBO:0000028',
  HILL: 'SBO:0000192',

  // Species roles
  REACTANT: 'SBO:0000010',
  PRODUCT: 'SBO:0000011',
  MODIFIER: 'SBO:0000019',

  // Entity types
  PROTEIN: 'SBO:0000252',
  GENE: 'SBO:0000354',
  SIMPLE_CHEMICAL: 'SBO:0000247',
  COMPLEX: 'SBO:0000253',
} as const;

export type SBOTerm = typeof SBO[keyof typeof SBO];

/**
 * Infer SBO term for a reaction rule based on its structure.
 */
export function inferReactionSBO(rule: {
  reactants: string[];
  products: string[];
  isFunctionalRate?: boolean;
  rate?: string;
}): string {
  const reactantStr = rule.reactants.join('+');
  const productStr = rule.products.join('+');

  // Degradation: products contain '0' or 'Trash'
  if (rule.products.some((p) => p.trim() === '0' || p.trim() === 'Trash')) {
    return SBO.DEGRADATION;
  }

  // Synthesis: reactants contain '0'
  if (rule.reactants.some((r) => r.trim() === '0')) {
    return SBO.SYNTHESIS;
  }

  // Phosphorylation: state change ~U -> ~P
  if (hasStateChange(reactantStr, productStr, 'U', 'P') ||
      hasStateChange(reactantStr, productStr, 'u', 'p') ||
      hasStateChange(reactantStr, productStr, '0', 'P') ||
      hasStateChange(reactantStr, productStr, '0', 'p')) {
    return SBO.PHOSPHORYLATION;
  }

  // Dephosphorylation: state change ~P -> ~U
  if (hasStateChange(reactantStr, productStr, 'P', 'U') ||
      hasStateChange(reactantStr, productStr, 'p', 'u') ||
      hasStateChange(reactantStr, productStr, 'P', '0') ||
      hasStateChange(reactantStr, productStr, 'p', '0')) {
    return SBO.DEPHOSPHORYLATION;
  }

  // Compartment transport: check for @ compartment changes
  if (hasCompartmentChange(reactantStr, productStr)) {
    return SBO.TRANSPORT;
  }

  // Binding: product has more bonds than reactants (more '!' bonds)
  const reactantBonds = countBonds(reactantStr);
  const productBonds = countBonds(productStr);
  if (productBonds > reactantBonds) {
    return SBO.BINDING;
  }

  // Default: catalysis if functional rate, otherwise generic
  if (rule.isFunctionalRate) {
    return SBO.CATALYSIS;
  }

  return SBO.MASS_ACTION;
}

/**
 * Infer SBO term for a rate law expression.
 */
export function inferRateLawSBO(
  rateExpression: string,
  functions?: Record<string, string>,
): string {
  const expr = rateExpression.toLowerCase();

  // Check for Michaelis-Menten patterns
  if (expr.includes('mm(') || expr.includes('sat(') || expr.includes('michaelis')) {
    return SBO.MICHAELIS_MENTEN;
  }

  // Check for Hill function patterns
  if (expr.includes('hill(') || /\^[2-9]/.test(expr) || /\*\*[2-9]/.test(expr)) {
    // Check if functions contain Hill-like definitions
    if (functions) {
      for (const [name, body] of Object.entries(functions)) {
        const bodyLower = body.toLowerCase();
        if (bodyLower.includes('hill') || /\^[2-9]/.test(body)) {
          if (expr.includes(name.toLowerCase())) {
            return SBO.HILL;
          }
        }
      }
    }
    // Direct Hill pattern
    if (expr.includes('hill(')) {
      return SBO.HILL;
    }
  }

  // Default: mass action
  return SBO.MASS_ACTION;
}

// ── Helpers ──────────────────────────────────────────────────────────

function hasStateChange(
  reactants: string,
  products: string,
  fromState: string,
  toState: string,
): boolean {
  const fromPattern = new RegExp(`~${fromState}(?=[,)!.\\s+]|$)`);
  const toPattern = new RegExp(`~${toState}(?=[,)!.\\s+]|$)`);
  return fromPattern.test(reactants) && toPattern.test(products);
}

function hasCompartmentChange(reactants: string, products: string): boolean {
  const compartmentPattern = /@(\w+)/g;
  const reactantCompartments = new Set<string>();
  const productCompartments = new Set<string>();

  let match;
  while ((match = compartmentPattern.exec(reactants)) !== null) {
    reactantCompartments.add(match[1]);
  }
  while ((match = compartmentPattern.exec(products)) !== null) {
    productCompartments.add(match[1]);
  }

  // Transport if compartments differ
  if (reactantCompartments.size > 0 && productCompartments.size > 0) {
    for (const comp of productCompartments) {
      if (!reactantCompartments.has(comp)) return true;
    }
  }
  return false;
}

function countBonds(pattern: string): number {
  const matches = pattern.match(/!/g);
  return matches ? matches.length : 0;
}

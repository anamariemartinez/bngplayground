/**
 * LibBNGLoader.ts — Loads the libBNG WASM module.
 *
 * Pattern: services/cvode_loader.js, services/igraphLoader.ts
 * Zero browser dependencies (engine package).
 */

// @ts-expect-error - Emscripten-generated module has no types
import createLibBNGModule from '@/services/libbng_loader.js';

/** Raw WASM module interface — maps to extern "C" functions in libbng_wrapper.cpp */
export interface LibBNGModule {
  // Lifecycle
  _libbng_init(bnglTextPtr: number): number;
  _libbng_destroy(): void;
  _libbng_get_last_error(): number;

  // Species
  _libbng_species_count(): number;
  _libbng_species_name(speciesId: number): number;
  _libbng_species_compartment(speciesId: number): number;

  // Bimolecular reactions
  _libbng_check_bimol_reaction(speciesA: number, speciesB: number): number;
  _libbng_get_rxn_class_max_prob(speciesA: number, speciesB: number): number;
  _libbng_get_pathway_for_prob(speciesA: number, speciesB: number, prob: number): number;
  _libbng_get_pathway_product_count(speciesA: number, speciesB: number, pathwayIndex: number): number;
  _libbng_get_pathway_product_species_id(
    speciesA: number, speciesB: number, pathwayIndex: number, productIndex: number
  ): number;

  // Unimolecular reactions
  _libbng_check_unimol_reaction(speciesId: number): number;
  _libbng_get_unimol_max_prob(speciesId: number): number;
  _libbng_get_unimol_pathway_for_prob(speciesId: number, prob: number): number;
  _libbng_apply_unimol_pathway(
    speciesId: number, pathwayIndex: number,
    productIdsPtr: number, maxProducts: number
  ): number;

  // Rate constants
  _libbng_rule_rate(ruleIndex: number): number;
  _libbng_rule_count(): number;

  // Compartments
  _libbng_compartment_count(): number;
  _libbng_compartment_name(index: number): number;
  _libbng_compartment_is_3d(index: number): number;
  _libbng_compartment_volume(index: number): number;
  _libbng_compartment_parent(index: number): number;

  // Molecule types
  _libbng_mol_type_count(): number;
  _libbng_mol_type_name(index: number): number;

  // Seed species
  _libbng_seed_species_count(): number;
  _libbng_seed_species_name(index: number): number;
  _libbng_seed_species_amount(index: number): number;

  // Observables
  _libbng_observable_count(): number;
  _libbng_observable_name(index: number): number;

  // Parameters
  _libbng_get_parameter(namePtr: number): number;

  // Memory
  _malloc(size: number): number;
  _free(ptr: number): void;

  // Emscripten runtime
  cwrap: (
    name: string, returnType: string | null, argTypes: string[],
    opts?: Record<string, unknown>
  ) => (...args: unknown[]) => unknown;
  UTF8ToString: (ptr: number) => string;
  stringToUTF8: (str: string, ptr: number, maxBytes: number) => void;
  lengthBytesUTF8: (str: string) => number;
  HEAPF64: Float64Array;
  HEAP32: Int32Array;
}

// Singleton module instance
let moduleInstance: LibBNGModule | null = null;

/** Determine the base URL for WASM asset resolution, handling GitHub Pages sub-path. */
function getBaseUrl(): string {
  try {
    if (typeof self !== 'undefined' && self.location) {
      const { pathname } = self.location;
      if (pathname.includes('/bngplayground/')) return '/bngplayground/';
    }
  } catch {
    // self.location can throw in some worker contexts
  }
  return '/';
}

/**
 * Load the libBNG WASM module. Returns the same instance on subsequent calls.
 */
export async function loadLibBNG(): Promise<LibBNGModule> {
  if (moduleInstance) return moduleInstance;

  const baseUrl = getBaseUrl();
  const Module = await (createLibBNGModule as (opts: Record<string, unknown>) => Promise<LibBNGModule>)({
    locateFile: (path: string) => {
      if (path.endsWith('.wasm')) {
        return `${baseUrl}libbng.wasm`;
      }
      return path;
    },
    instantiateWasm: (
      imports: WebAssembly.Imports,
      receiveInstance: (instance: WebAssembly.Instance) => void,
    ) => {
      const wasmUrl = `${baseUrl}libbng.wasm`;
      fetch(wasmUrl, { credentials: 'same-origin' })
        .then((r) => r.arrayBuffer())
        .then((buf) => WebAssembly.instantiate(buf, imports))
        .then((result) => receiveInstance(result.instance))
        .catch((e) => console.error('[libBNG] WASM instantiation failed:', e));
      return {};
    },
    print: () => { /* no-op */ },
    printErr: (text: string) => { console.warn('[libBNG]', text); },
  });

  moduleInstance = Module;
  return moduleInstance;
}

/**
 * High-level: initialize libBNG with a BNGL model string.
 * Throws on parse failure with the libBNG error message.
 */
export async function initLibBNG(bnglText: string): Promise<LibBNGModule> {
  const mod = await loadLibBNG();
  const len = mod.lengthBytesUTF8(bnglText) + 1;
  const ptr = mod._malloc(len);
  try {
    mod.stringToUTF8(bnglText, ptr, len);
    const result = mod._libbng_init(ptr);
    if (result !== 0) {
      const errPtr = mod._libbng_get_last_error();
      const errMsg = mod.UTF8ToString(errPtr);
      throw new Error(`libBNG initialization failed: ${errMsg}`);
    }
  } finally {
    mod._free(ptr);
  }
  return mod;
}

/**
 * Destroy the current libBNG engine instance, freeing all WASM memory.
 */
export function destroyLibBNG(): void {
  if (moduleInstance) {
    moduleInstance._libbng_destroy();
  }
}

/**
 * Get all species currently known to libBNG.
 */
export function getSpecies(mod: LibBNGModule): Array<{ id: number; name: string; compartmentId: number }> {
  const count = mod._libbng_species_count();
  const species: Array<{ id: number; name: string; compartmentId: number }> = [];
  for (let i = 0; i < count; i++) {
    const namePtr = mod._libbng_species_name(i);
    const name = mod.UTF8ToString(namePtr);
    const compId = mod._libbng_species_compartment(i);
    species.push({ id: i, name, compartmentId: compId });
  }
  return species;
}

/**
 * Get all compartments from the parsed model.
 */
export function getCompartments(mod: LibBNGModule): Array<{
  id: number; name: string; is3d: boolean; volume: number; parentId: number;
}> {
  const count = mod._libbng_compartment_count();
  const compartments: Array<{
    id: number; name: string; is3d: boolean; volume: number; parentId: number;
  }> = [];
  for (let i = 0; i < count; i++) {
    const namePtr = mod._libbng_compartment_name(i);
    compartments.push({
      id: i,
      name: mod.UTF8ToString(namePtr),
      is3d: mod._libbng_compartment_is_3d(i) === 1,
      volume: mod._libbng_compartment_volume(i),
      parentId: mod._libbng_compartment_parent(i),
    });
  }
  return compartments;
}

/**
 * Get a BNGL parameter value by name. Returns undefined if not found.
 */
export function getParameter(mod: LibBNGModule, name: string): number | undefined {
  const len = mod.lengthBytesUTF8(name) + 1;
  const ptr = mod._malloc(len);
  try {
    mod.stringToUTF8(name, ptr, len);
    const val = mod._libbng_get_parameter(ptr);
    if (isNaN(val)) return undefined;
    return val;
  } finally {
    mod._free(ptr);
  }
}

/**
 * Check + resolve a bimolecular reaction between two species.
 * Returns null if no reaction, or product species IDs if reaction occurs.
 */
export function resolveBimolReaction(
  mod: LibBNGModule,
  speciesA: number,
  speciesB: number,
  randomProb: number
): number[] | null {
  if (mod._libbng_check_bimol_reaction(speciesA, speciesB) === 0) {
    return null;
  }

  const pathwayIndex = mod._libbng_get_pathway_for_prob(speciesA, speciesB, randomProb);
  if (pathwayIndex < 0) {
    return null; // PATHWAY_INDEX_NO_RXN = -2
  }

  const productCount = mod._libbng_get_pathway_product_count(speciesA, speciesB, pathwayIndex);
  const products: number[] = [];
  for (let i = 0; i < productCount; i++) {
    const pid = mod._libbng_get_pathway_product_species_id(speciesA, speciesB, pathwayIndex, i);
    if (pid >= 0) {
      products.push(pid);
    }
  }
  return products;
}

/** Sentinel value for "no reaction" from libBNG */
export const PATHWAY_INDEX_NO_RXN = -2;

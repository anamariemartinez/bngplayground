/**
 * packages/engine/src/services/spatial/SpatialEngineLoader.ts
 *
 * Handles loading and initialization of the spatial_engine.wasm module.
 */

// @ts-expect-error - Emscripten-generated module has no types
import createSpatialModule from '@/services/spatial_loader.js';

export interface SpatialEngineModule {
    _spatial_init(dt: number, seed: number): number;
    _spatial_set_rxn_radius(radius: number): void;
    _spatial_set_grid_size(side_x: number, side_y: number, side_z: number, cell_size: number): void;
    _spatial_destroy(): void;
    _spatial_add_molecule(x: number, y: number, z: number, speciesId: number, compartmentId: number): number;
    _spatial_remove_molecule(index: number): void;
    _spatial_clear_molecules(): void;
    _spatial_set_diffusion_constant(speciesId: number, D: number): void;
    _spatial_molecule_count(): number;
    _spatial_get_molecule_species_id(index: number): number;
    _spatial_get_molecule_compartment_id(index: number): number;
    _spatial_get_molecule_x(index: number): number;
    _spatial_get_molecule_y(index: number): number;
    _spatial_get_molecule_z(index: number): number;
    _spatial_set_callbacks(
        check: number,
        max_prob: number,
        pathway: number,
        prod_count: number,
        product: number
    ): void;
    _spatial_step(): void;
    _spatial_export_positions(outPtr: number, maxMols: number): number;
    _spatial_count_species(idPtr: number, countPtr: number, maxSpecies: number): number;

    // Emscripten helpers
    _malloc(size: number): number;
    _free(ptr: number): void;
    HEAPF32: Float32Array;
    HEAP32: Int32Array;
    addFunction(fn: Function, signature: string): number;
}

let spatialModule: SpatialEngineModule | null = null;

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

export async function initSpatialEngine(dt: number, seed: number): Promise<SpatialEngineModule> {
    if (!spatialModule) {
        const baseUrl = getBaseUrl();
        spatialModule = await (createSpatialModule as (opts: Record<string, unknown>) => Promise<SpatialEngineModule>)({
            locateFile: (path: string) => {
                if (path.endsWith('.wasm')) {
                    return `${baseUrl}spatial.wasm`;
                }
                return path;
            },
            instantiateWasm: (
                imports: WebAssembly.Imports,
                receiveInstance: (instance: WebAssembly.Instance) => void,
            ) => {
                const wasmUrl = `${baseUrl}spatial.wasm`;
                fetch(wasmUrl, { credentials: 'same-origin' })
                    .then((r) => r.arrayBuffer())
                    .then((buf) => WebAssembly.instantiate(buf, imports))
                    .then((result) => receiveInstance(result.instance))
                    .catch((e) => console.error('[SpatialEngine] WASM instantiation failed:', e));
                return {};
            },
            print: () => { /* no-op */ },
            printErr: (text: string) => { console.warn('[SpatialEngine]', text); },
        });
    }

    spatialModule._spatial_init(dt, seed);
    return spatialModule;
}

export function getSpatialModule(): SpatialEngineModule {
    if (!spatialModule) throw new Error('Spatial engine not initialized');
    return spatialModule;
}

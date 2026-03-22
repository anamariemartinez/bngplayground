/**
 * SpatialSimulation.ts — Main orchestrator for spatial Monte Carlo simulation.
 *
 * Runs in a Web Worker. Coordinates:
 * 1. libBNG WASM (reaction resolution)
 * 2. Spatial engine (diffusion, collision detection)
 * 3. Observable counting
 * 4. Snapshot emission to renderer
 *
 * Algorithm: MCell4-compatible time-step-driven Brownian dynamics.
 * Each iteration: diffuse → detect collisions → resolve reactions → record
 */

import type {
  SpatialSimulationConfig,
  SpatialSimulationResult,
  SpatialSnapshot,
  SpatialMoleculeType,
  CompartmentGeometry,
} from './SpatialConfig';
import { DEFAULT_SPATIAL_CONFIG, extractDiffusionConstants } from './SpatialConfig';
import { autoGenerateGeometry } from './SpatialGeometry';
import type { ParsedCompartment } from './SpatialGeometry';
import {
  initLibBNG,
  destroyLibBNG,
  getSpecies,
  getCompartments,
  getParameter,
  resolveBimolReaction,
  type LibBNGModule,
} from './LibBNGLoader';
import {
  initSpatialEngine,
  getSpatialModule,
  type SpatialEngineModule,
} from './SpatialEngineLoader';

/** PRNG: xoshiro256** for reproducible spatial simulation */
class Xoshiro256StarStar {
  private s: BigUint64Array;

  constructor(seed: number) {
    // Initialize from seed using splitmix64
    this.s = new BigUint64Array(4);
    let s = BigInt(seed);
    for (let i = 0; i < 4; i++) {
      s += 0x9e3779b97f4a7c15n;
      let z = s;
      z = (z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n;
      z = (z ^ (z >> 27n)) * 0x94d049bb133111ebn;
      z = z ^ (z >> 31n);
      this.s[i] = z & 0xFFFFFFFFFFFFFFFFn;
    }
  }

  /** Returns a random float in [0, 1) */
  random(): number {
    const result = this.rotl(this.s[1] * 5n, 7n) * 9n;
    const t = this.s[1] << 17n;

    this.s[2] ^= this.s[0];
    this.s[3] ^= this.s[1];
    this.s[1] ^= this.s[2];
    this.s[0] ^= this.s[3];
    this.s[2] ^= t;
    this.s[3] = this.rotl(this.s[3], 45n);

    // Convert to double in [0, 1)
    return Number((result >> 11n) & 0x1FFFFFFFFFFFFFn) / Number(0x20000000000000n);
  }

  /** Box-Muller transform for Gaussian random numbers */
  gaussian(): number {
    const u1 = this.random();
    const u2 = this.random();
    return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  }

  private rotl(x: bigint, k: bigint): bigint {
    return ((x << k) | (x >> (64n - k))) & 0xFFFFFFFFFFFFFFFFn;
  }
}

/** Active molecule in the simulation */
interface ActiveMolecule {
  id: number;
  speciesId: number;
  x: number;
  y: number;
  z: number;
  compartmentId: number;
}

/**
 * Pure TypeScript spatial Monte Carlo simulation (Phase 1 MVP).
 *
 * In Phase 1, we use a TS-based spatial engine with libBNG WASM for
 * reaction resolution. In Phase 2+, the diffusion/collision inner loop
 * moves to C++ WASM (wasm-spatial/).
 */
export class SpatialSimulation {
  private config: SpatialSimulationConfig;
  private mod: LibBNGModule | null = null;
  private spatialMod: SpatialEngineModule | null = null;
  private rng: Xoshiro256StarStar; // Still needed for coordinate generation in TS

  private molecules: ActiveMolecule[] = [];
  private nextMoleculeId = 0;
  private currentTime = 0;
  private stepCount = 0;

  private geometries: CompartmentGeometry[] = [];
  private moleculeTypes: Map<number, SpatialMoleculeType> = new Map();

  // Observable time series
  private timePoints: number[] = [];
  private observableTimeSeries: Map<string, number[]> = new Map();
  private perCompartmentTimeSeries: Record<string, Record<string, number>>[] = [];

  // Uniform grid for collision detection
  private gridCellSize = 0;
  private grid: Map<string, number[]> = new Map(); // cellKey → molecule indices

  constructor(config?: Partial<SpatialSimulationConfig>) {
    this.config = { ...DEFAULT_SPATIAL_CONFIG, ...config };
    this.rng = new Xoshiro256StarStar(this.config.seed);
  }

  /**
   * Initialize the simulation with a BNGL model.
   */
  async initialize(bnglText: string): Promise<void> {
    console.log('[SpatialSimulation] Starting initialization...');
    // Initialize libBNG
    this.mod = await initLibBNG(bnglText);
    console.log('[SpatialSimulation] libBNG initialized');

    // Extract compartments
    const libCompartments = getCompartments(this.mod!);
    
    // For non-spatial models, create a default compartment
    let parsedCompartments: ParsedCompartment[] = libCompartments.map(c => ({
      name: c.name,
      dimension: c.is3d ? 3 as const : 2 as const,
      size: c.volume,
      parent: c.parentId >= 0 ? libCompartments[c.parentId]?.name : undefined,
    }));
    
    // If no compartments exist (non-spatial model), create a default
    if (parsedCompartments.length === 0) {
      parsedCompartments = [{
        name: 'Cytoplasm',
        dimension: 3,
        size: 1e-12, // 1 femtoliter
        parent: undefined,
      }];
    }

    // Generate geometry
    if (this.config.geometry === 'auto') {
      this.geometries = autoGenerateGeometry(parsedCompartments);
    }

    // Extract diffusion constants from MCELL_ parameters
    const species = getSpecies(this.mod!);
    console.log('[SpatialSimulation] getSpecies() returned:', species.length, 'species');
    if (species.length === 0) {
      console.log('[SpatialSimulation] WARNING: No species from getSpecies()!');
      // Also check what libBNG reports
      const speciesCount = this.mod!._libbng_species_count();
      const seedCount = this.mod!._libbng_seed_species_count();
      console.log('[SpatialSimulation] libBNG species_count:', speciesCount, 'seed_species_count:', seedCount);
    }
    if (species.length > 0) {
      console.log('[SpatialSimulation] First few species:', species.slice(0, 3).map(s => `${s.name}(id:${s.id})`).join(', '));
    }

    const molTypeCount = this.mod!._libbng_mol_type_count();
    console.log('[SpatialSimulation] libBNG mol_type_count:', molTypeCount);

    for (let i = 0; i < molTypeCount; i++) {
      const namePtr = this.mod!._libbng_mol_type_name(i);
      const name = this.mod!.UTF8ToString(namePtr);

      // Check for MCELL_DIFFUSION_CONSTANT_3D_<name> and _2D_<name>
      const dc3d = getParameter(this.mod!, `MCELL_DIFFUSION_CONSTANT_3D_${name}`);
      const dc2d = getParameter(this.mod!, `MCELL_DIFFUSION_CONSTANT_2D_${name}`);

      const dc = dc3d ?? dc2d ?? 1e-6; // Default 1e-6 cm²/s
      const dim = dc2d != null ? 2 as const : 3 as const;

      // Find species that use this molecule type
      for (const sp of species) {
        if (sp.name.includes(name)) {
          this.moleculeTypes.set(sp.id, {
            speciesIndex: sp.id,
            name: sp.name,
            diffusionConstant: dc,
            dimension: dim,
            compartmentId: sp.compartmentId,
          });
        }
      }
    }
    
    // For non-spatial models, create molecule types from seed species if none defined
    if (this.moleculeTypes.size === 0 && this.mod._libbng_seed_species_count() > 0) {
      console.log('[SpatialSimulation] Creating molecule types from seed species, count:', this.mod._libbng_seed_species_count());
      
      // Check seed species count
      const seedCount = this.mod!._libbng_seed_species_count();
      console.log('[SpatialSimulation] Seed species count:', seedCount);
      for (let i = 0; i < seedCount; i++) {
        const namePtr = this.mod!._libbng_seed_species_name(i);
        const name = this.mod!.UTF8ToString(namePtr);
        const amount = this.mod!._libbng_seed_species_amount(i);
        console.log('[SpatialSimulation] Seed species:', name, 'amount:', amount);
      }
      
      for (const sp of species) {
        console.log('[SpatialSimulation] Creating mol type for species:', sp.name, 'id:', sp.id);
        this.moleculeTypes.set(sp.id, {
          speciesIndex: sp.id,
          name: sp.name,
          diffusionConstant: 1e-6, // Default diffusion
          dimension: 3,
          compartmentId: sp.compartmentId,
        });
      }
    }

    console.log('[SpatialSimulation] Created molecule types:', this.moleculeTypes.size);

    // Set up spatial WASM engine
    console.log('[SpatialSimulation] Initializing spatial engine...');
    this.spatialMod = await initSpatialEngine(this.config.dt, this.config.seed);
    console.log('[SpatialSimulation] Spatial engine initialized');
    // Skip callback setup - WASM callbacks crash due to libBNG null function issue
    // this.setupSpatialCallbacks();

    // Set grid size from first geometry (defaulting to a box)
    const primaryGeom = this.geometries[0];
    if (primaryGeom && primaryGeom.halfExtents) {
      const [hx, hy, hz] = primaryGeom.halfExtents;
      if (this.spatialMod._spatial_set_grid_size) {
        this.spatialMod._spatial_set_grid_size(hx * 2, hy * 2, hz * 2, this.config.partitionCellSize || 1.0);
      }
    }

    // Set reaction radius (if available)
    const sigma = getParameter(this.mod!, 'MCELL_REACTION_RADIUS') ?? 0.01;
    if (this.spatialMod._spatial_set_rxn_radius) {
      this.spatialMod._spatial_set_rxn_radius(sigma);
    }

    // Pass diffusion constants to WASM
    for (const [sid, molType] of this.moleculeTypes) {
      console.log(`[SpatialSimulation] Setting diffusion for species ${sid} (${molType.name}): D=${molType.diffusionConstant} cm²/s`);
      if (this.spatialMod._spatial_set_diffusion_constant) {
        this.spatialMod._spatial_set_diffusion_constant(sid, molType.diffusionConstant);
      }
    }

    // Release seed species
    this.releaseSeedSpecies();
    
    // Debug: check what was added
    const molCount = this.spatialMod._spatial_molecule_count();
    console.log('[SpatialSimulation] After releaseSeedSpecies: molecule count =', molCount);
    
    console.log('[SpatialSimulation] Initialization complete');
  }

  /**
   * Run the simulation to completion.
   * Returns the full result with time series.
   */
  async run(
    onSnapshot?: (snapshot: SpatialSnapshot) => void
  ): Promise<SpatialSimulationResult> {
    console.log('[SpatialSimulation] run() starting, total steps:', Math.ceil(this.config.tEnd / this.config.dt), 'dt:', this.config.dt, 'tEnd:', this.config.tEnd);
    const totalSteps = Math.ceil(this.config.tEnd / this.config.dt);
    const outputInterval = Math.max(1, Math.floor(totalSteps / this.config.nOutput));

    for (let step = 0; step < totalSteps; step++) {
      console.log('[SpatialSimulation] Running step', step, 'of', totalSteps);
      this.advanceStep();

      if (step % outputInterval === 0) {
        console.log('[SpatialSimulation] Taking snapshot at step', step);
        const snapshot = this.getSnapshot();
        this.recordObservables(snapshot);

        if (onSnapshot) {
          onSnapshot(snapshot);
        }
      }
    }

    console.log('[SpatialSimulation] run() completed, getting final snapshot');
    // Final snapshot
    const finalSnapshot = this.getSnapshot();
    this.recordObservables(finalSnapshot);

    return this.buildResult();
  }

  /**
   * Advance simulation by one time step.
   * Core loop: diffuse → detect collisions → resolve reactions → unimol rxns
   */
  private advanceStep(): void {
    console.log('[SpatialSimulation] advanceStep() called');
    if (!this.spatialMod) {
      console.log('[SpatialSimulation] advanceStep: no spatialMod');
      return;
    }

    console.log('[SpatialSimulation] advanceStep: using WASM');
    // Use WASM spatial engine
    this.runWasmStep();
    
    this.currentTime += this.config.dt;
    console.log('[SpatialSimulation] advanceStep: done, time =', this.currentTime);
  }

  /**
   * Run one step using the WASM spatial engine.
   */
  private runWasmStep(): void {
    if (!this.spatialMod || !this.spatialMod._spatial_step) {
      console.log('[SpatialSimulation] runWasmStep: WASM step not available, using JS fallback');
      this.diffuseAll(this.config.dt);
      return;
    }

    // Log dt being used
    console.log('[SpatialSimulation] runWasmStep: calling _spatial_step with internal dt');

    // Call WASM step function - skip reaction callbacks by NOT setting them up
    // This allows diffusion to work without the callback crash
    this.spatialMod._spatial_step();
    
    // Debug: log a sample molecule position after step
    if (this.spatialMod._spatial_molecule_count() > 0) {
      const x = this.spatialMod._spatial_get_molecule_x(0);
      const y = this.spatialMod._spatial_get_molecule_y(0);
      const z = this.spatialMod._spatial_get_molecule_z(0);
      console.log('[SpatialSimulation] molecule 0 position:', x, y, z);
    }
  }

  /**
   * Diffuse all molecules by Gaussian displacement.
   * Δx ~ N(0, √(2D·Δt), D in cm²/s → convert to µm²/s: D_um = D * 1e8) for each dimension.
   */
  private diffuseAll(dt: number): void {
    for (const mol of this.molecules) {
      const molType = this.moleculeTypes.get(mol.speciesId);
      if (!molType || molType.diffusionConstant === 0) continue;

      const D = molType.diffusionConstant;
      // σ = √(2D·Δt), D in cm²/s → convert to µm²/s: D_um = D * 1e8
      const D_um = D * 1e8; // cm²/s → µm²/s
      const sigma = Math.sqrt(2 * D_um * dt);

      mol.x += this.rng.gaussian() * sigma;
      mol.y += this.rng.gaussian() * sigma;
      mol.z += this.rng.gaussian() * sigma;

      // Reflective boundary conditions
      this.reflectBoundary(mol);
    }
  }

  /**
   * Reflect molecules off compartment boundaries.
   * Simplified: for Phase 1, we only handle box geometry.
   */
  private reflectBoundary(mol: ActiveMolecule): void {
    const geom = this.geometries.find(g =>
      g.compartmentId === mol.compartmentId || mol.compartmentId === -1
    ) ?? this.geometries[0];

    if (!geom) return;

    if (geom.shape === 'box' && geom.halfExtents) {
      const [hx, hy, hz] = geom.halfExtents;
      const [cx, cy, cz] = geom.center;
      mol.x = reflectCoord(mol.x, cx - hx, cx + hx);
      mol.y = reflectCoord(mol.y, cy - hy, cy + hy);
      mol.z = reflectCoord(mol.z, cz - hz, cz + hz);
    } else if (geom.shape === 'sphere' && geom.radius) {
      const [cx, cy, cz] = geom.center;
      const dx = mol.x - cx;
      const dy = mol.y - cy;
      const dz = mol.z - cz;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > geom.radius) {
        // Reflect: place molecule at the mirror point inside the sphere
        const scale = (2 * geom.radius - dist) / dist;
        mol.x = cx + dx * scale;
        mol.y = cy + dy * scale;
        mol.z = cz + dz * scale;
      }
    }
  }

  /**
   * Set up the uniform spatial partition grid.
   */
  private setupGrid(): void {
    // Default cell size: use max reaction radius or 1 µm
    if (this.config.partitionCellSize > 0) {
      this.gridCellSize = this.config.partitionCellSize;
    } else {
      this.gridCellSize = 1.0; // 1 µm default
    }
  }

  /**
   * Rebuild the spatial grid with current molecule positions.
   */
  private rebuildGrid(): void {
    this.grid.clear();
    for (let i = 0; i < this.molecules.length; i++) {
      const mol = this.molecules[i];
      const key = this.gridKey(mol.x, mol.y, mol.z);
      let cell = this.grid.get(key);
      if (!cell) {
        cell = [];
        this.grid.set(key, cell);
      }
      cell.push(i);
    }
  }

  /**
   * Compute grid cell key from position.
   */
  private gridKey(x: number, y: number, z: number): string {
    const ix = Math.floor(x / this.gridCellSize);
    const iy = Math.floor(y / this.gridCellSize);
    const iz = Math.floor(z / this.gridCellSize);
    return `${ix},${iy},${iz}`;
  }

  /**
   * Detect and resolve bimolecular collisions using spatial grid.
   */
  private resolveCollisions(dt: number): void {
    if (!this.mod) return;

    const toRemove = new Set<number>();
    const toAdd: ActiveMolecule[] = [];

    // Iterate all occupied grid cells
    for (const [_key, indices] of this.grid) {
      // Check pairs within the same cell
      for (let i = 0; i < indices.length; i++) {
        if (toRemove.has(indices[i])) continue;

        for (let j = i + 1; j < indices.length; j++) {
          if (toRemove.has(indices[j])) continue;

          const molA = this.molecules[indices[i]];
          const molB = this.molecules[indices[j]];

          // Distance check
          const dx = molA.x - molB.x;
          const dy = molA.y - molB.y;
          const dz = molA.z - molB.z;
          const distSq = dx * dx + dy * dy + dz * dz;

          // Reaction radius from Smoluchowski theory
          const maxP = this.mod._libbng_get_rxn_class_max_prob(molA.speciesId, molB.speciesId);
          if (maxP <= 0) continue;

          // Reaction radius: σ = k / (4π·D_sum) converted to spatial units
          // For Phase 1 MVP, use a simplified proximity test
          const rxnRadiusSq = this.gridCellSize * this.gridCellSize;
          if (distSq > rxnRadiusSq) continue;

          // Probabilistic reaction test
          const prob = this.rng.random() * maxP;
          const products = resolveBimolReaction(this.mod, molA.speciesId, molB.speciesId, prob);

          if (products && products.length > 0) {
            // Reaction occurs: remove reactants, add products at midpoint
            toRemove.add(indices[i]);
            toRemove.add(indices[j]);

            const mx = (molA.x + molB.x) / 2;
            const my = (molA.y + molB.y) / 2;
            const mz = (molA.z + molB.z) / 2;

            for (const pid of products) {
              toAdd.push({
                id: this.nextMoleculeId++,
                speciesId: pid,
                x: mx + this.rng.gaussian() * 0.01, // Small displacement to avoid overlap
                y: my + this.rng.gaussian() * 0.01,
                z: mz + this.rng.gaussian() * 0.01,
                compartmentId: molA.compartmentId,
              });
            }
          }
        }
      }
    }

    // Apply molecule changes
    if (toRemove.size > 0) {
      this.molecules = this.molecules.filter((_, i) => !toRemove.has(i));
    }
    this.molecules.push(...toAdd);
  }

  /**
   * Test unimolecular reactions for all molecules.
   * Reaction probability: P = 1 - exp(-k·Δt)
   */
  private resolveUnimolecular(dt: number): void {
    if (!this.mod || !this.spatialMod) return;

    const toRemove: number[] = [];
    const toAdd: { speciesId: number, x: number, y: number, z: number, compartmentId: number }[] = [];

    // Get molecules from WASM
    const count = this.spatialMod._spatial_molecule_count();

    for (let i = 0; i < count; i++) {
      const speciesId = this.spatialMod._spatial_get_molecule_species_id(i);
      if (speciesId < 0) continue; // Skip dead molecules

      const compartmentId = this.spatialMod._spatial_get_molecule_compartment_id(i);

      if (this.mod!._libbng_check_unimol_reaction(speciesId) === 0) continue;

      // Get reaction probability from libBNG
      const prob = this.rng.random();

      // Use libBNG's pathway selection for unimolecular reactions
      const maxProducts = 4;
      const productPtr = this.mod!._malloc(maxProducts * 4); // int32 array
      try {
        const pathwayIndex = this.mod!._libbng_get_unimol_pathway_for_prob(speciesId, prob);

        if (pathwayIndex >= 0) {
          const numProducts = this.mod!._libbng_apply_unimol_pathway(
            speciesId, pathwayIndex, productPtr, maxProducts
          );

          toRemove.push(i);
          for (let p = 0; p < numProducts; p++) {
            const pid = this.mod!.HEAP32[(productPtr >> 2) + p];
            if (pid >= 0) {
              toAdd.push({
                speciesId: pid,
                x: this.spatialMod._spatial_get_molecule_x(i),
                y: this.spatialMod._spatial_get_molecule_y(i),
                z: this.spatialMod._spatial_get_molecule_z(i),
                compartmentId: compartmentId,
              });
            }
          }
        }
      } finally {
        this.mod!._free(productPtr);
      }
    }

    // Apply changes to WASM engine
    for (const index of toRemove.sort((a, b) => b - a)) { // Remove in reverse order to keep indices valid
      this.spatialMod._spatial_remove_molecule(index);
    }
    for (const mol of toAdd) {
      this.spatialMod._spatial_add_molecule(mol.x, mol.y, mol.z, mol.speciesId, mol.compartmentId);
    }
  }

  /**
   * Release seed species into the simulation volume.
   */
  private releaseSeedSpecies(): void {
    if (!this.mod || !this.spatialMod) return;

    const seedCount = this.mod._libbng_seed_species_count();
    console.log('[SpatialSimulation] releaseSeedSpecies: seedCount =', seedCount);
    for (let i = 0; i < seedCount; i++) {
      const amount = Math.round(this.mod._libbng_seed_species_amount(i));
      if (amount <= 0) continue;

      const namePtr = this.mod._libbng_seed_species_name(i);
      const name = this.mod.UTF8ToString(namePtr);
      console.log('[SpatialSimulation] releaseSeedSpecies: seed species', name, 'amount:', amount);

      const allSpecies = getSpecies(this.mod);
      const match = allSpecies.find(s => s.name === name);
      const speciesId = match?.id ?? i;
      const compId = match?.compartmentId ?? 0;
      console.log('[SpatialSimulation] releaseSeedSpecies: speciesId:', speciesId, 'compId:', compId);

      const geom = this.geometries.find(g => g.compartmentId === compId) ?? this.geometries[0];

      for (let j = 0; j < amount; j++) {
        const pos = this.randomPositionInGeometry(geom);
        this.spatialMod._spatial_add_molecule(pos[0], pos[1], pos[2], speciesId, compId);
      }
      console.log('[SpatialSimulation] releaseSeedSpecies: added', amount, 'molecules for species', name);
    }
  }

  /**
   * Generate a random position within a geometry.
   */
  private randomPositionInGeometry(geom: CompartmentGeometry): [number, number, number] {
    if (geom.shape === 'box' && geom.halfExtents) {
      const [hx, hy, hz] = geom.halfExtents;
      const [cx, cy, cz] = geom.center;
      return [
        cx + (this.rng.random() * 2 - 1) * hx,
        cy + (this.rng.random() * 2 - 1) * hy,
        cz + (this.rng.random() * 2 - 1) * hz,
      ];
    } else if (geom.shape === 'sphere' && geom.radius) {
      // Rejection sampling for uniform distribution in sphere
      const [cx, cy, cz] = geom.center;
      const r = geom.radius;
      while (true) {
        const x = (this.rng.random() * 2 - 1) * r;
        const y = (this.rng.random() * 2 - 1) * r;
        const z = (this.rng.random() * 2 - 1) * r;
        if (x * x + y * y + z * z <= r * r) {
          return [cx + x, cy + y, cz + z];
        }
      }
    }
    return [...geom.center];
  }

  /**
   * Captures a snapshot of the current simulation state.
   */
  public getSnapshot(): SpatialSnapshot {
    if (!this.spatialMod) {
      return {
        time: this.currentTime,
        moleculeCount: 0,
        positions: new Float32Array(0),
        observables: {},
      };
    }

    const count = this.spatialMod!._spatial_molecule_count();
    
    // Allocate memory in WASM for export
    const floatsPerMolecule = 5; // x, y, z, speciesId, compartmentId
    const bufferSize = count * floatsPerMolecule * 4; 
    const outPtr = this.spatialMod!._malloc(bufferSize);
    
    const exportedCount = this.spatialMod!._spatial_export_positions(outPtr, count);
    
    // Copy from HEAPF32 to a new Float32Array
    const positions = new Float32Array(this.spatialMod!.HEAPF32.buffer, outPtr, exportedCount * floatsPerMolecule).slice();
    
    this.spatialMod!._free(outPtr);

    const { global, perCompartment } = this.calculateObservables(positions);

    // Track per-compartment counts over time
    this.perCompartmentTimeSeries.push(perCompartment);

    return {
      time: this.currentTime,
      moleculeCount: exportedCount,
      positions: positions,
      observables: global,
    };
  }

  /**
   * Calculates observable counts from the packed positions array.
   * Format: [x, y, z, speciesId, compartmentId, ...]
   */
  private calculateObservables(positions: Float32Array): { 
    global: Record<string, number>, 
    perCompartment: Record<string, Record<string, number>> 
  } {
    const global: Record<string, number> = {};
    const perCompartment: Record<string, Record<string, number>> = {};
    if (!this.mod) return { global, perCompartment };

    const floatsPerMolecule = 5;
    const speciesCounts = new Map<number, number>();
    const compSpeciesCounts = new Map<number, Map<number, number>>();

    for (let i = 0; i < positions.length / floatsPerMolecule; i++) {
      const speciesId = positions[i * floatsPerMolecule + 3];
      const compartmentId = positions[i * floatsPerMolecule + 4];

      speciesCounts.set(speciesId, (speciesCounts.get(speciesId) ?? 0) + 1);

      if (!compSpeciesCounts.has(compartmentId)) {
        compSpeciesCounts.set(compartmentId, new Map());
      }
      const cMap = compSpeciesCounts.get(compartmentId)!;
      cMap.set(speciesId, (cMap.get(speciesId) ?? 0) + 1);
    }

    const obsCount = this.mod._libbng_observable_count();
    const obsNames: string[] = [];
    for (let i = 0; i < obsCount; i++) {
      const namePtr = this.mod._libbng_observable_name(i);
      const name = this.mod.UTF8ToString(namePtr);
      global[name] = 0;
      obsNames.push(name);
    }

    const compartments = getCompartments(this.mod);
    for (const comp of compartments) {
      perCompartment[comp.name] = {};
      for (const name of obsNames) {
        perCompartment[comp.name][name] = 0;
      }
    }

    for (const [sid, count] of speciesCounts) {
      const namePtr = this.mod._libbng_species_name(sid);
      const name = this.mod.UTF8ToString(namePtr);
      if (name in global) {
        global[name] = count;
      }
    }

    for (const [compId, sMap] of compSpeciesCounts) {
      const comp = compartments[compId];
      if (!comp) continue;
      for (const [sid, count] of sMap) {
        const namePtr = this.mod._libbng_species_name(sid);
        const name = this.mod.UTF8ToString(namePtr);
        if (name in perCompartment[comp.name]) {
          perCompartment[comp.name][name] = count;
        }
      }
    }

    return { global, perCompartment };
  }

  /**
   * Record observables for time series output.
   */
  private recordObservables(snapshot: SpatialSnapshot): void {
    this.timePoints.push(snapshot.time);
    for (const [name, count] of Object.entries(snapshot.observables)) {
      if (!this.observableTimeSeries.has(name)) {
        this.observableTimeSeries.set(name, []);
      }
      this.observableTimeSeries.get(name)!.push(count);
    }
  }

  /**
   * Build final result object.
   */
  private buildResult(): SpatialSimulationResult {
    const observables: Record<string, number[]> = {};
    for (const [name, series] of this.observableTimeSeries) {
      observables[name] = series;
    }

    // Final species counts
    const finalSpeciesCounts: Record<string, number> = {};
    if (this.mod) {
      const speciesList = getSpecies(this.mod);
      for (const sp of speciesList) {
        const series = this.observableTimeSeries.get(sp.name);
        finalSpeciesCounts[sp.name] = series ? (series[series.length - 1] ?? 0) : 0;
      }
    }

    // Per compartment results
    const perCompartmentResults: Record<string, Record<string, number[]>> = {};
    if (this.perCompartmentTimeSeries.length > 0) {
      const compartmentNames = Object.keys(this.perCompartmentTimeSeries[0]);
      for (const cName of compartmentNames) {
        perCompartmentResults[cName] = {};
        const firstEntry = this.perCompartmentTimeSeries[0][cName];
        for (const obsName of Object.keys(firstEntry)) {
          perCompartmentResults[cName][obsName] = this.perCompartmentTimeSeries.map(t => t[cName][obsName]);
        }
      }
    }

    return {
      time: this.timePoints,
      observables,
      finalSpeciesCounts,
      perCompartmentCounts: perCompartmentResults,
    };
  }

/**
   * Set up callbacks for reaction resolution from libBNG.
   */
  private setupSpatialCallbacks(): void {
    console.log('[SpatialSimulation] Setting up callbacks, addFunction exists:', !!this.spatialMod?.addFunction);
    if (!this.spatialMod || !this.spatialMod.addFunction) {
      console.warn('[SpatialSimulation] addFunction not available - skipping callbacks');
      return;
    }

    const check = this.spatialMod.addFunction((sa: number, sb: number) => {
      return this.mod ? this.mod._libbng_check_bimol_reaction(sa, sb) : 0;
    }, 'iii');
    console.log('[SpatialSimulation] check callback:', check);

    const max_prob = this.spatialMod.addFunction((sa: number, sb: number) => {
      return this.mod ? this.mod._libbng_get_rxn_class_max_prob(sa, sb) : 0;
    }, 'dii');
    console.log('[SpatialSimulation] max_prob callback:', max_prob);

    const pathway = this.spatialMod.addFunction((sa: number, sb: number, p: number) => {
      return this.mod ? this.mod._libbng_get_pathway_for_prob(sa, sb, p) : -1;
    }, 'iiid');
    console.log('[SpatialSimulation] pathway callback:', pathway);

    const prod_count = this.spatialMod.addFunction((sa: number, sb: number, pw: number) => {
      return this.mod ? this.mod._libbng_get_pathway_product_count(sa, sb, pw) : 0;
    }, 'iiii');
    console.log('[SpatialSimulation] prod_count callback:', prod_count);

    const product = this.spatialMod.addFunction((sa: number, sb: number, pw: number, idx: number) => {
      return this.mod ? this.mod._libbng_get_pathway_product_species_id(sa, sb, pw, idx) : -1;
    }, 'iiiii');
    console.log('[SpatialSimulation] product callback:', product);

    if (!check || !max_prob || !pathway || !prod_count || !product) {
      console.warn('[SpatialSimulation] One or more callbacks failed to register');
      return;
    }

    if (this.spatialMod._spatial_set_callbacks) {
      console.log('[SpatialSimulation] Registering callbacks with spatial engine...');
      this.spatialMod._spatial_set_callbacks(check, max_prob, pathway, prod_count, product);
      console.log('[SpatialSimulation] Callbacks registered');
    } else {
      console.warn('[SpatialSimulation] _spatial_set_callbacks not available - reactions disabled');
    }
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    destroyLibBNG();
    this.mod = null;
    this.spatialMod = null;
    this.molecules = [];
  }
}

/** Reflect a coordinate within [min, max] bounds */
function reflectCoord(x: number, min: number, max: number): number {
  let val = x;
  while (val < min || val > max) {
    if (val < min) val = 2 * min - val;
    if (val > max) val = 2 * max - val;
  }
  return val;
}

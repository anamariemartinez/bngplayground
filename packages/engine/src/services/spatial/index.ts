/**
 * packages/engine/src/services/spatial/index.ts
 *
 * Barrel export for the spatial simulation module.
 */

export { loadLibBNG, initLibBNG, destroyLibBNG, getSpecies, getCompartments, getParameter, resolveBimolReaction, PATHWAY_INDEX_NO_RXN } from './LibBNGLoader';
export type { LibBNGModule } from './LibBNGLoader';

export { SpatialSimulation } from './SpatialSimulation';

export { autoGenerateGeometry, generateIcosphere } from './SpatialGeometry';
export type { ParsedCompartment } from './SpatialGeometry';

export { DEFAULT_SPATIAL_CONFIG, extractDiffusionConstants } from './SpatialConfig';
export type {
  SpatialSimulationConfig,
  SpatialSimulationResult,
  SpatialSnapshot,
  SpatialMoleculeType,
  SpatialMolecule,
  CompartmentGeometry,
  CustomGeometry,
  MeshDefinition,
} from './SpatialConfig';

/**
 * spatial-config.spec.ts — Tests for spatial simulation configuration.
 *
 * Tests:
 * 1. Default configuration values
 * 2. MCell4-compatible parameter extraction
 * 3. Configuration merging
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SPATIAL_CONFIG,
  extractDiffusionConstants,
} from '../packages/engine/src/services/spatial/SpatialConfig';

describe('SpatialConfig', () => {
  describe('DEFAULT_SPATIAL_CONFIG', () => {
    it('should have sensible default values', () => {
      expect(DEFAULT_SPATIAL_CONFIG.dt).toBe(1e-6);
      expect(DEFAULT_SPATIAL_CONFIG.tEnd).toBe(1e-3);
      expect(DEFAULT_SPATIAL_CONFIG.nOutput).toBe(100);
      expect(DEFAULT_SPATIAL_CONFIG.seed).toBe(1);
      expect(DEFAULT_SPATIAL_CONFIG.geometry).toBe('auto');
      expect(DEFAULT_SPATIAL_CONFIG.nReplicates).toBe(1);
      expect(DEFAULT_SPATIAL_CONFIG.reactionModel).toBe('smoluchowski');
      expect(DEFAULT_SPATIAL_CONFIG.partitionCellSize).toBe(0);
      expect(DEFAULT_SPATIAL_CONFIG.periodic).toBe(false);
    });
  });

  describe('extractDiffusionConstants', () => {
    it('should extract 3D diffusion constants with MCELL_ prefix', () => {
      const params = new Map<string, number>([
        ['MCELL_DIFFUSION_CONSTANT_3D_A', 1e-6],
        ['MCELL_DIFFUSION_CONSTANT_3D_B', 2e-6],
        ['other_param', 42],
      ]);

      const result = extractDiffusionConstants(params);

      expect(result.size).toBe(2);
      expect(result.get('A')).toEqual({ constant: 1e-6, dimension: 3 });
      expect(result.get('B')).toEqual({ constant: 2e-6, dimension: 3 });
    });

    it('should extract 2D diffusion constants', () => {
      const params = new Map<string, number>([
        ['MCELL_DIFFUSION_CONSTANT_2D_M', 5e-7],
      ]);

      const result = extractDiffusionConstants(params);
      expect(result.size).toBe(1);
      expect(result.get('M')).toEqual({ constant: 5e-7, dimension: 2 });
    });

    it('should handle mixed 2D and 3D molecules', () => {
      const params = new Map<string, number>([
        ['MCELL_DIFFUSION_CONSTANT_3D_Ligand', 1e-6],
        ['MCELL_DIFFUSION_CONSTANT_2D_Receptor', 5e-8],
        ['kf', 1e7],
        ['MCELL_DIFFUSION_CONSTANT_3D_Product', 1.5e-6],
      ]);

      const result = extractDiffusionConstants(params);
      expect(result.size).toBe(3);
      expect(result.get('Ligand')!.dimension).toBe(3);
      expect(result.get('Receptor')!.dimension).toBe(2);
      expect(result.get('Product')!.dimension).toBe(3);
    });

    it('should return empty map when no MCELL_ parameters exist', () => {
      const params = new Map<string, number>([
        ['kf', 1e7],
        ['kr', 1e-2],
      ]);

      const result = extractDiffusionConstants(params);
      expect(result.size).toBe(0);
    });
  });
});

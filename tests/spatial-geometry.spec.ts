/**
 * spatial-geometry.spec.ts — Tests for spatial geometry auto-generation.
 *
 * Tests:
 * 1. Auto-generate geometry from basic compartmental BNGL-style definitions
 * 2. Nested compartment hierarchy
 * 3. Default box generation when no compartments are defined
 * 4. Icosphere mesh generation
 * 5. Volume-to-radius conversion correctness
 */

import { describe, it, expect } from 'vitest';
import {
  autoGenerateGeometry,
  generateIcosphere,
} from '../packages/engine/src/services/spatial/SpatialGeometry';
import type { ParsedCompartment } from '../packages/engine/src/services/spatial/SpatialGeometry';

describe('SpatialGeometry', () => {
  describe('autoGenerateGeometry', () => {
    it('should generate a default box when no compartments are defined', () => {
      const geometries = autoGenerateGeometry([]);
      expect(geometries).toHaveLength(1);
      expect(geometries[0].shape).toBe('box');
      expect(geometries[0].name).toBe('default');
      expect(geometries[0].dimension).toBe(3);
      expect(geometries[0].parentId).toBeNull();
      expect(geometries[0].halfExtents).toBeDefined();
    });

    it('should convert a single 3D compartment to a sphere', () => {
      const compartments: ParsedCompartment[] = [
        { name: 'EC', dimension: 3, size: 1000 }, // 1000 µm³
      ];
      const geometries = autoGenerateGeometry(compartments);
      expect(geometries).toHaveLength(1);
      expect(geometries[0].shape).toBe('sphere');
      expect(geometries[0].name).toBe('EC');
      expect(geometries[0].dimension).toBe(3);
      expect(geometries[0].radius).toBeDefined();

      // Check volume: V = (4/3)πr³
      const r = geometries[0].radius!;
      const computedVolume = (4 / 3) * Math.PI * r * r * r;
      expect(computedVolume).toBeCloseTo(1000, 1);
    });

    it('should nest compartments correctly: EC > PM > CP', () => {
      // Standard cell model: ExtraCellular > PlasmaMembrane > Cytoplasm
      const compartments: ParsedCompartment[] = [
        { name: 'EC', dimension: 3, size: 10000 },
        { name: 'PM', dimension: 2, size: 100, parent: 'EC' },
        { name: 'CP', dimension: 3, size: 1000, parent: 'PM' },
      ];
      const geometries = autoGenerateGeometry(compartments);

      // Should produce 3 geometries
      expect(geometries.length).toBe(3);

      // EC is root (parentId === null)
      const ec = geometries.find(g => g.name === 'EC');
      expect(ec).toBeDefined();
      expect(ec!.parentId).toBeNull();

      // PM is child of EC
      const pm = geometries.find(g => g.name === 'PM');
      expect(pm).toBeDefined();
      expect(pm!.parentId).toBe(ec!.compartmentId);
      expect(pm!.dimension).toBe(2);

      // CP is child of PM
      const cp = geometries.find(g => g.name === 'CP');
      expect(cp).toBeDefined();
      expect(cp!.parentId).toBe(pm!.compartmentId);
      expect(cp!.dimension).toBe(3);

      // CP should fit inside EC
      expect(cp!.radius!).toBeLessThan(ec!.radius!);
    });

    it('should handle multiple root compartments', () => {
      const compartments: ParsedCompartment[] = [
        { name: 'A', dimension: 3, size: 500 },
        { name: 'B', dimension: 3, size: 700 },
      ];
      const geometries = autoGenerateGeometry(compartments);
      expect(geometries).toHaveLength(2);
      expect(geometries[0].parentId).toBeNull();
      expect(geometries[1].parentId).toBeNull();
    });
  });

  describe('generateIcosphere', () => {
    it('should generate a valid icosphere with correct subdivision levels', () => {
      const center: [number, number, number] = [0, 0, 0];
      const radius = 5;

      // Level 0: icosahedron (12 vertices, 20 faces)
      const level0 = generateIcosphere(center, radius, 0);
      expect(level0.vertices.length).toBe(12 * 3); // 12 vertices * 3 coords
      expect(level0.faces.length).toBe(20 * 3);     // 20 faces * 3 indices

      // Level 1: 42 vertices, 80 faces
      const level1 = generateIcosphere(center, radius, 1);
      expect(level1.vertices.length).toBe(42 * 3);
      expect(level1.faces.length).toBe(80 * 3);

      // Level 2: 162 vertices, 320 faces
      const level2 = generateIcosphere(center, radius, 2);
      expect(level2.vertices.length).toBe(162 * 3);
      expect(level2.faces.length).toBe(320 * 3);
    });

    it('should place all vertices at the specified radius from center', () => {
      const center: [number, number, number] = [1, 2, 3];
      const radius = 4;
      const { vertices } = generateIcosphere(center, radius, 1);

      for (let i = 0; i < vertices.length / 3; i++) {
        const dx = vertices[i * 3] - center[0];
        const dy = vertices[i * 3 + 1] - center[1];
        const dz = vertices[i * 3 + 2] - center[2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        expect(dist).toBeCloseTo(radius, 3);
      }
    });

    it('should generate valid face indices', () => {
      const { vertices, faces } = generateIcosphere([0, 0, 0], 1, 2);
      const numVertices = vertices.length / 3;

      for (let i = 0; i < faces.length; i++) {
        expect(faces[i]).toBeGreaterThanOrEqual(0);
        expect(faces[i]).toBeLessThan(numVertices);
      }
    });
  });
});

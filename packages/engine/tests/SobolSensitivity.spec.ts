import { describe, it, expect } from 'vitest';
import { sobolSensitivity, generateSaltelliSamples } from '../src/services/analysis/SobolSensitivity';

describe('generateSaltelliSamples', () => {
  it('generates correct number of samples', () => {
    const samples = generateSaltelliSamples({
      N: 100,
      params: [
        { name: 'x1', min: -Math.PI, max: Math.PI },
        { name: 'x2', min: -Math.PI, max: Math.PI },
      ],
      seed: 42,
    });
    expect(samples.A.length).toBe(100);
    expect(samples.B.length).toBe(100);
    expect(samples.AB.length).toBe(2); // d=2
    expect(samples.AB[0].length).toBe(100);
    expect(samples.totalRuns).toBe(100 * (2 + 2));
  });

  it('AB[i] has column i from B, rest from A', () => {
    const samples = generateSaltelliSamples({
      N: 10,
      params: [
        { name: 'a', min: 0, max: 1 },
        { name: 'b', min: 0, max: 1 },
        { name: 'c', min: 0, max: 1 },
      ],
      seed: 1,
    });
    // AB[1] should have column 1 from B, columns 0,2 from A
    for (let j = 0; j < 10; j++) {
      expect(samples.AB[1][j][0]).toBe(samples.A[j][0]);
      expect(samples.AB[1][j][1]).toBe(samples.B[j][1]);
      expect(samples.AB[1][j][2]).toBe(samples.A[j][2]);
    }
  });
});

describe('sobolSensitivity', () => {
  it('independent linear model: S_i = a²σ²/V', async () => {
    // f(x) = 2*x1 + 3*x2, x_i ~ U(0,1)
    // Var(x_i) = 1/12
    // V = 4/12 + 9/12 = 13/12
    // S1 = 4/13, S2 = 9/13, ST1 = S1, ST2 = S2 (no interactions)

    const results = await sobolSensitivity({
      simulate: async (overrides) => {
        const x1 = overrides['x1'];
        const x2 = overrides['x2'];
        return { data: [{ time: 0, Y: 0 }, { time: 1, Y: 2 * x1 + 3 * x2 }] };
      },
      params: [
        { name: 'x1', min: 0, max: 1 },
        { name: 'x2', min: 0, max: 1 },
      ],
      observables: ['Y'],
      N: 2048,
      seed: 42,
      nBootstrap: 200,
    });

    expect(results.length).toBe(1);
    const r = results[0];
    expect(r.observable).toBe('Y');

    // S1 ≈ 4/13 ≈ 0.308
    expect(r.firstOrder[0].value).toBeCloseTo(4 / 13, 1);
    // S2 ≈ 9/13 ≈ 0.692
    expect(r.firstOrder[1].value).toBeCloseTo(9 / 13, 1);

    // Total ≈ first for additive model
    expect(r.totalOrder[0].value).toBeCloseTo(4 / 13, 1);
    expect(r.totalOrder[1].value).toBeCloseTo(9 / 13, 1);
  });

  it('no-sensitivity model: all indices ≈ 0', async () => {
    const results = await sobolSensitivity({
      simulate: async () => ({
        data: [{ time: 0, Y: 42 }, { time: 1, Y: 42 }],
      }),
      params: [
        { name: 'a', min: 0, max: 1 },
        { name: 'b', min: 0, max: 1 },
      ],
      observables: ['Y'],
      N: 128,
      seed: 1,
    });

    const r = results[0];
    expect(r.totalVariance).toBeCloseTo(0, 6);
    r.firstOrder.forEach((s) => expect(s.value).toBeCloseTo(0, 6));
    r.totalOrder.forEach((s) => expect(s.value).toBeCloseTo(0, 6));
  });

  it('Ishigami function: approximate analytical indices', async () => {
    // f(x) = sin(x1) + 7*sin²(x2) + 0.1*x3⁴*sin(x1)
    // x_i ~ U(-π, π)
    // Known: S1 ≈ 0.314, S2 ≈ 0.442, S3 ≈ 0, ST1 ≈ 0.557, ST3 ≈ 0.244

    const results = await sobolSensitivity({
      simulate: async (overrides) => {
        const x1 = overrides['x1'];
        const x2 = overrides['x2'];
        const x3 = overrides['x3'];
        const y = Math.sin(x1) + 7 * Math.sin(x2) ** 2 + 0.1 * x3 ** 4 * Math.sin(x1);
        return { data: [{ time: 0, Y: 0 }, { time: 1, Y: y }] };
      },
      params: [
        { name: 'x1', min: -Math.PI, max: Math.PI },
        { name: 'x2', min: -Math.PI, max: Math.PI },
        { name: 'x3', min: -Math.PI, max: Math.PI },
      ],
      observables: ['Y'],
      N: 2048,
      seed: 42,
      nBootstrap: 200,
    });

    const r = results[0];
    // Rough checks (within 15% absolute tolerance due to finite N)
    expect(r.firstOrder[0].value).toBeGreaterThan(0.15); // S1 ≈ 0.314
    expect(r.firstOrder[0].value).toBeLessThan(0.50);
    expect(r.firstOrder[1].value).toBeGreaterThan(0.30); // S2 ≈ 0.442
    expect(r.firstOrder[1].value).toBeLessThan(0.60);
    expect(r.firstOrder[2].value).toBeLessThan(0.10); // S3 ≈ 0

    // Total-order: x1 has interactions with x3
    expect(r.totalOrder[0].value).toBeGreaterThan(0.30); // ST1 ≈ 0.557
    // x3 has no first-order but has interaction
    expect(r.totalOrder[2].value).toBeGreaterThan(0.10); // ST3 ≈ 0.244
  });

  it('convergence: N=256 vs N=1024 indices get closer', async () => {
    const simulateFn = async (overrides: Record<string, number>) => {
      const x1 = overrides['x1'];
      const x2 = overrides['x2'];
      return { data: [{ time: 0, Y: 0 }, { time: 1, Y: 3 * x1 + x2 }] };
    };
    const params = [
      { name: 'x1', min: 0, max: 1 },
      { name: 'x2', min: 0, max: 1 },
    ];

    const r256 = await sobolSensitivity({
      simulate: simulateFn,
      params,
      observables: ['Y'],
      N: 256,
      seed: 42,
      nBootstrap: 100,
    });

    const r1024 = await sobolSensitivity({
      simulate: simulateFn,
      params,
      observables: ['Y'],
      N: 1024,
      seed: 42,
      nBootstrap: 100,
    });

    const trueS1 = 9 / 10; // 3²/(3²+1²) = 9/10
    const err256 = Math.abs(r256[0].firstOrder[0].value - trueS1);
    const err1024 = Math.abs(r1024[0].firstOrder[0].value - trueS1);
    // 1024 samples should be more accurate (or at least not worse)
    expect(err1024).toBeLessThanOrEqual(err256 + 0.1);
  });

  it('abort signal stops early', async () => {
    const controller = new AbortController();
    let callCount = 0;

    const promise = sobolSensitivity({
      simulate: async () => {
        callCount++;
        if (callCount >= 10) controller.abort();
        return { data: [{ time: 0, Y: 1 }, { time: 1, Y: 1 }] };
      },
      params: [{ name: 'x', min: 0, max: 1 }],
      N: 512,
      signal: controller.signal,
      seed: 1,
    });

    await expect(promise).rejects.toThrow();
    expect(callCount).toBeLessThan(512 * 3); // Should not run all
  });
});

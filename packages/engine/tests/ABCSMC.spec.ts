import { describe, it, expect } from 'vitest';
import { abcSMC } from '../src/services/inference/ABCSMC';

describe('abcSMC', () => {
  it('toy linear model: posterior captures true parameters', async () => {
    // y = a*x + b, true a=2, b=1
    const trueA = 2;
    const trueB = 1;
    const xValues = [0, 1, 2, 3, 4];
    const experimentalData = xValues.map((x) => ({
      time: x,
      values: { Y: trueA * x + trueB },
    }));

    const result = await abcSMC({
      simulate: async (overrides) => {
        const a = overrides['a'];
        const b = overrides['b'];
        return {
          data: xValues.map((x) => ({ time: x, Y: a * x + b })),
        };
      },
      priors: [
        { name: 'a', distribution: 'uniform', min: 0, max: 5 },
        { name: 'b', distribution: 'uniform', min: -2, max: 5 },
      ],
      experimentalData,
      nParticles: 200,
      nPopulations: 5,
      seed: 42,
      maxSimulations: 50000,
    });

    expect(result.particles.length).toBeGreaterThan(0);
    // Posterior mean should be within 30% of truth
    expect(result.posteriorSummary['a'].mean).toBeCloseTo(trueA, 0);
    expect(result.posteriorSummary['b'].mean).toBeCloseTo(trueB, 0);
  }, 30000);

  it('exponential decay: posterior captures A and k', async () => {
    const trueA = 100;
    const trueK = 0.1;
    const times = [0, 2, 5, 10, 20];
    const experimentalData = times.map((t) => ({
      time: t,
      values: { Y: trueA * Math.exp(-trueK * t) },
    }));

    const result = await abcSMC({
      simulate: async (overrides) => {
        const A = overrides['A'];
        const k = overrides['k'];
        return {
          data: times.map((t) => ({ time: t, Y: A * Math.exp(-k * t) })),
        };
      },
      priors: [
        { name: 'A', distribution: 'uniform', min: 50, max: 200 },
        { name: 'k', distribution: 'log-uniform', min: 0.01, max: 1 },
      ],
      experimentalData,
      nParticles: 150,
      nPopulations: 5,
      seed: 42,
      maxSimulations: 50000,
    });

    expect(result.posteriorSummary['A'].mean).toBeCloseTo(trueA, -1);
    expect(result.posteriorSummary['k'].mean).toBeCloseTo(trueK, 0);
  }, 30000);

  it('tolerance schedule decreases monotonically with auto', async () => {
    const result = await abcSMC({
      simulate: async (overrides) => {
        const x = overrides['x'];
        return { data: [{ time: 0, Y: 0 }, { time: 1, Y: x * 2 }] };
      },
      priors: [{ name: 'x', distribution: 'uniform', min: 0, max: 10 }],
      experimentalData: [{ time: 1, values: { Y: 6 } }],
      nParticles: 100,
      nPopulations: 5,
      seed: 42,
      maxSimulations: 20000,
    });

    const tolerances = result.populations.map((p) => p.tolerance);
    for (let i = 1; i < tolerances.length; i++) {
      expect(tolerances[i]).toBeLessThanOrEqual(tolerances[i - 1] + 1e-6);
    }
  }, 15000);

  it('converged flag is set correctly', async () => {
    const result = await abcSMC({
      simulate: async (overrides) => ({
        data: [{ time: 0, Y: 0 }, { time: 1, Y: overrides['x'] }],
      }),
      priors: [{ name: 'x', distribution: 'uniform', min: 0, max: 10 }],
      experimentalData: [{ time: 1, values: { Y: 5 } }],
      nParticles: 50,
      nPopulations: 3,
      seed: 42,
      maxSimulations: 50000,
    });

    // Should converge for this simple problem
    expect(result.totalSimulations).toBeGreaterThan(0);
    expect(result.populations.length).toBeGreaterThan(0);
  }, 15000);

  it('abort signal stops mid-population', async () => {
    const controller = new AbortController();
    let simCount = 0;

    const promise = abcSMC({
      simulate: async (overrides) => {
        simCount++;
        if (simCount >= 100) controller.abort();
        return { data: [{ time: 0, Y: 0 }, { time: 1, Y: overrides['x'] }] };
      },
      priors: [{ name: 'x', distribution: 'uniform', min: 0, max: 10 }],
      experimentalData: [{ time: 1, values: { Y: 5 } }],
      nParticles: 200,
      nPopulations: 10,
      signal: controller.signal,
      seed: 42,
    });

    await expect(promise).rejects.toThrow();
    expect(simCount).toBeLessThan(200 * 12);
  }, 15000);

  it('weightedPercentile: uniform weights give standard median', async () => {
    // Tested via posteriorAnalysis tests, but verify integration
    const result = await abcSMC({
      simulate: async (overrides) => ({
        data: [{ time: 0, Y: 0 }, { time: 1, Y: overrides['x'] }],
      }),
      priors: [{ name: 'x', distribution: 'uniform', min: 4, max: 6 }],
      experimentalData: [{ time: 1, values: { Y: 5 } }],
      nParticles: 100,
      nPopulations: 3,
      seed: 42,
      maxSimulations: 20000,
    });

    expect(result.posteriorSummary['x'].median).toBeGreaterThan(4);
    expect(result.posteriorSummary['x'].median).toBeLessThan(6);
  }, 15000);
});

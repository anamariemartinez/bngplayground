import { describe, it, expect } from 'vitest';
import {
  weightedPercentile,
  weightedStats,
  kde,
  effectiveSampleSize,
  systematicResample,
  weightedCovariance,
  interpolateAtTime,
} from '../src/services/inference/posteriorAnalysis';
import { SeededRandom } from '../src/utils/random';

describe('weightedPercentile', () => {
  it('returns median with uniform weights', () => {
    const values = [1, 2, 3, 4, 5];
    const weights = [1, 1, 1, 1, 1];
    expect(weightedPercentile(values, weights, 0.5)).toBe(3);
  });

  it('returns correct median with skewed weights', () => {
    // [1, 2, 3] with weights [0.5, 0.25, 0.25]
    // cumulative: 0.5, 0.75, 1.0 → at p=0.5, reach 0.5 at index 0
    const result = weightedPercentile([1, 2, 3], [0.5, 0.25, 0.25], 0.5);
    expect(result).toBe(1);
  });

  it('returns min at p=0', () => {
    expect(weightedPercentile([5, 3, 8], [1, 1, 1], 0)).toBe(3);
  });

  it('returns max at p=1', () => {
    expect(weightedPercentile([5, 3, 8], [1, 1, 1], 1)).toBe(8);
  });
});

describe('weightedStats', () => {
  it('returns correct mean and std for uniform weights', () => {
    const values = [2, 4, 6];
    const weights = [1, 1, 1];
    const { mean, std } = weightedStats(values, weights);
    expect(mean).toBeCloseTo(4, 10);
    // std = sqrt(((2-4)² + (4-4)² + (6-4)²) / 3) = sqrt(8/3)
    expect(std).toBeCloseTo(Math.sqrt(8 / 3), 6);
  });

  it('returns correct weighted mean', () => {
    const values = [10, 20];
    const weights = [3, 1];
    const { mean } = weightedStats(values, weights);
    expect(mean).toBeCloseTo(12.5, 10);
  });
});

describe('kde', () => {
  it('peak near mean for Gaussian samples', () => {
    const rng = new SeededRandom(42);
    const samples: number[] = [];
    for (let i = 0; i < 500; i++) {
      // Crude normal: mean=5, std=1 (Box-Muller)
      let u1 = rng.next();
      while (u1 === 0) u1 = rng.next();
      const u2 = rng.next();
      samples.push(5 + Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2));
    }
    const weights = new Array(samples.length).fill(1);

    const { x, density } = kde(samples, weights, 100);

    // Find peak
    let maxIdx = 0;
    for (let i = 1; i < density.length; i++) {
      if (density[i] > density[maxIdx]) maxIdx = i;
    }
    expect(x[maxIdx]).toBeCloseTo(5, 0);
  });

  it('returns correct number of points', () => {
    const { x, density } = kde([1, 2, 3], [1, 1, 1], 50);
    expect(x.length).toBe(50);
    expect(density.length).toBe(50);
  });
});

describe('effectiveSampleSize', () => {
  it('ESS of uniform weights = n', () => {
    const weights = [1, 1, 1, 1, 1];
    expect(effectiveSampleSize(weights)).toBeCloseTo(5, 10);
  });

  it('ESS of degenerate weights ≈ 1', () => {
    const weights = [1, 0, 0, 0, 0];
    expect(effectiveSampleSize(weights)).toBeCloseTo(1, 10);
  });

  it('ESS decreases with weight concentration', () => {
    const uniform = effectiveSampleSize([1, 1, 1, 1]);
    const skewed = effectiveSampleSize([3, 1, 1, 1]);
    expect(skewed).toBeLessThan(uniform);
  });

  it('returns 0 for empty weights', () => {
    expect(effectiveSampleSize([])).toBe(0);
  });
});

describe('systematicResample', () => {
  it('preserves distribution shape', () => {
    // Particle at index 0 has weight 0.9, others 0.025 each
    const weights = [0.9, 0.025, 0.025, 0.025, 0.025];
    const rng = new SeededRandom(42);
    const indices = systematicResample(weights, 100, rng);

    // Most should be index 0
    const count0 = indices.filter((i) => i === 0).length;
    expect(count0).toBeGreaterThan(80);
  });

  it('returns correct number of samples', () => {
    const weights = [1, 2, 3];
    const rng = new SeededRandom(42);
    expect(systematicResample(weights, 10, rng).length).toBe(10);
  });
});

describe('weightedCovariance', () => {
  it('computes correct covariance for uncorrelated data', () => {
    const particles = [[1, 10], [2, 20], [3, 30]];
    const weights = [1, 1, 1];
    const cov = weightedCovariance(particles, weights);
    // Variance of [1,2,3] = 2/3, covariance should be proportional
    expect(cov[0][0]).toBeCloseTo(2 / 3, 6);
    // Cov matrix is symmetric
    expect(cov[0][1]).toBeCloseTo(cov[1][0], 10);
  });
});

describe('interpolateAtTime', () => {
  const data = [
    { time: 0, A: 100 },
    { time: 1, A: 80 },
    { time: 2, A: 60 },
  ];

  it('returns exact value at data point', () => {
    expect(interpolateAtTime(data, 1, 'A')).toBe(80);
  });

  it('linearly interpolates between points', () => {
    expect(interpolateAtTime(data, 0.5, 'A')).toBeCloseTo(90, 10);
    expect(interpolateAtTime(data, 1.5, 'A')).toBeCloseTo(70, 10);
  });

  it('returns first value for time before range', () => {
    expect(interpolateAtTime(data, -1, 'A')).toBe(100);
  });

  it('returns last value for time after range', () => {
    expect(interpolateAtTime(data, 5, 'A')).toBe(60);
  });

  it('returns 0 for missing observable', () => {
    expect(interpolateAtTime(data, 1, 'B')).toBe(0);
  });
});

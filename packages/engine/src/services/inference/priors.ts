/**
 * priors.ts — Prior distribution implementations for Bayesian inference.
 *
 * Provides uniform, log-uniform, and normal prior distributions with
 * sampling, logPdf evaluation, and support bounds.
 */

import { SeededRandom } from '../../utils/random';

export interface PriorDistribution {
  /** Draw a random sample */
  sample(rng: SeededRandom): number;
  /** Log probability density at x */
  logPdf(x: number): number;
  /** Support interval [lower, upper] */
  support: [number, number];
}

export interface PriorSpec {
  name: string;
  distribution: 'uniform' | 'log-uniform' | 'normal';
  min?: number;
  max?: number;
  mean?: number;
  std?: number;
}

/**
 * Box-Muller transform to generate standard normal from uniform deviates.
 */
function boxMuller(rng: SeededRandom): number {
  let u1 = rng.next();
  // Avoid log(0)
  while (u1 === 0) u1 = rng.next();
  const u2 = rng.next();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Create a prior distribution from a spec.
 */
export function createPrior(spec: PriorSpec): PriorDistribution {
  switch (spec.distribution) {
    case 'uniform': {
      const min = spec.min ?? 0;
      const max = spec.max ?? 1;
      if (max <= min) throw new Error(`Uniform prior: max (${max}) must be > min (${min})`);
      const logWidth = -Math.log(max - min);
      return {
        sample(rng: SeededRandom): number {
          return min + rng.next() * (max - min);
        },
        logPdf(x: number): number {
          if (x < min || x > max) return -Infinity;
          return logWidth;
        },
        support: [min, max],
      };
    }

    case 'log-uniform': {
      const min = spec.min ?? 1e-6;
      const max = spec.max ?? 1;
      if (min <= 0) throw new Error(`Log-uniform prior: min (${min}) must be > 0`);
      if (max <= min) throw new Error(`Log-uniform prior: max (${max}) must be > min (${min})`);
      const logMin = Math.log(min);
      const logMax = Math.log(max);
      const logRange = logMax - logMin;
      return {
        sample(rng: SeededRandom): number {
          return Math.exp(logMin + rng.next() * logRange);
        },
        logPdf(x: number): number {
          if (x < min || x > max) return -Infinity;
          return -Math.log(x) - Math.log(logRange);
        },
        support: [min, max],
      };
    }

    case 'normal': {
      const mean = spec.mean ?? 0;
      const std = spec.std ?? 1;
      if (std <= 0) throw new Error(`Normal prior: std (${std}) must be > 0`);
      const logNorm = -Math.log(std * Math.sqrt(2 * Math.PI));
      const minBound = spec.min ?? -Infinity;
      const maxBound = spec.max ?? Infinity;
      return {
        sample(rng: SeededRandom): number {
          let val: number;
          let iter = 0;
          do {
            val = mean + std * boxMuller(rng);
            iter++;
          } while ((val < minBound || val > maxBound) && iter < 1000);
          return val;
        },
        logPdf(x: number): number {
          if (x < minBound || x > maxBound) return -Infinity;
          const z = (x - mean) / std;
          return logNorm - 0.5 * z * z;
        },
        support: [minBound, maxBound],
      };
    }

    default:
      throw new Error(`Unknown prior distribution: ${spec.distribution}`);
  }
}

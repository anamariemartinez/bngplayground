import { describe, it, expect } from 'vitest';
import { createPrior } from '../src/services/inference/priors';
import { SeededRandom } from '../src/utils/random';

describe('priors', () => {
  describe('uniform', () => {
    const prior = createPrior({ name: 'x', distribution: 'uniform', min: 2, max: 5 });

    it('all samples are in [min, max]', () => {
      const rng = new SeededRandom(42);
      for (let i = 0; i < 500; i++) {
        const s = prior.sample(rng);
        expect(s).toBeGreaterThanOrEqual(2);
        expect(s).toBeLessThanOrEqual(5);
      }
    });

    it('logPdf is constant inside support', () => {
      const expected = -Math.log(3); // width = 3
      expect(prior.logPdf(2.5)).toBeCloseTo(expected, 10);
      expect(prior.logPdf(4.9)).toBeCloseTo(expected, 10);
    });

    it('logPdf is -Infinity outside support', () => {
      expect(prior.logPdf(1)).toBe(-Infinity);
      expect(prior.logPdf(6)).toBe(-Infinity);
    });

    it('support is correct', () => {
      expect(prior.support).toEqual([2, 5]);
    });
  });

  describe('log-uniform', () => {
    const prior = createPrior({ name: 'k', distribution: 'log-uniform', min: 0.01, max: 100 });

    it('all samples are in [min, max]', () => {
      const rng = new SeededRandom(123);
      for (let i = 0; i < 500; i++) {
        const s = prior.sample(rng);
        expect(s).toBeGreaterThanOrEqual(0.01);
        expect(s).toBeLessThanOrEqual(100);
      }
    });

    it('logPdf at x=1 matches formula', () => {
      const logRange = Math.log(100 / 0.01);
      const expected = -Math.log(1) - Math.log(logRange);
      expect(prior.logPdf(1)).toBeCloseTo(expected, 10);
    });

    it('log-distributed: median of log(samples) ≈ midpoint in log space', () => {
      const rng = new SeededRandom(99);
      const logSamples: number[] = [];
      for (let i = 0; i < 5000; i++) {
        logSamples.push(Math.log(prior.sample(rng)));
      }
      logSamples.sort((a, b) => a - b);
      const median = logSamples[Math.floor(logSamples.length / 2)];
      const expected = (Math.log(0.01) + Math.log(100)) / 2;
      expect(median).toBeCloseTo(expected, 0);
    });

    it('logPdf is -Infinity outside support', () => {
      expect(prior.logPdf(0.001)).toBe(-Infinity);
      expect(prior.logPdf(200)).toBe(-Infinity);
    });
  });

  describe('normal', () => {
    const prior = createPrior({ name: 'mu', distribution: 'normal', mean: 5, std: 2 });

    it('samples have approximately correct mean', () => {
      const rng = new SeededRandom(777);
      let sum = 0;
      const n = 10000;
      for (let i = 0; i < n; i++) {
        sum += prior.sample(rng);
      }
      expect(sum / n).toBeCloseTo(5, 0);
    });

    it('samples have approximately correct std', () => {
      const rng = new SeededRandom(888);
      const samples: number[] = [];
      const n = 10000;
      for (let i = 0; i < n; i++) {
        samples.push(prior.sample(rng));
      }
      const mean = samples.reduce((a, b) => a + b, 0) / n;
      const variance = samples.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
      expect(Math.sqrt(variance)).toBeCloseTo(2, 0);
    });

    it('logPdf at mean is correct', () => {
      const expected = -Math.log(2 * Math.sqrt(2 * Math.PI));
      expect(prior.logPdf(5)).toBeCloseTo(expected, 10);
    });

    it('logPdf at mean±std is correct', () => {
      const expected = -Math.log(2 * Math.sqrt(2 * Math.PI)) - 0.5;
      expect(prior.logPdf(7)).toBeCloseTo(expected, 10);
      expect(prior.logPdf(3)).toBeCloseTo(expected, 10);
    });
  });

  describe('bounded normal', () => {
    const prior = createPrior({ name: 'y', distribution: 'normal', mean: 5, std: 2, min: 0, max: 10 });

    it('all samples respect bounds', () => {
      const rng = new SeededRandom(42);
      for (let i = 0; i < 1000; i++) {
        const s = prior.sample(rng);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(10);
      }
    });

    it('logPdf is -Infinity outside bounds', () => {
      expect(prior.logPdf(-1)).toBe(-Infinity);
      expect(prior.logPdf(11)).toBe(-Infinity);
    });
  });

  describe('error handling', () => {
    it('throws for min > max in uniform', () => {
      expect(() => createPrior({ name: 'x', distribution: 'uniform', min: 5, max: 2 })).toThrow();
    });

    it('throws for min <= 0 in log-uniform', () => {
      expect(() => createPrior({ name: 'x', distribution: 'log-uniform', min: 0, max: 1 })).toThrow();
    });

    it('throws for std <= 0 in normal', () => {
      expect(() => createPrior({ name: 'x', distribution: 'normal', mean: 0, std: 0 })).toThrow();
    });
  });
});

import { describe, expect, it } from 'vitest';
import {
    createSharedEnsembleResults,
    getSharedEnsembleFeatureVector,
    materializeSharedSimulationResult,
    writeSimulationResultsToShared,
} from '../../services/BnglWorkerPool';

describe('BnglWorkerPool shared ensemble helpers', () => {
    it('writes and materializes shared ensemble runs without copying per-read', () => {
        const shared = createSharedEnsembleResults(2, ['time', 'A', 'B'], 2);

        writeSimulationResultsToShared(shared, 0, {
            headers: ['time', 'A', 'B'],
            data: [
                { time: 0, A: 1, B: 2 },
                { time: 1, A: 3, B: 4 },
            ]
        });

        const run = materializeSharedSimulationResult(shared, 0);
        const featureVector = getSharedEnsembleFeatureVector(shared, 0);

        expect(run.headers).toEqual(['time', 'A', 'B']);
        expect(run.data).toEqual([
            { time: 0, A: 1, B: 2 },
            { time: 1, A: 3, B: 4 },
        ]);
        expect(featureVector).toEqual([0, 1, 2, 1, 3, 4]);
    });
});
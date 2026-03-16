export function reachedSteadyState(samples: number[]): boolean {
    if (samples.length < 6) {
        return false;
    }

    const tail = samples.slice(-5);
    const start = tail[0];
    const end = tail[tail.length - 1];
    const delta = Math.abs(end - start);
    const scale = Math.max(1e-9, Math.abs(start), Math.abs(end));
    return delta / scale < 0.01;
}

export function detectOscillation(samples: number[]): boolean {
    if (samples.length < 8) {
        return false;
    }

    const mean = samples.reduce((acc, value) => acc + value, 0) / samples.length;
    const minValue = Math.min(...samples);
    const maxValue = Math.max(...samples);
    const amplitude = maxValue - minValue;
    const scale = Math.max(1e-9, Math.abs(mean));
    if (amplitude / scale < 0.05) {
        return false;
    }

    let signChanges = 0;
    let lastSign = 0;
    for (let i = 1; i < samples.length; i++) {
        const diff = samples[i] - samples[i - 1];
        const sign = diff > 0 ? 1 : diff < 0 ? -1 : 0;
        if (sign !== 0 && lastSign !== 0 && sign !== lastSign) {
            signChanges += 1;
        }
        if (sign !== 0) {
            lastSign = sign;
        }
    }

    return signChanges >= 4;
}

export function detectSurprises(
    timeSeries: Array<Record<string, number>>,
    observableNames: string[],
): Array<{ observable: string; surprise: string; severity: 'low' | 'medium' | 'high' }> {
    const surprises: Array<{ observable: string; surprise: string; severity: 'low' | 'medium' | 'high' }> = [];

    for (const obs of observableNames) {
        const values = timeSeries.map(row => Number(row[obs] ?? 0));
        if (values.length < 4) continue;

        const first = values[0];
        const last = values[values.length - 1];
        const max = Math.max(...values);
        const min = Math.min(...values);
        const range = max - min;
        const scale = Math.max(1e-9, Math.abs(first), Math.abs(last));

        const maxIdx = values.indexOf(max);
        if (maxIdx > 0 && maxIdx < values.length - 1 && (max - last) > 0.2 * range && range / scale > 0.05) {
            surprises.push({
                observable: obs,
                surprise: `Overshoots at t=${timeSeries[maxIdx]?.time?.toFixed(1) ?? maxIdx} — peak ${max.toPrecision(3)} then settles to ${last.toPrecision(3)}.`,
                severity: (max - last) > 0.5 * range ? 'high' : 'medium',
            });
        }

        let signChanges = 0;
        for (let i = 2; i < values.length; i++) {
            const d1 = values[i - 1] - values[i - 2];
            const d2 = values[i] - values[i - 1];
            if (d1 * d2 < 0 && Math.abs(d1) > 0.01 * scale && Math.abs(d2) > 0.01 * scale) signChanges++;
        }
        if (signChanges >= 3 && range / scale > 0.05) {
            surprises.push({
                observable: obs,
                surprise: `Oscillates with ${signChanges} direction changes.`,
                severity: signChanges >= 6 ? 'high' : 'medium',
            });
        }

        if (range / scale < 0.001 && Math.abs(first) > 1e-6) {
            surprises.push({
                observable: obs,
                surprise: `Effectively constant (range ${range.toExponential(1)} vs magnitude ${first.toExponential(1)}) — may not be informative.`,
                severity: 'low',
            });
        }

        if (surprises.length >= 3) break;
    }
    return surprises.slice(0, 3);
}
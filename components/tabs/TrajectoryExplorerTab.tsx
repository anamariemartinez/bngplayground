import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { UMAP } from 'umap-js';
import {
    ScatterChart,
    Scatter,
    XAxis,
    YAxis,
    ZAxis,
    Tooltip,
    ResponsiveContainer,
    Cell,
    LineChart,
    Line,
    Legend,
    CartesianGrid
} from 'recharts';
import { BNGLModel, SimulationResults, SimulationOptions } from '../../types';
import { bnglWorkerPool } from '../../services/BnglWorkerPool';
import { CHART_COLORS } from '../../constants';
import { formatValue } from '../../src/utils/formatValue';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';

interface TrajectoryExplorerTabProps {
    model: BNGLModel | null;
}

interface RunData {
    id: number;
    results: SimulationResults;
    embedding?: [number, number];
}

export const TrajectoryExplorerTab: React.FC<TrajectoryExplorerTabProps> = ({ model }) => {
    const [ensembleSize, setEnsembleSize] = useState(50);
    const [method, setMethod] = useState<'ssa' | 'nf'>('ssa');
    const [runs, setRuns] = useState<RunData[]>([]);
    const [isSimulating, setIsSimulating] = useState(false);
    const [progress, setProgress] = useState(0);
    const [selectedRunIdx, setSelectedRunIdx] = useState<number | null>(null);
    const [visibleObservables, setVisibleObservables] = useState<Set<string>>(new Set());
    const [error, setError] = useState<string | null>(null);

    const abortControllerRef = useRef<AbortController | null>(null);

    const runEnsemble = async () => {
        if (!model) return;

        setIsSimulating(true);
        setProgress(0);
        setError(null);
        setSelectedRunIdx(null);
        setRuns([]);

        const controller = new AbortController();
        abortControllerRef.current = controller;

        try {
            const options: SimulationOptions = {
                method,
                t_end: model.simulationOptions?.t_end ?? 100,
                n_steps: model.simulationOptions?.n_steps ?? 100,
                includeInfluence: false, // Disable DIN for maximum speed in explorer
            };

            // Run parallel ensemble using worker pool
            const ensembleResults = await bnglWorkerPool.runEnsemble(
                model,
                options,
                ensembleSize,
                (completed) => setProgress(Math.round((completed / ensembleSize) * 100))
            );

            const results: RunData[] = ensembleResults.map((res, i) => ({
                id: i,
                results: res
            }));

            // 3. Compute UMAP if we have enough runs
            if (results.length > 3) {
                setProgress(100);
                // Prepare data for UMAP: flatten all observables into one vector per run
                const featureMatrix = results.map(r => {
                    return r.results.data.flatMap(row => Object.values(row).filter(v => typeof v === 'number'));
                });

                const umap = new UMAP({
                    nComponents: 2,
                    nNeighbors: Math.min(results.length - 1, 15),
                    minDist: 0.1,
                });

                const embedding = umap.fit(featureMatrix);
                results.forEach((r, i) => {
                    r.embedding = [embedding[i][0], embedding[i][1]];
                });
            }

            setRuns(results);
        } catch (err: any) {
            if (err.name !== 'AbortError') {
                console.error('Ensemble failed:', err);
                setError(err.message || String(err) || 'Simulation failed');
            }
        } finally {
            setIsSimulating(false);
            abortControllerRef.current = null;
        }
    };

    const cancelEnsemble = () => {
        abortControllerRef.current?.abort();
        setIsSimulating(false);
    };

    // Prepare line chart data: current run + average if possible
    const chartData = useMemo(() => {
        if (selectedRunIdx === null || !runs[selectedRunIdx]) return [];
        const selectedData = runs[selectedRunIdx].results.data;

        return selectedData.map((row, i) => {
            const entry: any = { time: row.time ?? i };
            Object.keys(row).forEach(key => {
                if (key !== 'time') entry[key] = row[key];
            });
            return entry;
        });
    }, [selectedRunIdx, runs]);

    const observables = useMemo(() => {
        if (runs.length === 0) return [];
        return runs[0].results.headers.filter(h => h !== 'time');
    }, [runs]);

    // Update visible observables when first runs arrive
    useEffect(() => {
        if (observables.length > 0 && visibleObservables.size === 0) {
            setVisibleObservables(new Set(observables.slice(0, 10)));
        }
    }, [observables]);

    const toggleObservable = (data: any) => {
        const name = data.value;
        const next = new Set(visibleObservables);
        if (next.has(name)) {
            next.delete(name);
        } else {
            next.add(name);
        }
        setVisibleObservables(next);
    };

    return (
        <div className="h-full flex flex-col space-y-4">
            {/* Control Bar */}
            <Card className="p-4 bg-slate-50 dark:bg-slate-900/50 dark:bg-slate-900/50 border-dashed">
                <div className="flex flex-wrap items-center gap-6">
                    <div className="flex items-center gap-3">
                        <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Ensemble Size</label>
                        <input
                            type="number"
                            value={ensembleSize}
                            onChange={(e) => setEnsembleSize(Math.max(1, parseInt(e.target.value) || 0))}
                            disabled={isSimulating}
                            className="w-20 rounded-md border border-slate-200 dark:border-slate-700 dark:border-slate-700 bg-white dark:bg-slate-900 dark:bg-slate-800 px-2 py-1 text-sm text-center"
                        />
                    </div>

                    <div className="flex items-center gap-3">
                        <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Method</label>
                        <select
                            value={method}
                            onChange={(e) => setMethod(e.target.value as 'ssa' | 'nf')}
                            disabled={isSimulating}
                            className="rounded-md border border-slate-200 dark:border-slate-700 dark:border-slate-700 bg-white dark:bg-slate-900 dark:bg-slate-800 px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-indigo-500/20"
                        >
                            <option value="ssa">Gillespie (SSA)</option>
                            <option value="nf">Network-Free (NFsim)</option>
                        </select>
                    </div>

                    <div className="flex items-center gap-2">
                        {!isSimulating ? (
                            <Button
                                onClick={runEnsemble}
                                disabled={!model}
                                className="bg-indigo-600 hover:bg-indigo-500 text-white min-w-[140px]"
                            >
                                ☄️ Run Ensemble
                            </Button>
                        ) : (
                            <Button
                                onClick={cancelEnsemble}
                                variant="secondary"
                                className="text-red-500"
                            >
                                Stop ({progress}%)
                            </Button>
                        )}
                    </div>

                    {isSimulating && (
                        <div className="flex-1 flex items-center gap-3">
                            <div className="flex-1 bg-slate-200 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
                                <div
                                    className="bg-indigo-500 h-full transition-all duration-300"
                                    style={{ width: `${progress}%` }}
                                />
                            </div>
                        </div>
                    )}

                    {error && <div className="text-sm text-red-500 font-medium">⚠️ {error}</div>}
                </div>
            </Card>

            {!runs.length && !isSimulating && (
                <div className="flex-1 flex items-center justify-center p-12 text-center bg-slate-50 dark:bg-slate-900/50 dark:bg-slate-900/10 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 dark:border-slate-700">
                    <div className="max-w-md space-y-4">
                        <div className="text-5xl opacity-40">🌊</div>
                        <h3 className="text-xl font-bold text-slate-700 dark:text-slate-200">Trajectory Landscape</h3>
                        <p className="text-slate-500 dark:text-slate-400">
                            Generate an ensemble of stochastic simulations to explore how different runs cluster.
                            Identify bi-modality or high-variance behaviors that are hidden in ODE simulations.
                        </p>
                    </div>
                </div>
            )}

            {runs.length > 0 && (
                <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-0 pb-6">
                    {/* UMAP Plot */}
                    <Card className="p-6 flex flex-col min-h-[500px]">
                        <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-6 flex items-center gap-2">
                            🛰️ Trajectory Clusters (UMAP)
                            <span className="font-normal text-xs text-slate-500 dark:text-slate-400 ml-auto">Each point is one simulation run</span>
                        </h4>
                        <div className="flex-1 min-h-0">
                            <ResponsiveContainer width="100%" height="100%">
                                <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
                                    <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                                    <XAxis type="number" dataKey="x" hide />
                                    <YAxis type="number" dataKey="y" hide />
                                    <ZAxis type="number" range={[100, 500]} />
                                    <Tooltip
                                        cursor={{ strokeDasharray: '3 3' }}
                                        content={({ active, payload }) => {
                                            if (active && payload && payload.length) {
                                                const data = payload[0].payload;
                                                return (
                                                    <div className="bg-white dark:bg-slate-900 dark:bg-slate-800 p-2 border border-slate-200 dark:border-slate-700 dark:border-slate-700 rounded shadow-lg text-sm">
                                                        <div className="font-bold text-indigo-500">Run #{data.id}</div>
                                                        <div className="text-xs text-slate-500 dark:text-slate-400">Click to view trajectory</div>
                                                    </div>
                                                );
                                            }
                                            return null;
                                        }}
                                    />
                                    <Scatter
                                        data={runs.map(r => ({ id: r.id, x: r.embedding?.[0] ?? 0, y: r.embedding?.[1] ?? 0 }))}
                                        onClick={(data) => {
                                            const idx = runs.findIndex(r => r.id === data.id);
                                            setSelectedRunIdx(idx);
                                        }}
                                        cursor="pointer"
                                    >
                                        {runs.map((r, index) => (
                                            <Cell
                                                key={`cell-${index}`}
                                                fill={selectedRunIdx === index ? '#4f46e5' : '#94a3b8'}
                                                fillOpacity={selectedRunIdx === index ? 1 : 0.6}
                                                stroke={selectedRunIdx === index ? '#4f46e5' : 'none'}
                                                strokeWidth={2}
                                            />
                                        ))}
                                    </Scatter>
                                </ScatterChart>
                            </ResponsiveContainer>
                        </div>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-2 italic">
                            Distance represents similarity in time-series dynamics across all observables.
                        </p>
                    </Card>

                    {/* Line Chart */}
                    <Card className="p-6 flex flex-col min-h-[500px]">
                        <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-6 flex items-center gap-2">
                            📈 {selectedRunIdx !== null ? `Trajectory: Run #${runs[selectedRunIdx].id}` : 'Select a run in the map'}
                        </h4>
                        <div className="flex-1 min-h-0">
                            {selectedRunIdx !== null ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 40 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.1} />
                                        <XAxis dataKey="time" tickFormatter={(v) => formatValue(v)} label={{ value: 'Time', position: 'bottom', offset: 0 }} />
                                        <YAxis scale="linear" width={40} tickFormatter={(v) => formatValue(v)} />
                                        <Tooltip
                                            contentStyle={{ fontSize: 12, backgroundColor: '#1e293b', borderColor: '#334155', color: '#fff', borderRadius: '8px' }}
                                            itemStyle={{ padding: '0 4px' }}
                                            formatter={(v: any) => [formatValue(v), '']}
                                        />
                                        <Legend
                                            onClick={toggleObservable}
                                            verticalAlign="bottom"
                                            align="center"
                                            wrapperStyle={{ cursor: 'pointer', fontSize: '11px', paddingTop: '20px' }}
                                        />
                                        {observables.map((obs, i) => (
                                            <Line
                                                key={obs}
                                                type="monotone"
                                                dataKey={obs}
                                                stroke={CHART_COLORS[i % CHART_COLORS.length]}
                                                dot={false}
                                                strokeWidth={2}
                                                animationDuration={300}
                                                hide={!visibleObservables.has(obs)}
                                            />
                                        ))}
                                    </LineChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="h-full flex items-center justify-center opacity-30 text-slate-400 italic text-sm">
                                    Click a point in the cluster map to see its specific trajectory
                                </div>
                            )}
                        </div>
                    </Card>
                </div>
            )}
        </div>
    );
};

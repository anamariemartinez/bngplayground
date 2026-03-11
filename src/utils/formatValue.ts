export const formatValue = (v: number | undefined | null): string => {
  if (v === undefined || v === null || !Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs < 1e-3 || abs >= 1e4) {
    return v.toExponential(2);
  }
  // Remove trailing zeros and use at most 4 decimal places
  return parseFloat(v.toFixed(4)).toString();
};

/**
 * mathUtils.ts — Pure math utilities for analysis modules.
 *
 * Migrated from services/math/fimUtils.ts to the engine package
 * so that FIM, profile likelihood, and Sobol modules can use them
 * without browser dependencies.
 */

/**
 * Inverse standard normal CDF approximation (Acklam's method).
 * Returns z such that Φ(z) = p.
 */
export function normInv(p: number): number {
  if (p <= 0 || p >= 1) throw new Error('p must be in (0,1)');

  const a1 = -39.6968302866538;
  const a2 = 220.946098424521;
  const a3 = -275.928510446969;
  const a4 = 138.357751867269;
  const a5 = -30.6647980661472;
  const a6 = 2.50662827745924;

  const b1 = -54.4760987982241;
  const b2 = 161.585836858041;
  const b3 = -155.698979859887;
  const b4 = 66.8013118877197;
  const b5 = -13.2806815528857;

  const c1 = -0.00778489400243029;
  const c2 = -0.322396458041136;
  const c3 = -2.40075827716184;
  const c4 = -2.54973253934373;
  const c5 = 4.37466414146497;
  const c6 = 2.93816398269878;

  const d1 = 0.00778469570904146;
  const d2 = 0.32246712907004;
  const d3 = 2.445134137143;
  const d4 = 3.75440866190742;

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) /
      ((((d1 * q + d2) * q + d3) * q + d4) * q + 1)
    );
  } else if (p <= pHigh) {
    const q = p - 0.5;
    const r = q * q;
    return (
      ((((((a1 * r + a2) * r + a3) * r + a4) * r + a5) * r + a6) * q) /
      (((((b1 * r + b2) * r + b3) * r + b4) * r + b5) * r + 1)
    );
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(
      (((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) /
      ((((d1 * q + d2) * q + d3) * q + d4) * q + 1)
    );
  }
}

/**
 * Chi-squared quantile approximation.
 *
 * For df=1, uses the exact relation chi2(1) = Z² where Z ~ N(0,1).
 * For general df, uses Wilson-Hilferty transform.
 */
export function chi2Quantile(p: number, df = 1): number {
  if (p <= 0 || p >= 1) throw new Error('p must be in (0,1)');
  if (df < 1) throw new Error('df must be >= 1');

  if (df === 1) {
    const z = normInv((p + 1) / 2);
    return z * z;
  }

  // Wilson-Hilferty approximation for general df
  const v = 2 / (9 * df);
  const z = normInv(p);
  const cube = 1 - v + z * Math.sqrt(v);
  return df * cube * cube * cube;
}

/**
 * Jacobi eigenvalue algorithm for real symmetric matrices.
 *
 * Returns eigenvalues and eigenvectors (columns of the eigenvector matrix).
 */
export function jacobiEigenDecomposition(
  A: number[][],
  maxIter = 100,
  tol = 1e-12,
): { eigenvalues: number[]; eigenvectors: number[][] } {
  const n = A.length;
  const V: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );
  const a = A.map((row) => row.slice());

  const maxOffdiag = (): { max: number; p: number; q: number } => {
    let max = 0;
    let p = 0;
    let q = 1;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const v = Math.abs(a[i][j]);
        if (v > max) {
          max = v;
          p = i;
          q = j;
        }
      }
    }
    return { max, p, q };
  };

  for (let iter = 0; iter < maxIter; iter++) {
    const { max, p, q } = maxOffdiag();
    if (max < tol) break;

    const app = a[p][p];
    const aqq = a[q][q];
    const apq = a[p][q];
    const phi = 0.5 * Math.atan2(2 * apq, aqq - app);
    const c = Math.cos(phi);
    const s = Math.sin(phi);

    for (let i = 0; i < n; i++) {
      if (i !== p && i !== q) {
        const aip = a[i][p];
        const aiq = a[i][q];
        a[i][p] = c * aip - s * aiq;
        a[p][i] = a[i][p];
        a[i][q] = s * aip + c * aiq;
        a[q][i] = a[i][q];
      }
    }

    a[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq;
    a[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq;
    a[p][q] = 0;
    a[q][p] = 0;

    for (let i = 0; i < n; i++) {
      const vip = V[i][p];
      const viq = V[i][q];
      V[i][p] = c * vip - s * viq;
      V[i][q] = s * vip + c * viq;
    }
  }

  const eigenvalues = a.map((row, i) => row[i]);
  return { eigenvalues, eigenvectors: V };
}

/**
 * Matrix multiplication: C = A × B (both n×n).
 */
export function matMul(A: number[][], B: number[][]): number[][] {
  const n = A.length;
  const m = B[0].length;
  const k = B.length;
  const C: number[][] = Array.from({ length: n }, () => new Array(m).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      let sum = 0;
      for (let l = 0; l < k; l++) {
        sum += A[i][l] * B[l][j];
      }
      C[i][j] = sum;
    }
  }
  return C;
}

/**
 * Matrix transpose.
 */
export function matTranspose(A: number[][]): number[][] {
  const n = A.length;
  const m = A[0].length;
  const T: number[][] = Array.from({ length: m }, () => new Array(n));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      T[j][i] = A[i][j];
    }
  }
  return T;
}

/**
 * Invert a symmetric positive-definite matrix via Cholesky.
 * Returns null if the matrix is singular or not PD.
 */
export function invertSymmetricMatrix(A: number[][]): number[][] | null {
  const n = A.length;

  // Cholesky decomposition: A = L L^T
  const L: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = A[i][j];
      for (let k = 0; k < j; k++) {
        sum -= L[i][k] * L[j][k];
      }
      if (i === j) {
        if (sum <= 0) return null; // Not positive definite
        L[i][j] = Math.sqrt(sum);
      } else {
        L[i][j] = sum / L[j][j];
      }
    }
  }

  // Invert L (lower triangular)
  const Linv: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    Linv[i][i] = 1 / L[i][i];
    for (let j = i + 1; j < n; j++) {
      let sum = 0;
      for (let k = i; k < j; k++) {
        sum -= L[j][k] * Linv[k][i];
      }
      Linv[j][i] = sum / L[j][j];
    }
  }

  // A^{-1} = (L^{-1})^T L^{-1}
  const inv: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let sum = 0;
      for (let k = j; k < n; k++) {
        sum += Linv[k][i] * Linv[k][j];
      }
      inv[i][j] = sum;
      inv[j][i] = sum;
    }
  }
  return inv;
}

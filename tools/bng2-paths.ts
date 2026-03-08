import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';

/**
 * Interface for BNG2 binary paths.
 */
export interface BNG2Paths {
  bng2pl: string | null;      // Path to BNG2.pl
  nfsim: string | null;       // Path to NFsim binary
  runNetwork: string | null;  // Path to run_network binary
  bngRoot: string | null;     // BNG root directory (contains Perl2/, bin/, etc.)
}

/**
 * Resolve BNG2 binary paths using the following precedence:
 * 1. Environment variables (BNG2_PATH, NFSIM_PATH, BNGPATH)
 * 2. PyBioNetGen installation (auto-detect via `python -c "import bionetgen"`)
 * 3. Local bionetgen_python/ directory (legacy fallback)
 * 4. .env file configuration
 */
export function resolveBNG2Paths(): BNG2Paths {
  const result: BNG2Paths = {
    bng2pl: null,
    nfsim: null,
    runNetwork: null,
    bngRoot: null,
  };

  // 1. Try environment variables first
  if (process.env.BNG2_PATH && existsSync(process.env.BNG2_PATH)) {
    result.bng2pl = process.env.BNG2_PATH;
  }
  if (process.env.NFSIM_PATH && existsSync(process.env.NFSIM_PATH)) {
    result.nfsim = process.env.NFSIM_PATH;
  }
  if (process.env.BNGPATH && existsSync(process.env.BNGPATH)) {
    result.bngRoot = process.env.BNGPATH;
  }

  // 2. Try PyBioNetGen auto-detection
  if (!result.bngRoot) {
    try {
      const pyOutput = execSync(
        'python -c "import bionetgen, os; print(os.path.dirname(bionetgen.__file__))"',
        { encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }
      ).trim();

      // Detect platform-specific subdirectory
      const platform = process.platform === 'win32' ? 'bng-win'
                     : process.platform === 'darwin' ? 'bng-mac'
                     : 'bng-linux';
      const bngDir = join(pyOutput, platform);

      if (existsSync(bngDir)) {
        result.bngRoot = bngDir;
      }
    } catch {
      // PyBioNetGen not installed — continue to fallbacks
    }
  }

  // 3. Try local bionetgen_python/ directory (legacy)
  if (!result.bngRoot) {
    const platform = process.platform === 'win32' ? 'bng-win'
                   : process.platform === 'darwin' ? 'bng-mac'
                   : 'bng-linux';
    const localPath = resolve(`bionetgen_python/${platform}`);
    if (existsSync(localPath)) {
      result.bngRoot = localPath;
    }
  }

  // Resolve individual binaries from bngRoot if not already set
  if (result.bngRoot) {
    if (!result.bng2pl) {
      const bng2pl = join(result.bngRoot, 'BNG2.pl');
      if (existsSync(bng2pl)) result.bng2pl = bng2pl;
    }
    if (!result.nfsim) {
      const ext = process.platform === 'win32' ? '.exe' : '';
      const nfsim = join(result.bngRoot, 'bin', `NFsim${ext}`);
      if (existsSync(nfsim)) result.nfsim = nfsim;
    }
    if (!result.runNetwork) {
      const ext = process.platform === 'win32' ? '.exe' : '';
      const runNet = join(result.bngRoot, 'bin', `run_network${ext}`);
      if (existsSync(runNet)) result.runNetwork = runNet;
    }
  }

  return result;
}

/**
 * Check if BNG2.pl is available for parity testing.
 * Use this as a test guard: `describe.skipIf(!hasBNG2())(...)`
 */
export function hasBNG2(): boolean {
  return resolveBNG2Paths().bng2pl !== null;
}

/**
 * Check if NFsim native binary is available.
 */
export function hasNFsim(): boolean {
  return resolveBNG2Paths().nfsim !== null;
}

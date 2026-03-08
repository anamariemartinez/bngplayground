import {
  hasBNG2 as hasBNG2Impl,
  hasNFsim as hasNFsimImpl,
  resolveBNG2Paths as resolveBNG2PathsImpl,
} from './bng2-paths.js';

/**
 * Interface for BNG2 binary paths.
 */
export interface BNG2Paths {
  bng2pl: string | null;      // Path to BNG2.pl
  nfsim: string | null;       // Path to NFsim binary
  runNetwork: string | null;  // Path to run_network binary
  bngRoot: string | null;     // BNG root directory (contains Perl2/, bin/, etc.)
  perl5lib: string | null;    // Path to BioNetGen Perl modules
}

/**
 * Resolve BNG2 binary paths using the following precedence:
 * 1. Environment variables (BNG2_PATH, NFSIM_PATH, BNGPATH)
 * 2. PyBioNetGen installation (auto-detect via `python -c "import bionetgen"`)
 * 3. Local bionetgen_python/ directory (legacy fallback)
 * 4. .env file configuration
 */
export function resolveBNG2Paths(): BNG2Paths {
  return resolveBNG2PathsImpl() as BNG2Paths;
}

/**
 * Check if BNG2.pl is available for parity testing.
 * Use this as a test guard: `describe.skipIf(!hasBNG2())(...)`
 */
export function hasBNG2(): boolean {
  return hasBNG2Impl();
}

/**
 * Check if NFsim native binary is available.
 */
export function hasNFsim(): boolean {
  return hasNFsimImpl();
}

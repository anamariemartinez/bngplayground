import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';

export function resolveBNG2Paths() {
  const result = {
    bng2pl: null,
    nfsim: null,
    runNetwork: null,
    bngRoot: null,
    perl5lib: null,
  };

  if (process.env.BNG2_PATH && existsSync(process.env.BNG2_PATH)) {
    result.bng2pl = process.env.BNG2_PATH;
  }
  if (process.env.NFSIM_PATH && existsSync(process.env.NFSIM_PATH)) {
    result.nfsim = process.env.NFSIM_PATH;
  }
  if (process.env.BNGPATH && existsSync(process.env.BNGPATH)) {
    result.bngRoot = process.env.BNGPATH;
  }

  if (!result.bngRoot) {
    try {
      const pyOutput = execSync(
        'python -c "import bionetgen, os; print(os.path.dirname(bionetgen.__file__))"',
        { encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }
      ).trim();
      const platform = process.platform === 'win32' ? 'bng-win'
        : process.platform === 'darwin' ? 'bng-mac'
        : 'bng-linux';
      const bngDir = join(pyOutput, platform);
      if (existsSync(bngDir)) {
        result.bngRoot = bngDir;
      }
    } catch {
      // Ignore auto-detect failures.
    }
  }

  if (!result.bngRoot) {
    const platform = process.platform === 'win32' ? 'bng-win'
      : process.platform === 'darwin' ? 'bng-mac'
      : 'bng-linux';
    const localPath = resolve(`bionetgen_python/${platform}`);
    if (existsSync(localPath)) {
      result.bngRoot = localPath;
    }
  }

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
      const runNetwork = join(result.bngRoot, 'bin', `run_network${ext}`);
      if (existsSync(runNetwork)) result.runNetwork = runNetwork;
    }
    const perl2 = join(result.bngRoot, 'Perl2');
    if (existsSync(perl2)) {
      result.perl5lib = perl2;
    }
  }

  return result;
}

export function hasBNG2() {
  return resolveBNG2Paths().bng2pl !== null;
}

export function hasNFsim() {
  return resolveBNG2Paths().nfsim !== null;
}
import { spawnSync } from 'node:child_process';

const TIMEOUT_MS = Number(process.env.BNG_MODEL_TIMEOUT_MS || 60_000);

const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['-y', 'tsx', 'scripts/generation/generate_no_ref_gdat.ts'],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      BNG_MODEL_TIMEOUT_MS: String(TIMEOUT_MS),
    },
    shell: false,
  },
);

if (result.error) {
  console.error('[generate:gdat] Failed to launch TSX runner.', result.error);
  process.exit(1);
}

process.exit(typeof result.status === 'number' ? result.status : 1);

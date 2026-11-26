#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const HOOK_FILE = join(ROOT, '.githooks', 'pre-commit');

try {
  if (existsSync(HOOK_FILE)) {
    chmodSync(HOOK_FILE, 0o755);
  }
  if (existsSync(join(ROOT, '.git'))) {
    execFileSync('git', ['config', 'core.hooksPath', '.githooks'], {
      cwd: ROOT,
      stdio: 'ignore',
    });
  }
} catch {
  // Ignore outside git worktrees or in restricted CI containers
}

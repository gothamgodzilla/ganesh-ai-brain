#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  listRolePrompts,
  scanTextForFindings,
  runThreePassVerificationLoop,
} from '../lib/role-pipeline/index.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const args = new Set(process.argv.slice(2));
const isFast = args.has('--fast');
const skipTests = args.has('--skip-tests');

const IGNORE_DIRS = new Set([
  '.git',
  'node_modules',
  'console-dist',
  'dist',
  'output',
  'data',
]);

const IGNORE_SECRET_FILES = new Set([
  '.env.example',
  'package-lock.json',
  'pnpm-lock.yaml',
]);

function walkFiles(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (IGNORE_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkFiles(full, acc);
    } else if (st.isFile()) {
      acc.push(full);
    }
  }
  return acc;
}

async function main() {
  const startedAt = Date.now();
  const errors = [];
  const warnings = [];

  console.log('🔎 [Ganesh Verification Loop] Pass 1: Syntax & Versioned Role Prompt Integrity...');

  // 1. Validate versioned role prompt files
  const prompts = listRolePrompts();
  const requiredSlugs = ['architect', 'operator', 'contrarian-verifier', 'decision-review'];
  for (const slug of requiredSlugs) {
    if (!prompts.some((p) => p.slug === slug)) {
      errors.push(`Missing required versioned role prompt: ${slug}`);
    }
  }

  // 2. Syntax check all .mjs / .cjs / .js source files (excluding bundled console-dist / node_modules)
  const allFiles = walkFiles(ROOT);
  const syntaxTargets = allFiles.filter((f) => {
    const ext = extname(f);
    return ext === '.mjs' || ext === '.cjs';
  });

  for (const file of syntaxTargets) {
    try {
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    } catch (err) {
      errors.push(`Syntax error in ${relative(ROOT, file)}: ${err.stderr?.toString() || err.message}`);
    }
  }

  console.log('🛡️  [Ganesh Verification Loop] Pass 2: Edge-Case, RLS & Secret Scan...');

  // 3. Scan source and SQL migration files for secrets, missing RLS, and edge-case smells
  const scanTargets = allFiles.filter((f) => {
    const rel = relative(ROOT, f);
    const base = rel.split('/').pop();
    if (IGNORE_SECRET_FILES.has(base)) return false;
    if (rel.startsWith('onyx-lynx-mcp-server/')) return false;
    const ext = extname(f);
    return ['.mjs', '.cjs', '.js', '.ts', '.jsx', '.tsx', '.sql'].includes(ext);
  });

  for (const file of scanTargets) {
    const rel = relative(ROOT, file);
    if (rel === 'lib/role-pipeline/static-verifier.mjs' || rel === 'scripts/verify-generation.mjs') continue;
    if (rel.endsWith('.test.mjs') || rel === 'test.ts') continue;

    const content = readFileSync(file, 'utf8');
    const findings = scanTextForFindings(content, rel, {
      runtime: rel.endsWith('.sql') ? 'supabase-sql' : 'node-esm',
      // UI client fetch('/api/...') calls are same-origin browser requests
      skipTimeoutCheck: rel.startsWith('brain-server/ui/') || rel.startsWith('src/'),
    });

    for (const finding of findings) {
      if (finding.severity === 'critical' || finding.severity === 'high') {
        errors.push(`[${finding.id}] ${finding.location}: ${finding.message}`);
      } else {
        warnings.push(`[${finding.id}] ${finding.location}: ${finding.message}`);
      }
    }
  }

  console.log('⚡ [Ganesh Verification Loop] Pass 3: Contrarian Gate & Self-Verification...');

  // 4. Execute the 3-pass verification loop self-check (Draft -> Edge-case analysis -> Optimized rewrite)
  const loopResult = await runThreePassVerificationLoop({
    request: 'Verify Ganesh AI Brain role stack, watchdog telemetry, and Supabase RLS invariants',
    context: { targetModule: 'brain-server', tableName: 'brain_watchdog_runs' },
  });

  if (!loopResult.ok || loopResult.finalVerdict !== 'PASS' || loopResult.passesCompleted !== 3) {
    errors.push(
      `Three-pass verification loop self-check failed (verdict=${loopResult.finalVerdict}, passes=${loopResult.passesCompleted})`
    );
  }

  // 5. Run unit test suite unless --skip-tests is passed
  if (!skipTests) {
    console.log('🧪 [Ganesh Verification Loop] Running test suite...');
    try {
      execFileSync(
        process.execPath,
        ['--test', 'lib/geo-pipeline/*.test.mjs', 'brain-server/test/*.test.mjs'],
        { cwd: ROOT, stdio: isFast ? 'pipe' : 'inherit' }
      );
    } catch (err) {
      errors.push(`Unit test suite failed: ${err.stderr?.toString() || err.message}`);
    }
  }

  const elapsedMs = Date.now() - startedAt;

  if (warnings.length > 0) {
    console.warn(`⚠️  ${warnings.length} advisory warning(s):`);
    for (const w of warnings) console.warn(`   - ${w}`);
  }

  if (errors.length > 0) {
    console.error(`❌ Contrarian Verification Gate BLOCKED (${errors.length} error(s) in ${elapsedMs}ms):`);
    for (const e of errors) console.error(`   - ${e}`);
    process.exit(1);
  }

  console.log(
    `✅ Contrarian Verification Gate PASSED (${syntaxTargets.length} files syntax-checked, ${prompts.length} role prompts verified, 3-pass loop=${loopResult.finalVerdict} in ${elapsedMs}ms).`
  );
}

main().catch((err) => {
  console.error('Fatal verification error:', err);
  process.exit(1);
});

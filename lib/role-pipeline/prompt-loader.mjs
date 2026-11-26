import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PROMPTS_DIR = join(__dirname, '..', '..', 'prompts', 'roles');

const ROLE_FILE_MAP = Object.freeze({
  architect: 'architect.v1.md',
  Architect: 'architect.v1.md',
  operator: 'operator.v1.md',
  Operator: 'operator.v1.md',
  contrarian: 'contrarian-verifier.v1.md',
  'contrarian-verifier': 'contrarian-verifier.v1.md',
  ContrarianVerifier: 'contrarian-verifier.v1.md',
  'decision-review': 'decision-review.v1.md',
  DecisionReviewer: 'decision-review.v1.md',
});

const promptCache = new Map();

export function parsePromptMarkdown(raw, filename = 'unknown.md') {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error(`Role prompt file "${filename}" is empty`);
  }

  const normalized = raw.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    throw new Error(`Role prompt file "${filename}" is missing YAML frontmatter header`);
  }

  const endMarker = normalized.indexOf('\n---\n', 4);
  if (endMarker === -1) {
    throw new Error(`Role prompt file "${filename}" has unclosed YAML frontmatter`);
  }

  const frontmatterRaw = normalized.slice(4, endMarker).trim();
  const body = normalized.slice(endMarker + 5).trim();

  const metadata = {};
  for (const line of frontmatterRaw.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key) metadata[key] = val;
  }

  if (!metadata.role || !metadata.version || !metadata.slug) {
    throw new Error(
      `Role prompt file "${filename}" must declare "role", "slug", and "version" in frontmatter`
    );
  }

  if (!body) {
    throw new Error(`Role prompt file "${filename}" has an empty prompt body`);
  }

  return {
    role: metadata.role,
    slug: metadata.slug,
    version: metadata.version,
    updated: metadata.updated ?? null,
    stage: metadata.stage ?? null,
    outputContract: metadata.output_contract ?? 'json',
    filename,
    systemPrompt: body,
  };
}

export function loadRolePrompt(roleKey, { bypassCache = false, promptsDir = PROMPTS_DIR } = {}) {
  const filename = ROLE_FILE_MAP[roleKey] ?? (roleKey.endsWith('.md') ? roleKey : `${roleKey}.v1.md`);
  const fullPath = join(promptsDir, filename);

  if (!bypassCache && promptCache.has(fullPath)) {
    return promptCache.get(fullPath);
  }

  if (!existsSync(fullPath)) {
    throw new Error(`Versioned role prompt not found for "${roleKey}" at ${fullPath}`);
  }

  const raw = readFileSync(fullPath, 'utf8');
  const parsed = parsePromptMarkdown(raw, filename);
  promptCache.set(fullPath, parsed);
  return parsed;
}

export function listRolePrompts({ promptsDir = PROMPTS_DIR } = {}) {
  if (!existsSync(promptsDir)) return [];
  const files = readdirSync(promptsDir)
    .filter((f) => f.endsWith('.md'))
    .sort();
  return files.map((file) => loadRolePrompt(file, { promptsDir }));
}

export function clearRolePromptCache() {
  promptCache.clear();
}

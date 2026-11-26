/**
 * Deterministic static & edge-case analyzer used by both:
 * 1) The Contrarian/Verifier role in the orchestrator verification loop
 * 2) The post-generation verification CLI & pre-commit hook (`scripts/verify-generation.mjs`)
 */

const SECRET_PATTERNS = [
  {
    id: 'SEC-STRIPE-LIVE',
    category: 'security',
    severity: 'critical',
    regex: /\b(?:sk_live|rk_live)_[0-9a-zA-Z]{20,}\b/,
    message: 'Hardcoded Stripe live secret/restricted key detected',
    remediation: 'Move key to environment variable (process.env.STRIPE_SECRET_KEY) and rotate compromised secret.',
  },
  {
    id: 'SEC-PRIVATE-KEY',
    category: 'security',
    severity: 'critical',
    regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    message: 'Embedded PEM private key detected',
    remediation: 'Store private keys in environment secrets or KMS, never in source files.',
  },
  {
    id: 'SEC-AWS-KEY',
    category: 'security',
    severity: 'critical',
    regex: /\bAKIA[0-9A-Z]{16}\b/,
    message: 'Hardcoded AWS access key ID detected',
    remediation: 'Use environment credentials or IAM roles instead of inline AKIA keys.',
  },
  {
    id: 'SEC-GITHUB-PAT',
    category: 'security',
    severity: 'critical',
    regex: /\b(?:ghp_[0-9a-zA-Z]{30,}|github_pat_[0-9a-zA-Z_]{40,})\b/,
    message: 'Hardcoded GitHub personal access token detected',
    remediation: 'Revoke token immediately and inject via CI/runtime environment variables.',
  },
  {
    id: 'SEC-ANTHROPIC-OPENAI',
    category: 'security',
    severity: 'critical',
    regex: /\bsk-(?:ant-api03-|proj-)[0-9a-zA-Z_-]{24,}\b/,
    message: 'Hardcoded LLM provider API key detected',
    remediation: 'Load LLM API keys from process.env (e.g. GANESH_LLM_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY).',
  },
];

const SMELL_PATTERNS = [
  {
    id: 'SMELL-EVAL',
    category: 'security',
    severity: 'high',
    regex: /\beval\s*\(|new\s+Function\s*\(/,
    message: 'Dynamic code execution (eval / new Function) detected',
    remediation: 'Replace dynamic code evaluation with structured parsing or explicit dispatch tables.',
  },
  {
    id: 'SMELL-STRINGIFIED-UNDEFINED',
    category: 'null-state',
    severity: 'medium',
    regex: /===\s*['"]undefined['"].*String\(|`[^`]*\$\{[^}]*\?\?\s*['"](?:None|undefined)['"]\}/,
    message: 'Potential serialization of literal "undefined" or "None" into payload',
    remediation: 'Omit missing optional fields or coalesce to null rather than stringifying "undefined"/"None".',
  },
  {
    id: 'SMELL-SILENT-CATCH',
    category: 'logic',
    severity: 'medium',
    regex: /catch\s*(?:\([^)]*\))?\s*\{\s*\}/,
    message: 'Completely empty catch block swallows errors without comment or fallback',
    remediation: 'Handle the error, return a fallback state, or document why ignoring is safe inside the catch block.',
  },
  {
    id: 'SMELL-INSECURE-HTTP-FETCH',
    category: 'network-failure',
    severity: 'medium',
    regex: /\bfetch\s*\(\s*['"]http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)/,
    message: 'Plaintext HTTP fetch to non-loopback host detected',
    remediation: 'Use HTTPS endpoints and attach an AbortSignal.timeout(...) to outbound requests.',
  },
];

export function scanTextForFindings(text, location = 'inline-artifact', options = {}) {
  if (typeof text !== 'string' || !text) return [];
  const findings = [];
  const isSql = location.endsWith('.sql') || options.runtime === 'supabase-sql';

  for (const rule of SECRET_PATTERNS) {
    if (rule.regex.test(text)) {
      findings.push({
        id: rule.id,
        severity: rule.severity,
        category: rule.category,
        location,
        message: rule.message,
        remediation: rule.remediation,
      });
    }
  }

  for (const rule of SMELL_PATTERNS) {
    if (rule.regex.test(text)) {
      findings.push({
        id: rule.id,
        severity: rule.severity,
        category: rule.category,
        location,
        message: rule.message,
        remediation: rule.remediation,
      });
    }
  }

  // SQL-specific invariant: CREATE TABLE must have ENABLE ROW LEVEL SECURITY
  if (isSql && /CREATE\s+TABLE/i.test(text) && !/ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(text)) {
    findings.push({
      id: 'SQL-MISSING-RLS',
      severity: 'high',
      category: 'security',
      location,
      message: 'SQL migration defines CREATE TABLE without ENABLE ROW LEVEL SECURITY',
      remediation: 'Add ALTER TABLE <name> ENABLE ROW LEVEL SECURITY; for every table in the migration.',
    });
  }

  // Network call without timeout check when fetch() is present in code artifacts
  if (
    !options.skipTimeoutCheck &&
    /\bfetch\s*\(/.test(text) &&
    !/AbortSignal\.timeout|AbortController|signal\s*:/.test(text)
  ) {
    findings.push({
      id: 'NET-MISSING-TIMEOUT',
      severity: 'medium',
      category: 'network-failure',
      location,
      message: 'Outbound fetch() call lacks an AbortSignal timeout or AbortController',
      remediation: 'Pass { signal: AbortSignal.timeout(timeoutMs) } to prevent hung serverless invocations.',
    });
  }

  return findings;
}

export function computeContrarianVerdict(findings = [], { isFinalPass = false } = {}) {
  const hasCritical = findings.some((f) => f.severity === 'critical');
  const hasHigh = findings.some((f) => f.severity === 'high');
  const hasMedium = findings.some((f) => f.severity === 'medium');

  if (hasCritical) return 'BLOCK';
  if (hasHigh) return isFinalPass ? 'BLOCK' : 'REVISE';
  if (hasMedium) return 'REVISE';
  return 'PASS';
}

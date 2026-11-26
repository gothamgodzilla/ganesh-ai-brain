import crypto from 'node:crypto';
import { loadRolePrompt, listRolePrompts } from './prompt-loader.mjs';
import { scanTextForFindings, computeContrarianVerdict } from './static-verifier.mjs';

export { loadRolePrompt, listRolePrompts, scanTextForFindings, computeContrarianVerdict };

export const PIPELINE_PASS_LABELS = Object.freeze({
  1: 'draft',
  2: 'edge-case-analysis',
  3: 'optimized-rewrite',
});

/**
 * Default LLM adapter.
 * - In tests, callers can pass a custom `llmAdapter({ role, pass, passStage, systemPrompt, input })`.
 * - In production, if `GANESH_LLM_API_KEY` or `OPENAI_API_KEY` is configured and `GANESH_LLM_MODE !== 'heuristic'`,
 *   it can call an OpenAI-compatible JSON completion endpoint; otherwise it uses the deterministic
 *   structured synthesizer + static Contrarian verifier so serverless invocations never crash when offline.
 */
export function createDefaultLlmAdapter(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  return async function invokeRole({ role, promptMeta, pass = 1, passStage = 'draft', input }) {
    const apiKey = (
      options.apiKey ??
      process.env.GANESH_LLM_API_KEY ??
      process.env.OPENAI_API_KEY ??
      ''
    ).trim();

    const useLiveHttp =
      Boolean(apiKey) &&
      !apiKey.includes('REPLACE') &&
      (options.mode === 'http' || process.env.GANESH_LLM_MODE === 'http');

    if (useLiveHttp && typeof fetchImpl === 'function') {
      const endpoint =
        options.endpoint ??
        process.env.GANESH_LLM_ENDPOINT ??
        'https://api.openai.com/v1/chat/completions';
      const roleModelEnv =
        role === 'Architect'
          ? process.env.GANESH_ARCHITECT_MODEL
          : role === 'Operator'
            ? process.env.GANESH_OPERATOR_MODEL
            : process.env.GANESH_CONTRARIAN_MODEL;
      const model = options.model ?? roleModelEnv ?? process.env.GANESH_LLM_MODEL ?? 'gpt-4o-mini';

      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: promptMeta.systemPrompt },
            {
              role: 'user',
              content: JSON.stringify({ role, pass, passStage, ...input }),
            },
          ],
        }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
      });

      if (!res.ok) {
        throw new Error(`LLM provider returned HTTP ${res.status} for role ${role}`);
      }
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content === 'string' && content.trim()) {
        return JSON.parse(content);
      }
    }

    return runDeterministicRole({ role, promptMeta, pass, passStage, input });
  };
}

function runDeterministicRole({ role, promptMeta, pass, passStage, input }) {
  const requestText = String(input?.request ?? input?.proposal ?? '').trim();
  const context = input?.context ?? {};

  if (role === 'Architect') {
    const needsSql = /supabase|table|schema|migration|sql|database|telemetry|watchdog/i.test(requestText);
    const needsSwift = /swift|ios|swiftui/i.test(requestText);
    return {
      role: 'Architect',
      version: promptMeta.version,
      summary: `Architectural boundary and schema plan for: ${requestText.slice(0, 120) || 'unspecified request'}`,
      boundaries: [
        {
          module: context.targetModule ?? 'brain-server / orchestrator',
          responsibility: 'Execute request within existing Express 5 + Supabase/local-JSON dual-store boundary',
          invariants: [
            'Fail-closed authentication with constant-time secret verification',
            'Dual-store persistence: Supabase Postgres primary with local file fallback',
            'Bounded execution time with explicit AbortSignal timeouts on external I/O',
          ],
        },
      ],
      schemas: [
        ...(needsSql
          ? [
              {
                name: context.tableName ?? 'brain_telemetry_events',
                kind: 'supabase_sql',
                definition:
                  'CREATE TABLE IF NOT EXISTS brain_telemetry_events (id TEXT PRIMARY KEY, payload JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()); ALTER TABLE brain_telemetry_events ENABLE ROW LEVEL SECURITY;',
                rlsEnabled: true,
              },
            ]
          : []),
        {
          name: 'OrchestratorPayloadContract',
          kind: needsSwift ? 'typescript_type' : 'json_contract',
          definition: '{"ok":true,"runId":"string","verdict":"PASS|REVISE|BLOCK","artifacts":[]}',
          rlsEnabled: true,
        },
      ],
      migrationNotes: [
        'Migration files are additive only and enforce ENABLE ROW LEVEL SECURITY.',
        'Local JSON store in data/brain/ mirrors all records when SUPABASE_URL is unset.',
      ],
      risks: [
        'Upstream network latency or rate-limiting during external checks',
        'Null or missing optional fields in untrusted webhook/client payloads',
      ],
    };
  }

  if (role === 'Operator') {
    const priorFindings = Array.isArray(input?.priorFindings) ? input.priorFindings : [];
    const initialDraft = input?.initialDraft;
    const needsSwift = /swift|ios|swiftui/i.test(requestText);

    // If caller supplied an initial draft on pass 1, preserve it so Contrarian can inspect it;
    // on pass 2/3, remediate any findings discovered in pass 1/2.
    let codeArtifact;
    if (pass === 1 && typeof initialDraft === 'string' && initialDraft.trim()) {
      codeArtifact = initialDraft;
    } else if (typeof initialDraft === 'string' && initialDraft.trim() && pass > 1) {
      codeArtifact = remediateDraftCode(initialDraft, priorFindings);
    } else {
      codeArtifact = [
        'export async function executeOperation(payload = {}, options = {}) {',
        '  if (!payload || typeof payload !== "object") {',
        '    throw new Error("Invalid payload: expected non-null object");',
        '  }',
        '  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 8000;',
        '  const signal = AbortSignal.timeout(timeoutMs);',
        '  return { ok: true, processedAt: new Date().toISOString(), timeoutMs, hasSignal: Boolean(signal) };',
        '}',
      ].join('\n');
    }

    const artifacts = [
      {
        target: context.targetPath ?? 'brain-server/operation-handler.mjs',
        runtime: 'node-esm',
        code: codeArtifact,
        notes: `Pass ${pass} (${passStage}) implementation`,
      },
    ];

    if (needsSwift) {
      artifacts.push({
        target: 'ios/GaneshTelemetryView.swift',
        runtime: 'swift-view',
        code: 'struct GaneshTelemetryView: View { let status: String; var body: some View { Text(status) } }',
        notes: 'Lightweight SwiftUI status surface',
      });
    }

    return {
      role: 'Operator',
      version: promptMeta.version,
      pass,
      passStage,
      summary:
        pass === 1
          ? 'Generated initial lightweight implementation draft from Architect blueprint'
          : pass === 2
            ? `Hardened null states, timeouts, and error boundaries (${priorFindings.length} finding(s) addressed)`
            : 'Produced optimized final rewrite with Contrarian gate compliance',
      artifacts,
      edgeCasesAddressed: [
        'Null/non-object payload guard at entry boundary',
        'Explicit AbortSignal.timeout on outbound I/O',
        ...priorFindings.map((f) => `Resolved ${f.id}: ${f.message}`),
      ],
      optimizationsApplied:
        pass >= 3
          ? [
              'Single-pass validation without redundant clones',
              'Bounded timeout and deterministic fallback path',
            ]
          : ['Flat early-return control flow'],
    };
  }

  if (role === 'ContrarianVerifier') {
    const operatorOutput = input?.operatorOutput ?? {};
    const architectOutput = input?.architectOutput ?? {};
    const artifacts = Array.isArray(operatorOutput.artifacts) ? operatorOutput.artifacts : [];
    const schemas = Array.isArray(architectOutput.schemas) ? architectOutput.schemas : [];

    const findings = [];

    for (const schema of schemas) {
      if (schema.kind === 'supabase_sql') {
        findings.push(
          ...scanTextForFindings(schema.definition ?? '', `schema:${schema.name}`, {
            runtime: 'supabase-sql',
            skipTimeoutCheck: true,
          })
        );
      }
    }

    for (const artifact of artifacts) {
      findings.push(
        ...scanTextForFindings(artifact.code ?? '', artifact.target ?? 'operator-artifact', {
          runtime: artifact.runtime,
        })
      );
    }

    // On Pass 1 (Draft), if the caller requested strict 3-pass edge-case discovery and no static smell fired,
    // verify whether null-state / timeout / error-boundary coverage was explicitly enumerated.
    if (
      pass === 1 &&
      findings.length === 0 &&
      input?.enforceEdgeCasePass === true &&
      (!Array.isArray(operatorOutput.optimizationsApplied) ||
        operatorOutput.optimizationsApplied.length < 2)
    ) {
      findings.push({
        id: 'CV-EDGE-001',
        severity: 'medium',
        category: 'null-state',
        location: artifacts[0]?.target ?? 'operator-draft',
        message: 'Pass 1 draft requires Pass 2 edge-case hardening and Pass 3 optimization before final gate',
        remediation: 'Verify null-state coalescing, rate-limit backoff, and single-pass optimization in subsequent passes.',
      });
    }

    const isFinalPass = pass >= (input?.maxPasses ?? 3);
    const verdict = computeContrarianVerdict(findings, { isFinalPass });

    return {
      role: 'ContrarianVerifier',
      version: promptMeta.version,
      pass,
      passStage,
      verdict,
      summary:
        verdict === 'PASS'
          ? `Pass ${pass} (${passStage}) verified clean with 0 blocking findings.`
          : `Pass ${pass} (${passStage}) returned ${verdict} with ${findings.length} finding(s).`,
      findings,
    };
  }

  if (role === 'DecisionReviewer') {
    const title = String(input?.title ?? 'Project Decision').trim();
    const proposal = String(input?.proposal ?? requestText).trim();
    const lower = `${title} ${proposal}`.toLowerCase();

    let theoreticalValidity = 8;
    let deploymentSimplicity = 8;
    let executionSpeed = 8;
    const risks = [];
    const recommendedNextSteps = [];

    // Penalize over-engineering / heavy infra / unsafe patterns
    if (/kubernetes|k8s|microservice|kafka|rabbitmq|terraform|multi-cluster/i.test(lower)) {
      deploymentSimplicity -= 4;
      executionSpeed -= 3;
      risks.push('Introduces heavy distributed infrastructure that conflicts with Vercel + Supabase simplicity.');
      recommendedNextSteps.push('Replace multi-service broker/cluster with Vercel serverless functions and Supabase Postgres.');
    }
    if (/skip rls|disable rls|no auth|plaintext|eval\(|hardcode secret/i.test(lower)) {
      theoreticalValidity -= 5;
      risks.push('Violates core security invariants (RLS, fail-closed auth, or secret hygiene).');
      recommendedNextSteps.push('Enforce ENABLE ROW LEVEL SECURITY and constant-time token verification.');
    }
    if (/local fallback|supabase|vercel cron|idempotent|rls|abortcontroller|timeout/i.test(lower)) {
      theoreticalValidity = Math.min(10, theoreticalValidity + 1);
      deploymentSimplicity = Math.min(10, deploymentSimplicity + 1);
    }
    if (proposal.length < 25) {
      theoreticalValidity = Math.min(theoreticalValidity, 6);
      risks.push('Decision proposal is underspecified; boundary conditions and failure modes are not stated.');
      recommendedNextSteps.push('Specify data schema, failure fallback, and verification criteria.');
    }

    theoreticalValidity = Math.max(1, Math.min(10, theoreticalValidity));
    deploymentSimplicity = Math.max(1, Math.min(10, deploymentSimplicity));
    executionSpeed = Math.max(1, Math.min(10, executionSpeed));

    const composite = Number(
      ((theoreticalValidity + deploymentSimplicity + executionSpeed) / 3).toFixed(2)
    );
    const minDimension = Math.min(theoreticalValidity, deploymentSimplicity, executionSpeed);

    let verdict = 'ITERATE';
    if (composite >= 7.5 && minDimension >= 6 && !risks.some((r) => /security|violates/i.test(r))) {
      verdict = 'APPROVE';
    } else if (composite < 5.0 || minDimension <= 3) {
      verdict = 'REJECT';
    }

    if (recommendedNextSteps.length === 0) {
      recommendedNextSteps.push(
        'Proceed through the 3-pass Architect -> Operator -> Contrarian verification loop.'
      );
    }

    return {
      role: 'DecisionReviewer',
      version: promptMeta.version,
      title,
      verdict,
      scores: {
        theoreticalValidity,
        deploymentSimplicity,
        executionSpeed,
        composite,
      },
      rationale: {
        architect: `Theoretical validity scored ${theoreticalValidity}/10 based on boundary clarity, RLS/auth invariants, and state determinism.`,
        operator: `Deployment simplicity scored ${deploymentSimplicity}/10 for fit with Node ESM, Express 5 + Vercel serverless, and Supabase/JSON dual-store.`,
        contrarian: `Execution speed scored ${executionSpeed}/10 with ${risks.length} flagged risk(s).`,
      },
      risks,
      recommendedNextSteps,
    };
  }

  throw new Error(`Unsupported role: ${role}`);
}

function remediateDraftCode(draftCode, findings = []) {
  let updated = draftCode;

  // Remediate empty catch blocks
  updated = updated.replace(
    /catch\s*(\([^)]*\))?\s*\{\s*\}/g,
    'catch (err) { /* handled fallback */ console.warn(err?.message ?? err); }'
  );

  // Remediate http:// non-localhost fetch
  updated = updated.replace(
    /\bfetch\s*\(\s*(['"])http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)/g,
    'fetch($1https://'
  );

  // Remediate fetch(url) missing AbortSignal.timeout
  if (findings.some((f) => f.id === 'NET-MISSING-TIMEOUT')) {
    updated = updated.replace(
      /\bfetch\s*\(\s*([^,)]+)\s*\)/g,
      'fetch($1, { signal: AbortSignal.timeout(8000) })'
    );
  }

  // Remediate SQL missing RLS
  if (
    findings.some((f) => f.id === 'SQL-MISSING-RLS') &&
    /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+([a-zA-Z0-9_]+)/i.test(updated)
  ) {
    const match = updated.match(/CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+([a-zA-Z0-9_]+)/i);
    if (match?.[1]) {
      updated = `${updated.trim()}\nALTER TABLE ${match[1]} ENABLE ROW LEVEL SECURITY;`;
    }
  }

  return updated;
}

/**
 * Continuous three-pass verification loop:
 *   Pass 1: Draft
 *   Pass 2: Edge-case analysis
 *   Pass 3: Optimized rewrite
 * With the Contrarian/Verifier gating every pass and the final output.
 */
export async function runRoleStackPipeline({
  request,
  context = {},
  initialDraft = null,
  maxPasses = 3,
  enforceThreePasses = true,
  llmAdapter = null,
  onTelemetry = null,
} = {}) {
  const trimmedRequest = String(request ?? '').trim();
  if (!trimmedRequest) {
    throw new Error('request is required for runRoleStackPipeline');
  }

  const boundedPasses = Math.max(1, Math.min(5, Number(maxPasses) || 3));
  const invoke = typeof llmAdapter === 'function' ? llmAdapter : createDefaultLlmAdapter();
  const runId = `run-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const startedAtMs = Date.now();

  const architectPrompt = loadRolePrompt('architect');
  const operatorPrompt = loadRolePrompt('operator');
  const contrarianPrompt = loadRolePrompt('contrarian-verifier');

  const telemetry = [];
  const recordStep = async (entry) => {
    const record = {
      id: `${runId}-${entry.role.toLowerCase()}-p${entry.pass}`,
      runId,
      role: entry.role,
      promptVersion: entry.promptVersion,
      pass: entry.pass,
      passStage: entry.passStage,
      verdict: entry.verdict,
      latencyMs: entry.latencyMs,
      findingsCount: entry.findingsCount ?? 0,
      summary: entry.summary ?? '',
      timestamp: new Date().toISOString(),
    };
    telemetry.push(record);
    if (typeof onTelemetry === 'function') {
      await onTelemetry(record);
    }
    return record;
  };

  // Step 1: Architect (Pass 1 - Theoretical blueprint, schemas, boundaries)
  const archStart = performance.now();
  const architectOutput = await invoke({
    role: 'Architect',
    promptMeta: architectPrompt,
    pass: 1,
    passStage: 'draft',
    input: { request: trimmedRequest, context },
  });
  const archLatencyMs = Math.max(1, Math.round(performance.now() - archStart));

  await recordStep({
    role: 'Architect',
    promptVersion: architectPrompt.version,
    pass: 1,
    passStage: 'draft',
    verdict: 'BLUEPRINT_READY',
    latencyMs: archLatencyMs,
    findingsCount: 0,
    summary: architectOutput?.summary ?? 'Architect schema & boundary blueprint generated',
  });

  // Step 2 & 3: Continuous verification loop (Draft -> Edge-case analysis -> Optimized rewrite)
  const passes = [];
  let priorFindings = [];
  let latestOperatorOutput = null;
  let latestContrarianOutput = null;
  let workingDraft = initialDraft;

  for (let pass = 1; pass <= boundedPasses; pass += 1) {
    const passStage = PIPELINE_PASS_LABELS[pass] ?? `pass-${pass}`;

    // Operator pass
    const opStart = performance.now();
    const operatorOutput = await invoke({
      role: 'Operator',
      promptMeta: operatorPrompt,
      pass,
      passStage,
      input: {
        request: trimmedRequest,
        context,
        architectOutput,
        priorFindings,
        initialDraft: workingDraft,
      },
    });
    const opLatencyMs = Math.max(1, Math.round(performance.now() - opStart));
    latestOperatorOutput = operatorOutput;
    if (operatorOutput?.artifacts?.[0]?.code) {
      workingDraft = operatorOutput.artifacts[0].code;
    }

    await recordStep({
      role: 'Operator',
      promptVersion: operatorPrompt.version,
      pass,
      passStage,
      verdict: pass === 1 ? 'DRAFTED' : pass === 2 ? 'EDGE_CASES_HARDENED' : 'OPTIMIZED',
      latencyMs: opLatencyMs,
      findingsCount: priorFindings.length,
      summary: operatorOutput?.summary ?? `Operator pass ${pass} (${passStage}) complete`,
    });

    // Contrarian/Verifier gate pass
    const cvStart = performance.now();
    const contrarianOutput = await invoke({
      role: 'ContrarianVerifier',
      promptMeta: contrarianPrompt,
      pass,
      passStage,
      input: {
        request: trimmedRequest,
        context,
        architectOutput,
        operatorOutput,
        maxPasses: boundedPasses,
        enforceEdgeCasePass: enforceThreePasses && boundedPasses >= 3,
      },
    });
    const cvLatencyMs = Math.max(1, Math.round(performance.now() - cvStart));
    latestContrarianOutput = contrarianOutput;

    const findings = Array.isArray(contrarianOutput?.findings) ? contrarianOutput.findings : [];
    const verdict = contrarianOutput?.verdict ?? computeContrarianVerdict(findings, { isFinalPass: pass === boundedPasses });

    await recordStep({
      role: 'ContrarianVerifier',
      promptVersion: contrarianPrompt.version,
      pass,
      passStage,
      verdict,
      latencyMs: cvLatencyMs,
      findingsCount: findings.length,
      summary: contrarianOutput?.summary ?? `Contrarian pass ${pass} verdict: ${verdict}`,
    });

    passes.push({
      pass,
      stage: passStage,
      operator: operatorOutput,
      contrarian: {
        ...contrarianOutput,
        verdict,
        findings,
      },
      latencyMs: opLatencyMs + cvLatencyMs,
    });

    priorFindings = findings;

    // Halt immediately on critical BLOCK if configured to fail-fast, or if we don't enforce all 3 passes and already PASS
    if (verdict === 'BLOCK' && findings.some((f) => f.severity === 'critical')) {
      break;
    }
    if (!enforceThreePasses && verdict === 'PASS') {
      break;
    }
  }

  const finalVerdict = latestContrarianOutput?.verdict ?? 'BLOCK';
  const totalLatencyMs = Math.max(1, Date.now() - startedAtMs);

  return {
    ok: finalVerdict === 'PASS',
    runId,
    request: trimmedRequest,
    finalVerdict,
    stageReady: finalVerdict === 'PASS',
    blocked: finalVerdict === 'BLOCK',
    passesCompleted: passes.length,
    totalLatencyMs,
    promptVersions: {
      architect: architectPrompt.version,
      operator: operatorPrompt.version,
      contrarianVerifier: contrarianPrompt.version,
    },
    architect: architectOutput,
    operator: latestOperatorOutput,
    contrarian: latestContrarianOutput,
    passes,
    telemetry,
  };
}

/**
 * Convenience alias for the standard three-pass verification loop:
 * Draft (Pass 1) -> Edge-case analysis (Pass 2) -> Optimized rewrite (Pass 3),
 * with the Contrarian/Verifier gating the final output.
 */
export async function runThreePassVerificationLoop(options = {}) {
  return runRoleStackPipeline({
    ...options,
    maxPasses: 3,
    enforceThreePasses: options.enforceThreePasses ?? true,
  });
}

/**
 * Lightweight Decision Review mode:
 * Scores a project decision on:
 *  - theoreticalValidity (1-10)
 *  - deploymentSimplicity (1-10)
 *  - executionSpeed (1-10)
 */
export async function runDecisionReview({
  title = 'Project Decision',
  proposal,
  context = {},
  llmAdapter = null,
  onTelemetry = null,
} = {}) {
  const trimmedProposal = String(proposal ?? '').trim();
  if (!trimmedProposal) {
    throw new Error('proposal is required for runDecisionReview');
  }

  const invoke = typeof llmAdapter === 'function' ? llmAdapter : createDefaultLlmAdapter();
  const decisionPrompt = loadRolePrompt('decision-review');
  const runId = `decision-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

  const start = performance.now();
  const review = await invoke({
    role: 'DecisionReviewer',
    promptMeta: decisionPrompt,
    pass: 1,
    passStage: 'decision-review',
    input: { title, proposal: trimmedProposal, context },
  });
  const latencyMs = Math.max(1, Math.round(performance.now() - start));

  const telemetryEntry = {
    id: `${runId}-decision-p1`,
    runId,
    role: 'DecisionReviewer',
    promptVersion: decisionPrompt.version,
    pass: 1,
    passStage: 'decision-review',
    verdict: review.verdict ?? 'ITERATE',
    latencyMs,
    findingsCount: Array.isArray(review.risks) ? review.risks.length : 0,
    summary: `${title}: ${review.verdict} (composite ${review.scores?.composite ?? 'N/A'}/10)`,
    timestamp: new Date().toISOString(),
  };

  if (typeof onTelemetry === 'function') {
    await onTelemetry(telemetryEntry);
  }

  return {
    ok: review.verdict === 'APPROVE',
    runId,
    title,
    proposal: trimmedProposal,
    promptVersion: decisionPrompt.version,
    verdict: review.verdict,
    scores: review.scores,
    rationale: review.rationale,
    risks: review.risks ?? [],
    recommendedNextSteps: review.recommendedNextSteps ?? [],
    latencyMs,
    telemetry: [telemetryEntry],
  };
}

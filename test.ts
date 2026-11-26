import assert from 'node:assert/strict';
import { GaneshOrchestrator, listRolePrompts } from './src/ganeshOrchestrator';

const ganesh = new GaneshOrchestrator();

const output = await ganesh.handle({ text: 'Run daily revenue check for Ganesh' });
console.log('Ganesh output:', output);
assert.equal(output.ok, true);

const prompts = listRolePrompts();
assert.equal(prompts.length, 4, 'Should load 4 versioned role prompt files');

const pipelineResult = await ganesh.runRolePipeline(
  'Add Supabase telemetry table with RLS and Express endpoint'
);
assert.equal(pipelineResult.finalVerdict, 'PASS');
assert.equal(pipelineResult.passesCompleted, 3);
assert.equal(ganesh.getState().context.lastRoleVerdict, 'PASS');
assert.ok(ganesh.getState().context.roleTelemetry.length >= 7);

const decisionResult = await ganesh.reviewDecision(
  'Use Vercel Cron + Supabase RLS for Watchdog',
  'Run daily infrastructure checks via Vercel Cron hitting /api/cron/watchdog and persist to Supabase with local JSON fallback and RLS enabled.'
);
assert.equal(decisionResult.verdict, 'APPROVE');
assert.ok(decisionResult.scores.composite >= 7.5);
console.log('Role pipeline & decision review verified:', {
  finalVerdict: pipelineResult.finalVerdict,
  passesCompleted: pipelineResult.passesCompleted,
  decisionVerdict: decisionResult.verdict,
  decisionScores: decisionResult.scores,
});

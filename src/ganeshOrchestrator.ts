import { createActor } from 'xstate';
import {
  ganeshMachine,
  RoleTelemetryItem,
  OrchestratorAlertItem,
} from './ganesh.machine';
import { AGENT_PROMPTS, loadRolePrompt, listRolePrompts } from './agents/prompts';
import {
  runRoleStackPipeline,
  runThreePassVerificationLoop,
  runDecisionReview,
} from '../lib/role-pipeline/index.mjs';

export { AGENT_PROMPTS, loadRolePrompt, listRolePrompts };

export class GaneshOrchestrator {
  private actor = createActor(ganeshMachine);

  constructor() {
    this.actor.start();
  }

  async handle(input: any): Promise<any> {
    return new Promise((resolve) => {
      const sub = this.actor.subscribe((state) => {
        if (state.matches({ main: 'responding' })) {
          sub.unsubscribe();
          resolve(state.context.result ?? state.context);
        }
        if (state.matches({ main: 'error' })) {
          sub.unsubscribe();
          resolve({ ok: false, error: state.context.error });
        }
      });
      this.actor.send({ type: 'INPUT', value: input });
    });
  }

  delegate(agent: string, payload?: any) {
    this.actor.send({ type: 'DELEGATE', agent, payload });
  }

  /**
   * Execute the three-role stack (Architect -> Operator -> Contrarian/Verifier)
   * with the continuous 3-pass verification loop (Draft -> Edge-case analysis -> Optimized rewrite).
   */
  async runRolePipeline(
    request: string,
    options: {
      context?: Record<string, any>;
      initialDraft?: string | null;
      maxPasses?: number;
      enforceThreePasses?: boolean;
      llmAdapter?: any;
      onTelemetry?: (entry: RoleTelemetryItem) => Promise<void> | void;
    } = {}
  ) {
    this.delegate('Architect', { request });
    const result = await runRoleStackPipeline({
      request,
      ...options,
    });
    this.actor.send({
      type: 'RECORD_ROLE_TELEMETRY',
      entries: result.telemetry as RoleTelemetryItem[],
      finalVerdict: result.finalVerdict,
    });
    if (result.blocked) {
      this.pushAlerts([
        {
          id: `block-${result.runId}`,
          source: 'contrarian-verifier',
          domain: 'orchestrator',
          severity: 'critical',
          kind: 'contrarian_block',
          message: `Contrarian/Verifier blocked pipeline ${result.runId}`,
          createdAt: new Date().toISOString(),
        },
      ]);
    }
    return result;
  }

  async runVerificationLoop(
    request: string,
    options: {
      context?: Record<string, any>;
      initialDraft?: string | null;
      enforceThreePasses?: boolean;
      llmAdapter?: any;
      onTelemetry?: (entry: RoleTelemetryItem) => Promise<void> | void;
    } = {}
  ) {
    return runThreePassVerificationLoop({
      request,
      ...options,
    });
  }

  /**
   * Lightweight Decision Review mode:
   * Scores a project decision on theoreticalValidity, deploymentSimplicity, and executionSpeed.
   */
  async reviewDecision(
    title: string,
    proposal: string,
    options: {
      context?: Record<string, any>;
      llmAdapter?: any;
      onTelemetry?: (entry: RoleTelemetryItem) => Promise<void> | void;
    } = {}
  ) {
    this.delegate('DecisionReviewer', { title, proposal });
    const review = await runDecisionReview({
      title,
      proposal,
      ...options,
    });
    this.actor.send({
      type: 'RECORD_ROLE_TELEMETRY',
      entries: review.telemetry as RoleTelemetryItem[],
      finalVerdict: review.verdict,
    });
    return review;
  }

  pushAlerts(alerts: OrchestratorAlertItem[]) {
    if (!Array.isArray(alerts) || alerts.length === 0) return;
    this.actor.send({ type: 'PUSH_ORCHESTRATOR_ALERT', alerts });
  }

  getState() {
    return this.actor.getSnapshot();
  }

  reset() {
    this.actor.send({ type: 'RESET' });
  }
}

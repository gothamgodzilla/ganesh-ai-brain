import { setup, assign } from 'xstate';

export interface RoleTelemetryItem {
  id: string;
  runId: string;
  role: 'Architect' | 'Operator' | 'ContrarianVerifier' | 'DecisionReviewer';
  promptVersion: string;
  pass: number;
  passStage: string;
  verdict: string;
  latencyMs: number;
  findingsCount: number;
  summary: string;
  timestamp: string;
}

export interface OrchestratorAlertItem {
  id: string;
  source?: string;
  domain: string;
  severity: 'critical' | 'warning' | 'info';
  kind: string;
  message: string;
  createdAt: string;
}

export const ganeshMachine = setup({
  types: {
    context: {} as {
      input: any;
      intent?: string;
      project?: string;
      result?: any;
      error?: any;
      safe: boolean;
      meta: Record<string, any>;
      delegated?: any;
      roleTelemetry: RoleTelemetryItem[];
      lastRoleVerdict?: string;
      alerts: OrchestratorAlertItem[];
    },
    events: {} as
      | { type: 'INPUT'; value: any }
      | { type: 'DELEGATE'; agent: string; payload?: any }
      | { type: 'RECORD_ROLE_TELEMETRY'; entries: RoleTelemetryItem[]; finalVerdict?: string }
      | { type: 'PUSH_ORCHESTRATOR_ALERT'; alerts: OrchestratorAlertItem[] }
      | { type: 'RESET' }
      | { type: 'FORCE_ERROR' },
  },
  actions: {
    clearContext: assign({
      input: undefined,
      intent: undefined,
      project: undefined,
      result: undefined,
      error: undefined,
      safe: true,
      meta: {},
      delegated: undefined,
    }),
    captureInput: assign({
      input: ({ event }) => (event as any).value,
    }),
    parseIntent: assign({
      intent: ({ context }) => {
        const text = String(context.input?.text ?? context.input ?? '').toLowerCase();
        if (text.includes('decision') || text.includes('review')) return 'decision-review';
        if (text.includes('build') || text.includes('schema') || text.includes('implement')) return 'role-stack';
        return 'general';
      },
    }),
    selectProject: assign({
      project: () => 'GaneshCore',
    }),
    setResult: assign({
      result: ({ context }) =>
        context.result ?? {
          ok: true,
          message: 'Ganesh cycle complete',
          intent: context.intent,
          lastRoleVerdict: context.lastRoleVerdict,
        },
    }),
    markSafe: assign({ safe: true }),
    markUnsafe: assign({ safe: false }),
    logError: ({ context }) => console.error('Ganesh error:', context.error),
    recordRoleTelemetry: assign({
      roleTelemetry: ({ context, event }) => {
        if (event.type !== 'RECORD_ROLE_TELEMETRY') return context.roleTelemetry;
        return [...event.entries, ...context.roleTelemetry].slice(0, 100);
      },
      lastRoleVerdict: ({ context, event }) =>
        event.type === 'RECORD_ROLE_TELEMETRY' && event.finalVerdict
          ? event.finalVerdict
          : context.lastRoleVerdict,
    }),
    pushOrchestratorAlerts: assign({
      alerts: ({ context, event }) => {
        if (event.type !== 'PUSH_ORCHESTRATOR_ALERT') return context.alerts;
        return [...event.alerts, ...context.alerts].slice(0, 100);
      },
    }),
  },
}).createMachine({
  id: 'ganesh',
  type: 'parallel',
  context: {
    input: undefined,
    intent: undefined,
    project: undefined,
    result: undefined,
    error: undefined,
    safe: true,
    meta: {},
    delegated: undefined,
    roleTelemetry: [],
    lastRoleVerdict: undefined,
    alerts: [],
  },
  states: {
    main: {
      initial: 'idle',
      states: {
        idle: {
          entry: 'clearContext',
          on: { INPUT: { target: 'listening', actions: 'captureInput' } },
        },
        listening: {
          always: [
            { target: 'understanding', guard: ({ context }) => !!context.input },
            { target: 'error' },
          ],
        },
        understanding: {
          entry: 'parseIntent',
          always: [
            { target: 'routing', guard: ({ context }) => !!context.intent },
            { target: 'error' },
          ],
        },
        routing: {
          entry: 'selectProject',
          always: [
            { target: 'acting', guard: ({ context }) => !!context.project },
            { target: 'error' },
          ],
        },
        acting: {
          entry: 'setResult',
          always: { target: 'verifying' },
        },
        verifying: {
          entry: 'markSafe',
          always: [
            { target: 'responding', guard: ({ context }) => context.safe },
            { target: 'error' },
          ],
        },
        responding: { type: 'final' },
        error: {
          entry: 'logError',
          on: { RESET: 'idle' },
        },
      },
    },
    safety: {
      initial: 'monitoring',
      states: {
        monitoring: {
          on: { FORCE_ERROR: 'escalated' },
        },
        escalated: {
          entry: 'markUnsafe',
        },
      },
    },
    memory: {
      initial: 'idle',
      states: {
        idle: {},
        updating: {},
      },
    },
    agentOrchestrator: {
      initial: 'idle',
      states: {
        idle: {
          on: {
            DELEGATE: {
              target: 'running',
              actions: assign({
                delegated: ({ event }) => ({
                  agent: (event as any).agent,
                  payload: (event as any).payload,
                }),
              }),
            },
            RECORD_ROLE_TELEMETRY: {
              actions: 'recordRoleTelemetry',
            },
            PUSH_ORCHESTRATOR_ALERT: {
              actions: 'pushOrchestratorAlerts',
            },
          },
        },
        running: {
          always: { target: 'idle' },
        },
      },
    },
  },
});

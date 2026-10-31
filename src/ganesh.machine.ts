import { setup, assign } from "xstate";

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
    },
    events: {} as
      | { type: "INPUT"; value: any }
      | { type: "DELEGATE"; agent: string; payload?: any }
      | { type: "RESET" }
      | { type: "FORCE_ERROR" }
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
      delegated: undefined
    }),
    captureInput: assign({
      input: ({ event }) => (event as any).value
    }),
    parseIntent: assign({
      intent: () => "general"
    }),
    selectProject: assign({
      project: () => "GaneshCore"
    }),
    setResult: assign({
      result: ({ context }) => context.result ?? { ok: true, message: "Ganesh cycle complete" }
    }),
    markSafe: assign({ safe: true }),
    markUnsafe: assign({ safe: false }),
    logError: ({ context }) => console.error("Ganesh error:", context.error)
  }
}).createMachine({
  id: "ganesh",
  type: "parallel",
  context: {
    input: undefined,
    intent: undefined,
    project: undefined,
    result: undefined,
    error: undefined,
    safe: true,
    meta: {},
    delegated: undefined
  },
  states: {
    main: {
      initial: "idle",
      states: {
        idle: {
          entry: "clearContext",
          on: { INPUT: { target: "listening", actions: "captureInput" } }
        },
        listening: {
          always: [
            { target: "understanding", guard: ({ context }) => !!context.input },
            { target: "error" }
          ]
        },
        understanding: {
          entry: "parseIntent",
          always: [
            { target: "routing", guard: ({ context }) => !!context.intent },
            { target: "error" }
          ]
        },
        routing: {
          entry: "selectProject",
          always: [
            { target: "acting", guard: ({ context }) => !!context.project },
            { target: "error" }
          ]
        },
        acting: {
          entry: "setResult",
          always: { target: "verifying" }
        },
        verifying: {
          entry: "markSafe",
          always: [
            { target: "responding", guard: ({ context }) => context.safe },
            { target: "error" }
          ]
        },
        responding: { type: "final" },
        error: {
          entry: "logError",
          on: { RESET: "idle" }
        }
      }
    },
    safety: {
      initial: "monitoring",
      states: {
        monitoring: {
          on: { FORCE_ERROR: "escalated" }
        },
        escalated: {
          entry: "markUnsafe"
        }
      }
    },
    memory: {
      initial: "idle",
      states: {
        idle: {},
        updating: {}
      }
    },
    agentOrchestrator: {
      initial: "idle",
      states: {
        idle: {
          on: {
            DELEGATE: {
              target: "running",
              actions: assign({
                delegated: ({ event }) => ({ agent: (event as any).agent, payload: (event as any).payload })
              })
            }
          }
        },
        running: {
          // In production: invoke real subagent actors here
          always: { target: "idle" }
        }
      }
    }
  }
});

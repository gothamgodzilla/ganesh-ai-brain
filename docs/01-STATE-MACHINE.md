# Hierarchical + Parallel State Machine

Use XState v5 `setup` + `createMachine` with `type: "parallel"` at the root.

See `src/ganesh.machine.ts` for the production definition.

### Critical rules for the machine
- Fresh context on every `handle()` call
- Learning / Responding are terminal for a single request
- Safety and Memory run independently
- Use `always` transitions for pure data-driven moves
- Use events (`INPUT`, `DELEGATE`, `FORCE_ERROR`, `RESET`) for external control

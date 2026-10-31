# Ganesh Framework Overview

## Architecture

```
Ganesh (parallel root)
├── Main (hierarchical)
│   ├── Idle
│   ├── Listening
│   ├── Understanding
│   ├── Routing
│   ├── Acting
│   ├── Verifying
│   └── Responding (final)
├── Safety (parallel)
│   ├── Monitoring
│   └── Escalated
├── Memory (parallel)
│   ├── Idle
│   └── Updating
└── AgentOrchestrator (parallel)
    ├── ContentMonetizationAgent
    ├── FeatureEvaluatorAgent
    ├── NemesisBuilderAgent
    └── MathReasoner (optional deep analysis)
```

## Key Principles
1. Event-driven, not polling
2. Entry/exit actions + guards
3. Parallel regions never block the main flow
4. Subagents return only distilled results (context isolation)
5. Human approval gates for consequential actions
6. Every cycle can feed a recursive improvement log

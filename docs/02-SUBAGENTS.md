# Sub-Agent System (SuperClaude style)

Subagents are isolated actors with their own context. They receive a focused system prompt + payload and return only the result.

## Available Agents

| Agent | Trigger | Purpose |
|-------|---------|--------|
| ContentMonetizationAgent | DELEGATE content | SEO, offers, funnels, retention content |
| FeatureEvaluatorAgent | DELEGATE features | Score 3 features on productivity / revenue / popularity |
| NemesisBuilderAgent | DELEGATE nemesis | Public-site analysis → 3 structural weaknesses → differentiated superior version |
| SafetyMonitor | always parallel | Timeout, rate, cost, policy watches |
| MemoryWriter | after response | Persist insights, update vector / Mongo |

## How to spawn
From the main machine send:
```ts
{ type: "DELEGATE", agent: "FeatureEvaluator", payload: { features: [...] } }
```

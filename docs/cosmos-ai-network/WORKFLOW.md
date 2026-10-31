# Cosmos AI Network — Build & Monitoring Workflow

## 1. Environment Setup (Clean)

- Node 20+
- Python 3.12 venv
- Claude Code + Playwright MCP (`claude mcp add playwright npx @playwright/mcp@latest`)
- Optional: browser-use, Puppeteer

## 2. Project Bootstrap

```bash
cd ~/cosmos-ai-network
# (or the actual working directory)
claude
# Paste Master Prompt
# Then: Confirm tools and create only the initial project structure + top-level GenerativeBuildMachine. Stop after that.
```

## 3. Focused Build Cycles

Always use the Continue Prompt after each response to stay token-efficient.

## 4. Multi-Panel Dashboard (Twin Workflow Monitor)

Target visual + interactive dashboard with these panels:

- GenerativeBuildMachine
- TelephonySessionMachine + Cosmos Diva
- ConnectivityMachine
- PrivacyMachine
- QCNMachine
- Engine Health (git status, last cycle, success/failure)

Dark theme (#0B0F19), electric cyan accents, auto-refresh, Force Refresh + Run Health Check buttons.

Dashboard lives in `dashboard/` and should be runnable with one command.

## 5. Live Verification

Use Playwright MCP to open real documentation and later the Coexist sandbox domains.

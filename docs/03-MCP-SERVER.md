# MCP Server Integration

Ganesh is designed to expose and consume MCP (Model Context Protocol) tools.

## Recommended MCP servers
- Browser / web tools (for Nemesis analysis)
- GitHub (already connected)
- Gamma (already connected)
- File system / MongoDB for memory
- Any SuperClaude-compatible MCP (PAL, Rube, etc.)

## Configuration skeleton
Place in `~/.claude/mcp.json` or your runtime:
```json
{
  "mcpServers": {
    "ganesh-tools": {
      "command": "node",
      "args": ["./mcp/ganesh-mcp-server.js"]
    }
  }
}
```

Expose tools: `analyze_public_site`, `spawn_subagent`, `update_memory`, `generate_gamma`, `generate_napkin_diagram`.

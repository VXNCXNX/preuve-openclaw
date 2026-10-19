# Preuve AI plugin for OpenClaw

Score a startup idea against live market evidence without leaving OpenClaw.
Same analysis as [Preuve AI](https://preuve.ai): a viability score and verdict,
real competitors, risks, and source-linked citations from 60+ live sources,
exported as structured JSON your agent can read.

## Install

Listed on [ClawHub](https://clawhub.ai/vxncxnx/plugins/preuve).

```bash
openclaw plugins install @vxncxnx/preuve
openclaw plugins enable preuve
openclaw gateway restart
```

Create an API key at [preuve.ai, Account → API Keys](https://preuve.ai/app?settings=apiKeys).
Manual key creation needs a paid personal plan or membership of a Consultant or
Agency workspace with an active subscription or a one-time unlock. The key is
shown once.

```json5
{
  plugins: {
    entries: {
      preuve: {
        enabled: true,
        config: { apiKey: "prv_..." }
      }
    }
  }
}
```

Keep the key in the config file or an environment variable, never in a chat.

## Tools

| Tool                     | What it does                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `preuve_start_analysis`  | Validate one idea. A starter scan is the default and costs nothing. A deep scan runs only when you ask for it |
| `preuve_get_analysis`    | Poll a run until it is `COMPLETED`, with the report URL                                                        |
| `preuve_export_analysis` | Read the finished report as JSON: score, verdict, competitors, risks, citations                                |
| `preuve_generate_ideas`  | Generate startup ideas from interests or skills, free of scan quota                                            |

A starter scan takes about a minute, a deep scan about ten. Retrying with the
same `clientRunId` never spends twice.

## Prefer MCP?

The same tools, plus enrichment and Consultant or Agency workspaces, are served
by the [Preuve AI MCP server](https://preuve.ai/mcp) at `https://mcp.preuve.ai/mcp`.
In claude.ai, Claude Code, Cursor or Codex it signs you in with OAuth, which
works on a free account. Full API reference at [docs.preuve.ai](https://docs.preuve.ai).

## Develop

```bash
npm install
npm run build
npm pack
openclaw plugins install npm-pack:./vxncxnx-preuve-0.1.0.tgz --force
openclaw plugins inspect preuve --runtime
```

MIT.

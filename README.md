# LiveKit + Scalekit Voice + Tools Demo

A focused prototype showing how to combine **LiveKit Agents** (real-time voice AI) with **Scalekit AgentKit** (per-user authenticated tool calling).

**Goal of this project**: let a voice agent speak naturally and then securely perform real actions (e.g. list Google Calendar events) on behalf of an authenticated user — without ever exposing raw OAuth tokens to the LLM or the voice platform.

> **Repo status**: this project currently lives inside a monorepo checkout at `ecosystem/livekit-scalekit-voice-demo/`, but it is its own standalone git repository (own history, own commits) and is intended to be pushed directly to GitHub under `scalekit-developers` as `livekit-scalekit-voice-demo` — the same way its sibling `vapi-scalekit-voice-demo` was published.

> **Not yet run against real credentials.** This entire build was done without a real LiveKit Cloud project, live Scalekit credentials, or the `lk` CLI installed. Every check so far is static — `npm run typecheck` / `lint` / `build`, plus manual reading of the installed SDK's type declarations to confirm the API calls are real and correctly shaped. Nothing here has been exercised against a live voice call, a live LiveKit room, or a live Scalekit connection. See [Real-Key Validation Checklist](#real-key-validation-checklist) before treating this as "done."

## Getting Started

This is a standalone Next.js + Node app. You can clone it directly (once published) or work from this checkout.

### Clone and install

```bash
git clone https://github.com/scalekit-developers/livekit-scalekit-voice-demo.git
cd livekit-scalekit-voice-demo

npm install

cp .env.example .env.local
```

Edit `.env.local` and fill in your actual keys (see [Environment Variables](#environment-variables) below).

### Configure the two dashboards

**LiveKit Cloud** (https://cloud.livekit.io)
- Create (or reuse) a LiveKit Cloud project.
- Go to **Settings → Keys** and copy `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` into `.env.local`.
- No `lk` CLI login is required to run this demo — the Next.js API route and the agent worker both read these three env vars directly from the environment. The [`lk` CLI](https://docs.livekit.io/home/cli/cli-setup/) is a convenient way to inspect a room's participants and agent status while debugging, but it isn't mandatory.

**Scalekit dashboard**
- Go to **AgentKit → Connections**.
- Create or verify a `googlecalendar` connection.
- Authorize it using the same identifier you'll put in `TEST_IDENTIFIER`.
- Confirm it shows as **Active**.
- Copy `SCALEKIT_ENV_URL`, `SCALEKIT_CLIENT_ID`, `SCALEKIT_CLIENT_SECRET` into `.env.local`.

### Run both processes

This demo is two separate processes: the Next.js web app, and the LiveKit agent worker.

```bash
# Terminal 1 — Next.js UI + API routes
npm run dev

# Terminal 2 — LiveKit agent worker (watch mode, loads .env.local)
npm run dev:agent
```

Open http://localhost:3000, click **Start Voice Call**, and try:

- "What's on my calendar today?"
- "Do I have any meetings tomorrow?"
- "List my upcoming events"

> **Progress tracking**: see `PROGRESS.md` in this repo for current implementation status, the MCP investigation finding, and open gaps.

### Why these steps matter

- Unlike the Vapi sibling demo, there's no webhook and no ngrok — LiveKit Cloud dispatches the agent worker directly inside your own infrastructure (or your own machine, in dev). The agent worker just needs outbound connectivity to `LIVEKIT_URL`.
- `dev:agent` needs `--env-file=.env.local` because it's a plain `tsx` process, not a Next.js dev server — Next.js loads `.env.local` for you automatically, but a standalone Node process doesn't.
- The `scalekitConnectionId` is passed via LiveKit agent-dispatch **metadata**, read server-side by the agent worker — this is how we securely identify which user's Google Calendar connection to use without exposing tokens.

## Why This Integration Matters

Voice agents are powerful for natural interaction, but they're only useful for real work if they can act on the user's behalf in external systems (Gmail, Calendar, Slack, CRM, etc.).

Two hard problems appear immediately:

1. **Authentication & Authorization** — the voice agent must act as a specific user. You cannot give the LLM long-lived tokens. You need short-lived, scoped, auditable access tied to a real human identity.
2. **Tool surface for voice** — the agent needs to know what actions are possible and how to call them. The actions must be reliable, well-described, and return speakable results.

Scalekit AgentKit solves the first problem by providing:
- OAuth connection management per user (`identifier`)
- A clean `executeTool({ connector, toolName, toolInput, identifier })` surface
- Tool discovery via `listScopedTools` / `listAvailableTools`

LiveKit Agents solves the voice part: it runs a persistent worker process, dispatches jobs into rooms, and gives you function tools (`llm.tool(...)`) plus LiveKit Inference for STT/LLM/TTS — all without you having to manage separate provider API keys.

This demo uses **direct `executeTool` calls from a LiveKit function tool** rather than MCP, because MCP isn't available in the installed `@livekit/agents` version (see [How This Was Built](#how-this-was-built-deep-dive)). The Scalekit identity contract — pass an `identifier`, never a token — is the reusable pattern; the tool-calling mechanism (direct call vs. MCP) is an implementation detail that can evolve later.

## The Identity Contract

This is the single most important architectural point in this project: **the browser never sees a Scalekit token or credential.**

- The client only ever knows an `identifier` — a connection identifier, not a secret (in this demo, `NEXT_PUBLIC_TEST_SCALEKIT_CONNECTION_ID`).
- It POSTs that identifier to `/api/livekit/start`. This route is the **only place** that decides what goes into the LiveKit agent-dispatch metadata: `JSON.stringify({ scalekitConnectionId: identifier })`.
- The agent worker (`agent/src/agent.ts`) is a separate, trusted server-side process. It reads that metadata from `ctx.job.metadata` and is the **only thing** that ever constructs a `ScalekitClient` or calls `executeTool`.
- The LLM only ever sees calendar data returned from the tool call — never a token, never a credential.

```
Browser (identifier only)
   │
   ▼
/api/livekit/start   ← only place that builds dispatch metadata
   │  metadata = { scalekitConnectionId: identifier }
   ▼
LiveKit Cloud (dispatches job with metadata)
   │
   ▼
agent worker          ← only place that builds a ScalekitClient / calls executeTool
   │  identifier = JSON.parse(ctx.job.metadata).scalekitConnectionId
   ▼
Scalekit AgentKit (executeTool as that identifier)
```

## High-Level Architecture & Data Flow

```
User (browser)
   │
   │ 1. Clicks "Start Voice Call"
   ▼
Next.js UI (app/page.tsx, @livekit/components-react)
   │
   │ 2. POST /api/livekit/start { identifier }
   ▼
Next.js API route (app/api/livekit/start/route.ts)
   │
   │ 3. AgentDispatchClient.createDispatch(roomName, "scalekit-voice-agent",
   │      { metadata: JSON.stringify({ scalekitConnectionId: identifier }) })
   │ 4. Mint a participant AccessToken (roomJoin grant)
   ▼
LiveKit Cloud
   │
   │ 5. Creates the room, dispatches the named agent job into it
   │ 6. Browser joins the same room using the minted token
   ▼
Agent worker process (agent/src/agent.ts, npm run dev:agent)
   │
   │ 7. ctx.connect(); identifier = JSON.parse(ctx.job.metadata).scalekitConnectionId
   │ 8. new voice.Agent({ instructions, tools: { googlecalendar_list_events } })
   │ 9. new voice.AgentSession({ llm, stt, tts }) — via LiveKit Inference
   │ 10. session.start({ agent, room: ctx.room })
   ▼
User speaks: "What's on my calendar today?"
   │
   │ 11. LLM decides to call googlecalendar_list_events
   ▼
Scalekit AgentKit
   │
   │ 12. scalekit.actions.executeTool({ connector: "googlecalendar", identifier,
   │        toolName: "googlecalendar_list_events", toolInput: { calendar_id } })
   │ 13. Looks up the identifier's active Google Calendar connection
   │ 14. Executes the real Google Calendar API call (short-lived token, never exposed)
   ▼
Agent worker
   │
   │ 15. Tool returns result.data to the LLM
   │ 16. LLM formulates a spoken response
   ▼
User hears the calendar events read out loud (via LiveKit Inference TTS)
```

**Why this shape?**
- All privileged work happens in the agent worker process — a separate, server-side, trusted process that never runs in the browser.
- The browser never sees a Scalekit token — only a LiveKit participant token, scoped to one room.
- Scalekit is the single source of truth for "who is allowed to do what."
- LiveKit Inference means no separate OpenAI / AssemblyAI / Cartesia API keys are needed — STT/LLM/TTS route through LiveKit Cloud, billed to the LiveKit project.

## Prerequisites

- Node 18+
- A LiveKit Cloud project (Settings → Keys for `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`)
- A Scalekit environment with AgentKit enabled
- A Google account you can connect to Scalekit for testing (the identifier you'll use)

## Environment Variables

From `.env.example` — copy to `.env.local` and fill in real values:

| Variable | Used by | Purpose |
|---|---|---|
| `SCALEKIT_ENV_URL` | Next.js API routes, agent worker | Scalekit environment base URL |
| `SCALEKIT_CLIENT_ID` | Next.js API routes, agent worker | Scalekit client credentials |
| `SCALEKIT_CLIENT_SECRET` | Next.js API routes, agent worker | Scalekit client credentials (server-only, never sent to the browser) |
| `TEST_IDENTIFIER` | `/api/livekit/start`, `/api/debug/tools`, agent worker (fallback) | Server-side default Scalekit identifier for local testing |
| `NEXT_PUBLIC_TEST_SCALEKIT_CONNECTION_ID` | `app/page.tsx` | Same identifier, exposed to the browser so the demo UI can send it — **it's an identifier, not a secret** |
| `LIVEKIT_URL` | `/api/livekit/start`, agent worker | LiveKit Cloud project WebSocket URL |
| `LIVEKIT_API_KEY` | `/api/livekit/start`, agent worker | LiveKit Cloud project API key |
| `LIVEKIT_API_SECRET` | `/api/livekit/start`, agent worker | LiveKit Cloud project API secret (server-only) |

In a real product, the identifier would come from the authenticated user's session, not a static env var — see [Next Steps](#next-steps--evolution).

## How This Was Built (Deep Dive)

The build started from a plan sketch based on reading LiveKit's docs and the Vapi sibling demo. Two parts of that sketch turned out to be wrong once checked against the actually-installed `@livekit/agents@1.4.11` type declarations:

1. **`voice.Agent` has no static `.create()`.** The plan's sketch wrote `voice.Agent.create({ instructions, tools: [...] })`. The real API is a plain constructor: `new voice.Agent({ instructions, tools: {...} })`.
2. **`llm.tool()` takes no `name` field.** The plan's sketch wrote `llm.tool({ name: 'googlecalendar_list_events', ... })`. The real API has no `name` property on the tool definition — the tool's name comes from the **key** you give it in the `tools` object passed to `voice.Agent`, e.g. `tools: { googlecalendar_list_events }`.

Both were caught by reading the installed SDK's `.d.ts` files rather than trusting the sketch, and both are reflected in the current `agent/src/agent.ts`.

**`agent/src/agent.ts` — the agent worker**

- Runs as its own Node process (via `tsx`), separate from the Next.js app.
- `entry(ctx: JobContext)`: calls `ctx.connect()` first, then parses `ctx.job.metadata` (a JSON string) to recover `scalekitConnectionId`, falling back to `TEST_IDENTIFIER` then a hardcoded default.
- Builds its own `ScalekitClient` (a module-level singleton, separate from `lib/scalekit.ts` — that one is scoped to the Next.js runtime; the worker is a different process and needs its own).
- Registers one function tool, `googlecalendar_list_events`, whose `execute` calls `scalekit.actions.executeTool({ connector: 'googlecalendar', identifier, toolName: 'googlecalendar_list_events', toolInput: { calendar_id } })` and returns `result.data ?? result`.
- Builds `voice.AgentSession({ llm: 'openai/gpt-4o-mini', stt: 'assemblyai/universal-streaming', tts: 'cartesia/sonic-2' })` — these are LiveKit Inference model strings, routed through LiveKit Cloud, so no separate OpenAI/AssemblyAI/Cartesia API keys are configured anywhere in this project.
- `cli.runApp(new ServerOptions({ agent: import.meta.filename, agentName: 'scalekit-voice-agent' }))` — self-starts the worker when the file is run directly. `agentName` must match the name used in `createDispatch` on the Next.js side, or LiveKit won't route jobs to this worker.

**`app/api/livekit/start/route.ts` — dispatch + token minting**

- The only Next.js route that talks to LiveKit's server SDK.
- Builds `metadata = JSON.stringify({ scalekitConnectionId: identifier })` and calls `AgentDispatchClient.createDispatch(roomName, 'scalekit-voice-agent', { metadata })`.
- Mints a participant `AccessToken` with a `roomJoin` grant scoped to the same room, and returns `{ roomName, token, url, identifier }` to the browser.
- Validates `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` are present and returns a clear 500 with a hint if not.

**`app/page.tsx` — the voice UI**

- A single client component. Uses `livekit-client`'s `Room` plus `@livekit/components-react`'s `<LiveKitRoom>` and `<RoomAudioRenderer>`.
- Tracks `idle` / `connecting` / `active` state and renders a connection-lifecycle log (participant joined/left, connected, disconnected, errors) rather than a real transcript — there is no data-channel or transcription wiring yet.
- On "Start Voice Call," POSTs the identifier to `/api/livekit/start`, then passes the returned `url`/`token` into `<LiveKitRoom connect audio>`.

**`app/api/debug/tools/route.ts` — tool discovery**

- Ported near-verbatim from the Vapi sibling demo. Calls `scalekit.tools.listScopedTools(identifier, { filter })` first, falls back to `listAvailableTools(identifier)` if that returns nothing, and normalizes the (inconsistently-shaped) tool definitions into `{ name, description, provider, connectedAccountId, suggestedToolName }`.
- Useful for confirming the exact tool name(s) Scalekit exposes for your identifier before wiring up a new function tool in the agent.

**`lib/scalekit.ts` — the Next.js-side Scalekit client**

- A module-level singleton `ScalekitClient`, used only by the Next.js API routes (`/api/debug/tools`). Deliberately not shared with the agent worker, which runs in a separate process and builds its own client.

### Project Structure

```
app/
├── page.tsx                       # Voice UI: Start/End call, connection-lifecycle log
├── layout.tsx, globals.css        # Shell/theme (dark zinc, Geist font)
└── api/
    ├── livekit/start/route.ts     # Dispatches the agent + mints the participant token
    └── debug/tools/route.ts       # Lists Scalekit tools available to an identifier
agent/
└── src/agent.ts                   # Standalone LiveKit agent worker (separate Node process)
lib/
└── scalekit.ts                    # Scalekit client singleton — Next.js runtime only
scripts/                           # Empty (Task 6 skipped — see PROGRESS.md)
.env.example
plan.md                            # Internal planning doc (gitignored, not part of the public repo)
```

- All privileged Scalekit calls live in server-side code — the Next.js API routes and the agent worker — never in the browser.
- The web app and the agent worker are two independent processes with two independent Scalekit clients, on purpose: they run in different runtimes and there's no shared server to hold module state between them.

## Troubleshooting

| Symptom | Likely Cause & Why |
|---|---|
| `npm run lint` fails or crashes on install | `eslint` was pinned to `^9.39.4` (down from the `^10.x` that a fresh `npm install` initially resolves) because `eslint-config-next`'s bundled `eslint-plugin-react` isn't yet compatible with ESLint 10's removed `context.getFilename()` API. If your `package.json` still resolves ESLint 10.x, re-pin it to `^9.39.4`. As of the current commit, `npm run lint` is clean. |
| `dev:agent` can't find `SCALEKIT_ENV_URL` / `LIVEKIT_URL` etc. even though they're in `.env.local` | `npm run dev:agent` runs `tsx watch --env-file=.env.local agent/src/agent.ts dev` — the `--env-file` flag is required because this is a plain Node process, not a Next.js dev server. Next.js loads `.env.local` automatically; a standalone `tsx` process does not, unless told to. |
| Agent never joins the room after dispatch | `agentName` in `ServerOptions` (`agent/src/agent.ts`) must exactly match the name passed to `AgentDispatchClient.createDispatch(...)` (`app/api/livekit/start/route.ts`) — both are `'scalekit-voice-agent'` currently. Also confirm the agent worker process (`npm run dev:agent`) is actually running. |
| `/api/livekit/start` returns 500 "Missing LIVEKIT_URL..." | Fill `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` in `.env.local` from your LiveKit Cloud project's Settings → Keys, then restart `npm run dev`. |
| `/api/debug/tools` errors or returns an empty tool list | `SCALEKIT_*` env vars missing, or `TEST_IDENTIFIER` doesn't match an **Active** connection in the Scalekit AgentKit dashboard. |
| `.env.example` has an unused `NEXT_PUBLIC_APP_URL` | Harmless leftover from the file's original scaffold. Only the eight vars in [Environment Variables](#environment-variables) above are actually read by this project's code. |
| Agent speaks nothing, or a generic error, after asking about the calendar | Most likely `TEST_IDENTIFIER` / the dispatched `scalekitConnectionId` doesn't have an Active Google Calendar connection in Scalekit. Check `/api/debug/tools` for the identifier first. |

## Real-Key Validation Checklist

This project has **not** been run against a live LiveKit Cloud project or live Scalekit credentials. Everything above was verified statically (`npm run typecheck` / `lint` / `build`, and manual reading of the installed SDK's type declarations). Before treating this demo as working, a human with real credentials should walk through:

- [ ] **Metadata roundtrip** — start a call, confirm the `[scalekit-voice-agent] job=... room=... identifier=...` log line in the agent worker's terminal shows the exact identifier `/api/livekit/start` sent (check both terminals side by side).
- [ ] **Browser join + agent auto-dispatch** — confirm both the browser participant and the agent worker appear as participants in the same room (e.g. via the LiveKit Cloud dashboard or the `lk` CLI).
- [ ] **Live `googlecalendar_list_events` call** — ask about the calendar out loud, confirm the Scalekit dashboard shows the tool execution attributed to the correct identifier, and that the agent speaks a sensible summary of real events.
- [ ] **Error path** — dispatch with a bad or inactive identifier, confirm the agent speaks a graceful error instead of crashing the worker process.
- [ ] **Multiple concurrent sessions** — open two browser tabs with two different identifiers, confirm each gets correct, isolated calendar data (no cross-talk).

## Next Steps / Evolution

1. **MCP**, once the Node `@livekit/agents` SDK supports it — investigated during this build and confirmed absent from `@livekit/agents@1.4.11` (see `PROGRESS.md`). Direct `executeTool` is deliberately the primary path for now, not a placeholder.
2. **Real session-derived identifiers** instead of `TEST_IDENTIFIER` / `NEXT_PUBLIC_TEST_SCALEKIT_CONNECTION_ID` — in a real product the identifier comes from the authenticated user's session, not a static env var.
3. **Multi-connector support** — beyond `googlecalendar_list_events`, register additional Scalekit-backed tools (Gmail, Slack, etc.) once there's a real need to demonstrate them.
4. **Telephony** — LiveKit supports SIP-based phone calls into the same agent worker; this demo only wires up the browser (WebRTC) path.
5. **A real transcript / data-channel wiring** — the current UI only logs room-lifecycle events, not actual spoken transcript text.
6. **A `scripts/` credential/token helper**, if/when MCP or another connector needs a standalone token-minting flow (the directory currently exists but is empty — Task 6 in the original build plan was deliberately skipped since there was nothing to build yet).

---

This README is intentionally verbose on the "why" — the goal is that anyone (including future you) can understand not just *what* to type, but *why* each decision was made, and exactly what has and hasn't been verified.

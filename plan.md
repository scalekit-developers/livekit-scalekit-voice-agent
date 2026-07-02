# Plan: Build LiveKit + Scalekit Voice Demo (analog to vapi-scalekit-voice-demo)

## Context

The user wants to build a voice AI demo that lets a natural-speaking assistant securely perform authenticated third-party actions (e.g. Google Calendar via Scalekit AgentKit) on behalf of a specific user, **without exposing tokens to the LLM or voice platform**.

A working reference implementation already exists:
- `ecosystem/vapi-scalekit-voice-demo/` — Next.js app using Vapi (managed voice AI) + Scalekit.
  - Key pattern: pass `scalekitConnectionId` (identifier) via call `metadata`.
  - Webhook bridge (or MCP) → `scalekit.actions.executeTool({connector, identifier, toolName, toolInput})`.
  - Detailed README + PROGRESS.md capturing architecture, "why" decisions, setup, MCP evolution path, and debug helpers.
  - Scripts for minting per-user Scalekit Virtual MCP tokens.

The goal is to create a **separate parallel directory** `ecosystem/livekit-scalekit-voice-demo/` (modeled directly after the vapi one).

LiveKit provides the realtime media + a powerful Agents framework (Node/TS preferred, Python also supported) with function tools. MCP support should be added only if it is easy and straightforward — do not force it like the Vapi demo did. Primary implementation should use direct `executeTool` calls.

Copy `.env.example` from `ecosystem/vapi-scalekit-voice-demo` as the starting point.

**Why now / value**:
- Validates Scalekit AgentKit/MCP works cleanly with another major voice AI platform (LiveKit is open + widely used for custom agents, telephony, etc.).
- LiveKit's in-process agent model + native MCP makes the tool bridge potentially simpler/cleaner than Vapi's external webhook.
- The "identifier via trusted metadata" pattern maps almost 1:1 (LiveKit dispatch `metadata` + `ctx.job.metadata`).
- Ecosystem/ is the right home for such integration demos (see chargebee, crewai-scalekit-exploration, litellm-agentkit-inbox-triage, vapi-*, mastra).
- Builds on existing Scalekit SDK usage patterns already present in the workspace.

This will live as a new self-contained project under `ecosystem/livekit-scalekit-voice-demo/` (following vapi precedent; not a submodule).

## Recommended Approach (Chosen)

**Hybrid architecture (Next.js shell + Node/TS LiveKit Agent)** — Node/JS/TS oriented preferred:

- **Frontend / API layer**: Next.js 16 (App Router, React 19, Tailwind/Geist like the Vapi demo).
  - Simple voice UI: Start/End "Call" button, live status, transcript pane.
  - On start: call internal API to (1) derive/mint Scalekit identity, (2) create LiveKit room + explicit agent dispatch passing `metadata` JSON with `scalekitConnectionId`, (3) generate LiveKit participant access token.
  - Use `@livekit/components-react` + `livekit-client` to connect browser participant to the room and render audio.
  - Re-use Scalekit debug/tools listing and (if needed) MCP token minting logic.
- **Agent layer**: Node/TS LiveKit agent (preferred). Fall back to Python only if Node agent surface is insufficient.
  - Use official `lk agent init` starter (Node/TS template).
  - `defineAgent` + `voice.AgentSession`.
  - Primary tool path: direct `llm.tool(...)` (Zod or JSON schema) that uses `@scalekit-sdk/node` to call `executeTool` with the `identifier` from job metadata.
  - MCP: add only if easy and straightforward (current LiveKit Node MCP support is limited compared to Python). Do not force the MCP path.
  - Parse identity: `const metadata = JSON.parse(ctx.job.metadata || "{}")`; `const identifier = metadata.scalekitConnectionId`.
  - Use LiveKit Inference or plugins (STT/LLM/TTS) + turn detection.
- **Glue / identity**:
  - Reuse the exact Scalekit patterns (singleton client, `getScalekitClient`, `executeTool`, `listScopedTools`).
  - For MCP token generation script only: Python SDK is acceptable.
  - Metadata is the secure carrier for `scalekitConnectionId`.
  - For production: replace `TEST_IDENTIFIER` with session-derived value.
- **Project layout** (separate parallel directory, modeled directly after vapi demo):
  ```
  ecosystem/livekit-scalekit-voice-demo/
  ├── app/                  # Next.js UI + API routes (dispatch, token mint, debug)
  ├── agent/                # Node/TS LiveKit agent (src/agent.ts or following lk starter)
  ├── scripts/              # token generators (adapt vapi's; Python OK for MCP token gen)
  ├── package.json
  ├── .env.example          # copied from ecosystem/vapi-scalekit-voice-demo as starting point
  ├── README.md (detailed "why", flow diagrams, setup)
  ├── PROGRESS.md (status vs LiveKit/Scalekit docs)
  └── ...
  ```
- **Dev experience**:
  - `npm run dev` for web.
  - `npm run dev:agent` (or `lk` / tsx) for the Node agent (LiveKit Cloud project linked via `lk`).
  - Use ngrok or LiveKit Cloud as needed.
  - Debug endpoint `/api/debug/tools` remains almost identical.
- **MCP vs direct**:
  - Primary: direct executeTool inside function tools (no forcing MCP).
  - MCP only if easy and straightforward for the chosen runtime.
- **Dependencies** (high level):
  - Web: `next`, `@scalekit-sdk/node`, `livekit-client`, `@livekit/components-react`, `@livekit/components-styles`, `livekit-server-sdk`.
  - Agent (Node/TS first): `@livekit/agents`, `@scalekit-sdk/node`, zod (for tool schemas).
  - (Optional Python script for MCP token only: `scalekit-sdk-python`).
- **No changes** to existing vapi demo or other code. Pure additive new demo in a separate parallel directory.

This keeps things Node/TS oriented where possible while allowing Python SDK only for the MCP token generator script. It stays focused on the direct authenticated tool execution pattern.

## Critical Files / Directories (to Create or Adapt)

### New files (primary surface)
- `ecosystem/livekit-scalekit-voice-demo/README.md` — comprehensive, modeled exactly on vapi one (architecture diagram, setup steps for both dashboards/CLI, metadata importance, troubleshooting, evolution notes).
- `ecosystem/livekit-scalekit-voice-demo/PROGRESS.md` — status, doc references (LiveKit llms.txt + specific pages, Scalekit AgentKit), validation, gaps.
- `ecosystem/livekit-scalekit-voice-demo/app/page.tsx` — React UI (adapted Vapi logic to LiveKit Room connect + events).
- `ecosystem/livekit-scalekit-voice-demo/app/layout.tsx` + `globals.css` — copy/adapt (title "LiveKit + Scalekit").
- `ecosystem/livekit-scalekit-voice-demo/app/api/livekit/start/route.ts` (or `/session`) — core: dispatch agent via livekit-server-sdk with metadata, return LiveKit join token + room info. (MCP token mint only if using MCP path.)
- `ecosystem/livekit-scalekit-voice-demo/app/api/debug/tools/route.ts` — **reuse almost verbatim**.
- `ecosystem/livekit-scalekit-voice-demo/app/api/scalekit/mcp-session/route.ts` — adapt vapi version (only if MCP path is implemented).
- `ecosystem/livekit-scalekit-voice-demo/next.config.ts`, `tsconfig.json`, `package.json`, `postcss.config.mjs`, `eslint.config.mjs`.
- `ecosystem/livekit-scalekit-voice-demo/scripts/generate-mcp-token.py` + `.js` — adapt (Python SDK OK for token generation script only; main agent is Node/TS).
- `ecosystem/livekit-scalekit-voice-demo/agent/src/agent.ts` (or following lk Node starter) — main LiveKit Node/TS agent with direct tools + session.
- `ecosystem/livekit-scalekit-voice-demo/.env.example` — copy from `ecosystem/vapi-scalekit-voice-demo` as starting point, then add LIVEKIT_* vars.
- `ecosystem/livekit-scalekit-voice-demo/scripts/README.md` — adapt.
- Optional: `public/` assets if screenshots added later.

### Supporting / config
- Use `lk agent init --template agent-starter-node` for the agent starter.
- No heavy Python requirements unless MCP token script is used.

### Files that will be read/referenced (not edited here)
- Source of truth patterns:
  - `ecosystem/vapi-scalekit-voice-demo/app/page.tsx`
  - `ecosystem/vapi-scalekit-voice-demo/app/api/vapi/webhook/route.ts`
  - `ecosystem/vapi-scalekit-voice-demo/app/api/debug/tools/route.ts`
  - `ecosystem/vapi-scalekit-voice-demo/app/api/scalekit/mcp-session/route.ts`
  - `ecosystem/vapi-scalekit-voice-demo/scripts/generate-mcp-token.py`
  - `ecosystem/vapi-scalekit-voice-demo/scripts/generate-mcp-token.js`
  - `ecosystem/vapi-scalekit-voice-demo/README.md` + `PROGRESS.md`
  - `ecosystem/chargebee/lib/scalekit.ts` (client singleton)
  - `ecosystem/litellm-agentkit-inbox-triage/src/tools/agentkit.ts` (executeTool wrapper)
  - `ecosystem/crewai-scalekit-exploration/` (Python Scalekit patterns)
- LiveKit references (external, pin versions in plan execution):
  - Official Node/TS starter via `lk agent init --template agent-starter-node` (preferred)
  - Python starter only as fallback or for the MCP token script
  - https://docs.livekit.io/agents/start/voice-ai.md
  - https://docs.livekit.io/agents/server/agent-dispatch.md (metadata)
  - https://docs.livekit.io/agents/server/job.md (`ctx.job.metadata`)
  - https://docs.livekit.io/agents/logic/tools/definition.md (function tools / llm.tool)
  - https://docs.livekit.io/agents/logic/tools/mcp.md (MCP — only if easy)
  - LiveKit server SDK (Node) dispatch + AccessToken examples
  - `@livekit/components-react` usage

## Existing Functions & Utilities to Reuse (with Paths)

**Scalekit client & execution (core identity + authz layer — copy/adapt with minimal change):**
- `getScalekitClient()` singleton + env validation: `ecosystem/chargebee/lib/scalekit.ts:1-22` and `ecosystem/vapi-scalekit-voice-demo/app/api/vapi/webhook/route.ts:1-20`
- `scalekit.actions.executeTool({ connector, identifier, toolName, toolInput })`: `ecosystem/vapi-scalekit-voice-demo/app/api/vapi/webhook/route.ts:59-71` + `ecosystem/litellm-agentkit-inbox-triage/src/tools/agentkit.ts:1-12` (callTool helper)
- Tool listing: `scalekit.tools.listScopedTools(identifier, {filter})` + fallback `listAvailableTools`: `ecosystem/vapi-scalekit-voice-demo/app/api/debug/tools/route.ts:30-60` (full normalization logic too)
- MCP session token minting (REST + Python SDK): `ecosystem/vapi-scalekit-voice-demo/app/api/scalekit/mcp-session/route.ts:70-130` and `scripts/generate-mcp-token.py:59-70`

**Metadata / identifier passing pattern:**
- Vapi version: `vapi.start(id, { metadata: { scalekitConnectionId } })` + extract in webhook: `ecosystem/vapi-scalekit-voice-demo/app/page.tsx:62-75` and `webhook/route.ts:40-44`
- Will map to LiveKit dispatch `metadata: JSON.stringify({scalekitConnectionId: ...})` + `json.loads(ctx.job.metadata)` in agent (documented in LiveKit job.md)

**UI shell & state:**
- Transcript + connecting/active states, button: `ecosystem/vapi-scalekit-voice-demo/app/page.tsx:90-140`
- Layout/fonts: `app/layout.tsx` and `globals.css` in same dir (copy + retitle)

**Debug + helper endpoints:**
- `app/api/debug/tools/route.ts` (entire file — only change title/paths)
- MCP route (strip Vapi-specific response shaping)

**Scripts & docs style:**
- Token generators + their README: entire `ecosystem/vapi-scalekit-voice-demo/scripts/`
- Comprehensive README with "How the Code Works (Deep Dive)", architecture ASCII, troubleshooting table, "Why" at every step.
- PROGRESS.md tracking against llms.txt sources.

**Other conventions from workspace:**
- Next.js 16 + React 19 + Tailwind 4 + TypeScript (vapi demo + chargebee)
- Dark zinc UI aesthetic
- Detailed `.env.example` comments explaining production vs demo usage (copy from vapi-scalekit-voice-demo)
- Node/TS agent style where possible (align with preference for JS/TS oriented)

**Do not reinvent:**
- Scalekit SDK client creation or error handling.
- The "fresh token per test" discipline.
- The emphasis on `identifier` coming from authenticated context in real apps.
- MCP only if easy — default to direct executeTool.

## Implementation Phases (for Execution)

1. **Scaffold**
   - Create `ecosystem/livekit-scalekit-voice-demo/` as a **separate parallel directory** (copy structure from vapi demo as starting skeleton).
   - Copy `.env.example` from `ecosystem/vapi-scalekit-voice-demo` as the base, then extend with LIVEKIT vars.
   - Run `lk agent init ... --template agent-starter-node` (preferred) or Node/TS equivalent; adapt the agent code.
   - `npm init` / copy the Next.js part (strip Vapi deps).
   - Add all required deps (focus on Node/TS for agent).

2. **Scalekit + env foundation**
   - Port `getScalekitClient`, debug/tools route, .env.example (from vapi), scripts.
   - MCP session route only if MCP path is pursued.
   - Verify `/api/debug/tools` works with existing TEST_IDENTIFIER.

3. **LiveKit dispatch + token layer (Next.js API)**
   - Add `livekit-server-sdk`.
   - Implement route that accepts identifier, calls `agentDispatchClient.createDispatch(...)` with `metadata`, generates user `AccessToken`, returns join details.
   - Mint MCP token (using Python SDK in script) only if pursuing MCP path.
   - Add basic error handling and logging.

4. **Frontend connection**
   - Install LiveKit React bits.
   - Replace Vapi client with LiveKit Room connect using returned token.
   - Basic audio publish/subscribe, connect/disconnect states, transcript stub (later enhance with data messages or agent logs).
   - Pass identifier from env or future auth.

5. **Node/TS Agent core (primary)**
   - Adapt Node starter (`defineAgent`, `voice.AgentSession`).
   - Parse `ctx.job.metadata` for identifier.
   - Implement tools using `llm.tool` (Zod) that call `scalekit.actions.executeTool({ identifier, ... })` directly.
   - `session.start(...)` + generate reply.
   - Make agent name match the dispatch target.
   - Add MCPToolset only if easy and straightforward.

6. **MCP (optional, only if easy)**
   - If MCP path is straightforward for Node, wire dynamic token minting (Python script allowed for token gen).
   - Otherwise keep only the direct executeTool path.

7. **UI & UX parity / improvements**
   - Match transcript, status indicators.
   - Add "Try saying..." examples.
   - Optional: show tool calls in UI via data channel or simple logging.

8. **Docs & tracking**
   - Write full README modeled on vapi (include LiveKit CLI setup, `lk cloud auth`, dispatch flow diagram, agent console). Note preference for Node/TS and that MCP is optional.
   - PROGRESS.md with references to specific LiveKit pages + Scalekit (de-emphasize forced MCP).
   - scripts/README.md
   - .env.example (based on copy from vapi demo) with clear comments.

9. **Verification & iteration**
   - End-to-end test (see Critical Live Validation Points).
   - Update for any freshness (SDK versions).
   - Optional: add simple e2e or test script.

10. **Polish**
    - Error surfaces that agent can speak.
    - Connection status.
    - README "How This Was Built" deep dive section.
    - Consider adding to any top-level ecosystem index if one appears.

## Critical Live Validation Points (Real Keys Smoke Tests)

These are the highest-risk integration seams. The implementer (or you) **must** exercise them with real Scalekit + LiveKit Cloud credentials before declaring the core loop complete. Add temporary test endpoints or scripts during development.

1. **Metadata roundtrip (the identity contract)**:
   - In dispatch API: pass `{"scalekitConnectionId": "real-user@example.com", "extra": "foo"}`.
   - In agent entrypoint: `meta = json.loads(ctx.job.metadata)` asserts the exact value arrives.
   - Log `ctx.job.id`, `ctx.room.name`, worker info.
   - **Command to add temporarily**: `POST /api/_debug/dispatch` that does the createDispatch and prints the metadata it sent.

2. **LiveKit participant token + browser join**:
   - Generate AccessToken with correct grants + room.
   - Browser successfully joins as participant (use Agent Console or `lk` to inspect participants).
   - Agent is auto-dispatched and appears as participant.

3. **Direct function_tool + Scalekit executeTool inside agent process**:
   - Agent receives spoken request for calendar.
   - Inside `llm.tool` (or function tool), construct or reuse ScalekitClient, call `executeTool` using the `identifier` from metadata.
   - Confirm:
     - Tool name matches one from `/api/debug/tools` (e.g. `googlecalendar_list_events`).
     - Result (`.data`) is returned cleanly to the LLM context.
     - Assistant speaks a sensible summary.
   - Check Scalekit dashboard / logs for the call attributed to the identifier (no token leakage).

4. **MCPToolset + per-user Bearer token**:
   - Before dispatch, mint a real short-lived Scalekit MCP session token for the identifier (reuse Python script or the mcp-session route).
   - Pass token (or full server config) in dispatch metadata.
   - In agent: `MCPToolset( MCPServerHTTP( url, headers={"Authorization": f"Bearer {token}"} ) )`.
   - Agent discovers tools from the MCP server.
   - Same calendar query succeeds; confirm via LiveKit console that the MCP call happened and result was used.
   - Token expiry behavior: test a token older than 1h fails gracefully.

5. **Tool result → voice output latency & speakability**:
   - Measure rough time from user utterance → tool call → result spoken.
   - Ensure results are concise / formatted for voice (add a `tool_result_resolver` or post-processing in agent if needed).
   - Test with realistic data volume (calendar with 10+ events).

6. **Error propagation**:
   - Invalid identifier or inactive connection → agent receives error from executeTool / MCP and speaks a user-friendly message (no crash).
   - Missing LiveKit keys → clear startup error.
   - Dispatch failure → UI surfaces error.

7. **Multiple concurrent sessions**:
   - Quick test: two browser tabs with different identifiers → two rooms, correct data returned for each.

**Suggested artifacts to add during build for these tests**:
- Temporary `app/api/_debug/dispatch-test/route.ts` (protected or localhost-only).
- Python helper `scripts/validate-metadata.py` that can be run standalone against a room.
- Update PROGRESS.md with actual numbers from real runs (latency, success rate).
- In README: "Real key validation checklist" subsection.

Do these with real keys **before** writing the final README/PROGRESS.md polish. Mocked tests (like the litellm-agentkit-inbox-triage vitest) are useful for unit logic but insufficient for the cross-system seams here.

## Verification (End-to-End Testing)

1. **Setup**:
   - Copy `.env.example` → `.env.local`, fill real Scalekit (with active Google Calendar connection for TEST_IDENTIFIER), LiveKit Cloud project keys (from `lk cloud auth`).
   - `npm install`; start `npm run dev`.
   - In another shell: set up the Node agent (using `lk` or tsx), run agent in dev mode.
   - (ngrok or Cloud not strictly required for LiveKit Cloud dispatch, but useful for any other webhooks.)

2. **Basic voice loop**:
   - Open localhost, click Start. Browser should connect (LiveKit room created + agent dispatched automatically).
   - Speak naturally; agent should respond with voice (confirm via Agent Console or local).

3. **Run the Critical Live Validation Points above** (with real keys).

4. **Tool execution (core Scalekit integration)**:
   - Speak "List my calendar events this week".
   - Verify in logs:
     - Dispatch metadata received correctly in agent.
     - Scalekit tool invoked with correct `identifier`.
     - Result returned to agent and spoken.
   - Use `/api/debug/tools` beforehand to confirm exact tool names (e.g. `googlecalendar_list_events`).

5. **MCP path (if enabled)**:
   - Mint token (adapted script or `/api/scalekit/mcp-session`).
   - Configure agent with MCPToolset + headers.
   - Confirm tools auto-discovered and callable; same calendar query succeeds.

6. **Identity / security**:
   - Confirm changing TEST_IDENTIFIER changes whose data is returned.
   - No raw tokens visible in browser, agent logs (except the short-lived MCP one in controlled headers), or LLM context.
   - Metadata never derived from user speech.

7. **Error & edge**:
   - Bad identifier → clear error result spoken by agent.
   - No connection → graceful UI/agent fallback.
   - Disconnect / reconnect.

8. **Docs validation**:
   - Follow README steps from clean clone/env exactly; demo should work.
   - Check PROGRESS.md matches current LiveKit/Scalekit behavior (re-run against llms.txt if needed).

9. **Observability**:
   - Use LiveKit Agent Console + terminal logs.
   - Scalekit dashboard shows tool executions attributed to the identifier.

Success criteria: Identical user experience to Vapi demo ("voice that acts securely via Scalekit") achieved with LiveKit primitives, all "why" documented, patterns reusable for future voice integrations. Real-key critical points above have been exercised and results recorded.

## Trade-offs & Notes Considered

- **Node/TS agent vs Python agent**: Node/JS/TS preferred per feedback. Use Python SDK only for the MCP token generation script. Direct `executeTool` is primary; MCP added only if easy and straightforward.
- **Single Next.js vs split web+agent**: Split is necessary (and educational). Keep web minimal (like Vapi demo).
- **MCP vs direct executeTool**: Do not force MCP like in the Vapi demo. Primary path is direct function tools calling Scalekit `executeTool`. MCP is optional.
- **Room creation timing**: Prefer explicit dispatch from API (full control + metadata). Token-based dispatch is an alternative for room-creation time.
- **Transcript**: Start simple (UI log + agent console). Enhance later with published data messages or LiveKit transcription.
- **Not in scope for v1**: Full user login (SaaSKit), multi-connector, telephony/SIP, video, production hardening, tests beyond manual.
- **Future evolution** (document in README/PROGRESS): real session-derived identifiers, dynamic tool registration, agent handoffs, background tools, production deployment to LiveKit Cloud + Vercel.

## Key Implementation Sketches (Reference for Executor)

### Next.js Dispatch + Token Route (sketch)
```ts
// app/api/livekit/start/route.ts
import { AgentDispatchClient } from 'livekit-server-sdk';

export async function POST(req: Request) {
  const { identifier } = await req.json();

  const lk = new AgentDispatchClient(process.env.LIVEKIT_URL!, process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!);
  const roomName = `voice-${Date.now()}`;
  const metadata = JSON.stringify({ scalekitConnectionId: identifier });

  await lk.createDispatch(roomName, 'scalekit-voice-agent', { metadata });

  const at = new AccessToken(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!);
  at.addGrant({ roomJoin: true, room: roomName });
  const token = await at.toJwt();

  return Response.json({ roomName, token, url: process.env.LIVEKIT_URL });
}
```

### Node/TS Agent (primary - direct executeTool)
```ts
// agent/src/agent.ts
import { defineAgent, voice, llm } from '@livekit/agents';
import { ScalekitClient } from '@scalekit-sdk/node';
import { z } from 'zod';

export default defineAgent({
  entry: async (ctx: any) => {
    const metadata = JSON.parse(ctx.job.metadata || '{}');
    const identifier = metadata.scalekitConnectionId;

    const scalekit = new ScalekitClient(process.env.SCALEKIT_ENV_URL!, process.env.SCALEKIT_CLIENT_ID!, process.env.SCALEKIT_CLIENT_SECRET!);

    const session = new voice.AgentSession({ /* stt, llm, tts config */ });

    await session.start({
      agent: voice.Agent.create({
        instructions: "You are a helpful voice assistant that can act on the user's behalf using Scalekit tools.",
        tools: [
          llm.tool({
            name: 'googlecalendar_list_events',
            description: 'List upcoming events from the user\'s Google Calendar',
            parameters: z.object({ calendar_id: z.string().default('primary') }),
            execute: async ({ calendar_id }) => {
              const result = await scalekit.actions.executeTool({
                connector: 'googlecalendar',
                identifier,
                toolName: 'googlecalendar_list_events',
                toolInput: { calendar_id },
              });
              return (result as any).data ?? result;
            },
          }),
        ],
      }),
      room: ctx.room,
    });

    await session.generateReply({ instructions: 'Greet the user and offer help with their calendar or other connected tools.' });
  },
});
```

### MCP (optional - only if easy in Node)
If LiveKit's Node MCP support is straightforward, add a MCPToolset using a token minted via the Python script. Otherwise, the direct `executeTool` approach above is sufficient and preferred.

### Frontend Connect (sketch)
Use `<LiveKitRoom>`, `useTracks`, `RoomAudioRenderer` from `@livekit/components-react`. On "Start Voice Call": call your dispatch API → connect the room with the returned token.

## Open Questions for Clarification (if encountered during execution)

- Preferred agent name / dispatch name convention.
- Target LiveKit SDK / agents versions to pin.
- Any requirement to publish this as a standalone GitHub repo under scalekit-developers (like the vapi one).
- Whether to co-locate agent code under `agent/` or follow `lk` default structure.

---

**This plan is deep, evidence-based (drawn from reading vapi demo sources, other ecosystem Scalekit integrations, LiveKit dispatch/job/MCP docs, workspace conventions), and directly executable while maximizing reuse.**

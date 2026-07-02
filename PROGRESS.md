# LiveKit + Scalekit Integration Progress Tracker

**Goal**: integrate LiveKit Agents (real-time voice AI) with Scalekit AgentKit (secure, per-user authenticated tool calling to third-party services like Google Calendar) without exposing raw OAuth tokens to the LLM or the voice platform.

**Core value**: voice that can securely act on behalf of authenticated users, using Scalekit's connection management + tool execution, on top of LiveKit's open agent framework.

**Analog**: this project mirrors `ecosystem/vapi-scalekit-voice-demo/` — same identity contract (identifier via metadata, never a token), different voice platform.

**Last updated**: 2026-07-02.

---

## Current Implementation Status

**Location**: `ecosystem/livekit-scalekit-voice-demo/` — its own standalone git repo (not a submodule), to be published to GitHub under `scalekit-developers` as `livekit-scalekit-voice-demo`.

**Stack (versions actually installed)**:
- Next.js `^16.2.10`, React / React-DOM `^19.2.7`, TypeScript `^6.0.3`
- `@livekit/agents` `^1.4.11` (agent worker)
- `livekit-client` `^2.20.0`, `livekit-server-sdk` `^2.16.0`, `@livekit/components-react` `^2.9.21` (web app)
- `@scalekit-sdk/node` `^2.6.3`
- `zod` `^4.4.3`
- `eslint` `^9.39.4` (pinned down from `^10.x` — see Gaps below)

**Built and committed (milestone by milestone)**:

1. **Scaffold** — Next.js 16 + React 19 + TS app created; `plan.md` written (gitignored, internal-only, not part of the public repo).
2. **Scalekit client + debug route** — `lib/scalekit.ts` (Next.js-runtime `ScalekitClient` singleton), `app/api/debug/tools/route.ts` (ported from the Vapi sibling: `listScopedTools` with fallback to `listAvailableTools`, normalized tool shape), `app/layout.tsx` (dark zinc + Geist shell, retitled "LiveKit + Scalekit").
3. **LiveKit dispatch + token route** — `app/api/livekit/start/route.ts`: `AgentDispatchClient.createDispatch(roomName, 'scalekit-voice-agent', { metadata })` where `metadata = JSON.stringify({ scalekitConnectionId: identifier })`, plus a participant `AccessToken` with a `roomJoin` grant.
4. **Frontend voice UI** — `app/page.tsx`: `Room` + `<LiveKitRoom>` / `<RoomAudioRenderer>` from `@livekit/components-react`, idle/connecting/active state, connection-lifecycle log panel, troubleshooting bullets, example phrases.
5. **Example-prompt fix** — replaced mismatched multi-connector example prompts with calendar-only examples, since the agent currently registers only one tool.
6. *(Deliberately skipped — see below.)*
7. **Agent worker** — `agent/src/agent.ts`: standalone Node process. Parses `ctx.job.metadata` for the Scalekit identifier, registers a `googlecalendar_list_events` function tool that calls `scalekit.actions.executeTool(...)` directly, builds `voice.Agent` + `voice.AgentSession` (LiveKit Inference: `openai/gpt-4o-mini` LLM, `assemblyai/universal-streaming` STT, `cartesia/sonic-2` TTS), self-starts via `cli.runApp(...)`.
8. **eslint fix** — pinned `eslint` to `^9.39.4` after a fresh `npm install` resolved `^10.x`, which crashed under `eslint-config-next`'s bundled `eslint-plugin-react` (removed `context.getFilename()` API). `npm run lint` is clean as of the current commit.
9. **Docs** (this task) — `README.md` + `PROGRESS.md`.

**Verification performed for every task above**: `npm run typecheck`, `npm run lint`, `npm run build`, and manual reading of the installed SDK's `.d.ts` files to confirm API shapes. No task has been verified against live LiveKit Cloud or live Scalekit credentials.

---

## Task 6: MCP — Investigated and Skipped (Documented Finding, Not a Gap)

The original plan called for adding LiveKit's `MCPToolset` / MCP-based tool discovery as an optional evolution beyond direct `executeTool` calls, if it turned out to be easy for the Node SDK.

**Finding**: it isn't available. `@livekit/agents@1.4.11`'s installed type declarations were checked directly — there is no MCP client/toolset surface in this version of the Node SDK. This is a version-specific limitation of the currently-installed package, not a design gap in this project. Direct `executeTool` calls from a `llm.tool()` function tool is the correct and only path available for authenticated tool calling in this SDK version, and that's what `agent/src/agent.ts` does.

Task 6 (which would have produced standalone MCP credential/token-minting scripts, mirroring the Vapi sibling's `scripts/generate-mcp-token.{py,js}`) was skipped as a direct consequence — there was nothing for those scripts to support. The `scripts/` directory exists but is currently empty. Revisit this once a newer `@livekit/agents` release adds MCP client support (see Next Steps).

---

## Gaps & Observations

**The most important caveat in this project**: **nothing has been run with real credentials.** This entire build — every task, including the agent worker and the dispatch route — was done without a real LiveKit Cloud project, live Scalekit credentials, or the `lk` CLI installed. Every verification was static:
- `npm run typecheck` / `npm run lint` / `npm run build` passing.
- Manual reading of the actual installed `@livekit/agents`, `livekit-server-sdk`, `livekit-client`, and `@scalekit-sdk/node` type declarations to confirm the API calls used (`voice.Agent`, `voice.AgentSession`, `llm.tool`, `AgentDispatchClient.createDispatch`, `AccessToken`, `scalekit.actions.executeTool`, `scalekit.tools.listScopedTools`) are real, correctly shaped, and match the installed version — not the plan's initial (partly incorrect) sketch.

Nothing here has been exercised against a live voice call, a live LiveKit room, or a live Scalekit connection. `plan.md`'s "Critical Live Validation Points" (metadata roundtrip, browser join + agent dispatch, live tool call, error path, multiple concurrent sessions) and its end-to-end "Verification" checklist have **not** been run. `README.md`'s "Real-Key Validation Checklist" is the actionable version of that same list — a human with real LiveKit Cloud + Scalekit credentials needs to walk through it before this demo is considered validated, not just statically type-checked.

**Other observations**:

- The checked-in `.env.example` was copied from the Vapi sibling demo as a starting point (per the original plan) and was never fully trimmed — it still carries Vapi-specific vars (`NEXT_PUBLIC_VAPI_PUBLIC_KEY`, `VAPI_PRIVATE_KEY`) and MCP-config vars (`SCALEKIT_MCP_CONFIG_ID`, `NEXT_PUBLIC_SCALEKIT_MCP_SERVER_URL`) that nothing in this project's code reads. This is noted as a gotcha in `README.md`'s troubleshooting table rather than fixed here, since cleaning it up is outside this task's scope (docs only) — a future task should trim it to the eight vars this project actually uses.
- The transcript panel in `app/page.tsx` only logs room-lifecycle events (participant joined/left, connected, errors) — there is no real spoken-transcript or data-channel wiring yet.
- Only one function tool exists (`googlecalendar_list_events`); the identity-contract pattern generalizes to more Scalekit-backed tools, but nothing beyond calendar has been wired up or asked for.
- `TEST_IDENTIFIER` / `NEXT_PUBLIC_TEST_SCALEKIT_CONNECTION_ID` are demo-only stand-ins for a real authenticated-user identifier.

---

## Next Steps (Prioritized)

1. **Real-key validation** (highest priority, blocking "done"): a human with a real LiveKit Cloud project and live Scalekit credentials should run through `README.md`'s Real-Key Validation Checklist and record actual results here (this file currently has none, on purpose — no fabricated "tested successfully" claims).
2. **Trim `.env.example`**: remove the stale Vapi/MCP vars that nothing in this codebase reads (see Gaps above).
3. **Real user auth flow**: replace `TEST_IDENTIFIER` + the static `NEXT_PUBLIC_TEST_SCALEKIT_CONNECTION_ID` with an identifier derived from an authenticated user's session.
4. **MCP migration**, once `@livekit/agents` ships MCP client support for Node — re-check the installed version's type declarations periodically; this is a "when the SDK catches up," not a "when we get around to it," item.
5. **Multi-connector demo**: extend beyond `googlecalendar_list_events` to demonstrate the pattern generalizes (e.g. Gmail, Slack).
6. **Real transcript / data-channel wiring**: replace the room-lifecycle log with actual spoken transcript text.
7. **Telephony**: LiveKit supports SIP; this demo currently only wires up the browser/WebRTC path.
8. **Publish**: push this repo to GitHub under `scalekit-developers` as `livekit-scalekit-voice-demo`, matching the Vapi sibling.

---

## How to Continue Development

```bash
cd livekit-scalekit-voice-demo
npm install
cp .env.example .env.local   # fill Scalekit + LiveKit Cloud keys (ignore stale Vapi/MCP vars — see Gaps)

# Terminal 1
npm run dev

# Terminal 2
npm run dev:agent
```

Debug tool listing: `http://localhost:3000/api/debug/tools`

**References used during this build**:
- `@livekit/agents@1.4.11` installed type declarations (source of truth over the plan's initial sketch — see README's "How This Was Built" for the two places the sketch was wrong).
- `ecosystem/vapi-scalekit-voice-demo/` (structural and pattern precedent: identity contract via metadata, debug/tools route, README/PROGRESS style).
- `plan.md` in this repo (internal, gitignored) for the original scope, phased plan, and the Critical Live Validation Points / Verification checklist that still needs to be run with real credentials.

---

**Status summary (as of this run)**:
- **Core loop (dispatch → agent → executeTool → spoken result)**: built, statically verified (typecheck/lint/build + SDK type-reading). **Not** verified against live LiveKit Cloud or live Scalekit credentials.
- **MCP**: investigated, confirmed unavailable in the installed SDK version, documented — not a placeholder gap.
- **Docs**: this task. Both files state the untested-with-real-keys caveat plainly rather than implying end-to-end success.
- **Overall**: a complete, statically-verified reference implementation of the identity-contract pattern for LiveKit + Scalekit. Real-key validation is the single remaining step before calling this demo "done."

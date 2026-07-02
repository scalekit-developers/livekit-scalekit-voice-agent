import { ScalekitClient } from '@scalekit-sdk/node';
import {
  cli,
  defineAgent,
  llm,
  ServerOptions,
  voice,
  type JobContext,
} from '@livekit/agents';
import { z } from 'zod';

/**
 * Standalone Scalekit client for this LiveKit worker process.
 *
 * This intentionally does NOT reuse `lib/scalekit.ts` — that singleton is scoped
 * to the Next.js runtime. The worker is a separate `tsx`/Node process, so it needs
 * its own module-level client built from the same three env vars.
 */
let scalekitClient: ScalekitClient | null = null;

function getScalekit(): ScalekitClient {
  if (!scalekitClient) {
    const envUrl = process.env.SCALEKIT_ENV_URL;
    const clientId = process.env.SCALEKIT_CLIENT_ID;
    const clientSecret = process.env.SCALEKIT_CLIENT_SECRET;

    if (!envUrl || !clientId || !clientSecret) {
      throw new Error(
        'Missing SCALEKIT_ENV_URL, SCALEKIT_CLIENT_ID or SCALEKIT_CLIENT_SECRET. ' +
          'Set them in .env.local (server-side only).'
      );
    }
    scalekitClient = new ScalekitClient(envUrl, clientId, clientSecret);
  }
  return scalekitClient;
}

const entry = async (ctx: JobContext): Promise<void> => {
  // Connect to the room as early as possible (per JobContext.connect docs).
  await ctx.connect();

  // Task 3 dispatches with a JSON metadata string; recover the Scalekit identifier
  // that scopes every tool call to a specific connected account.
  const metadata = JSON.parse(ctx.job.metadata || '{}') as {
    scalekitConnectionId?: string;
  };
  const identifier =
    metadata.scalekitConnectionId ||
    process.env.TEST_IDENTIFIER ||
    'demo-connection';

  // Metadata roundtrip validation point: these logs let a human confirm that the
  // dispatch metadata actually reached the agent.
  console.log(
    `[scalekit-voice-agent] job=${ctx.job.id} room=${ctx.room.name} identifier=${identifier}`
  );

  // Direct executeTool bridge (no MCP): call the Scalekit AgentKit tool on behalf
  // of the connected account identified above. Call shape mirrors the vapi demo's
  // webhook route, which is the source of truth for this call in this codebase.
  const googlecalendar_list_events = llm.tool({
    description:
      "List events from the user's Google Calendar via Scalekit. Use this whenever " +
      'the user asks about their calendar, schedule, meetings, or upcoming events.',
    parameters: z.object({
      calendar_id: z
        .string()
        .optional()
        .describe("Calendar to read from. Defaults to 'primary'."),
    }),
    execute: async ({ calendar_id }) => {
      const scalekit = getScalekit();
      const result = await scalekit.actions.executeTool({
        connector: 'googlecalendar',
        identifier,
        toolName: 'googlecalendar_list_events',
        toolInput: { calendar_id: calendar_id ?? 'primary' },
      });
      // executeTool surfaces the tool payload under `.data`; fall back to the full
      // response so the LLM still gets something if the shape ever changes.
      return result.data ?? result;
    },
  });

  const agent = new voice.Agent({
    instructions:
      'You are a helpful voice assistant. You can check the user\'s Google Calendar ' +
      'through Scalekit using the googlecalendar_list_events tool. Keep your replies ' +
      'short and conversational, since they are spoken aloud.',
    tools: { googlecalendar_list_events },
  });

  // LiveKit Inference model strings route STT/LLM/TTS through the LiveKit Cloud
  // gateway billed to the LiveKit project — no separate provider API keys needed.
  const session = new voice.AgentSession({
    llm: 'openai/gpt-4o-mini',
    stt: 'assemblyai/universal-streaming',
    tts: 'cartesia/sonic-2',
  });

  await session.start({ agent, room: ctx.room });
  await session.generateReply({
    instructions: 'Greet the user and offer to help with their calendar.',
  });
};

export default defineAgent({ entry });

// `agentName` must match Task 3's explicit dispatch target so LiveKit routes those
// jobs to this worker. LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET are read
// from the environment automatically when not passed explicitly.
cli.runApp(
  new ServerOptions({
    agent: import.meta.filename,
    agentName: 'scalekit-voice-agent',
  })
);

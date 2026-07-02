import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { AccessToken, AgentDispatchClient } from 'livekit-server-sdk';

const AGENT_NAME = 'scalekit-voice-agent';

export async function POST(req: Request) {
  const livekitUrl = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!livekitUrl || !apiKey || !apiSecret) {
    console.error('[livekit/start] Missing LIVEKIT_URL, LIVEKIT_API_KEY or LIVEKIT_API_SECRET');
    return NextResponse.json(
      {
        error: 'Missing LIVEKIT_URL, LIVEKIT_API_KEY or LIVEKIT_API_SECRET.',
        hint: 'Set them in .env.local (from your LiveKit Cloud project) and restart the server.',
      },
      { status: 500 }
    );
  }

  let body: { identifier?: string } = {};
  try {
    body = await req.json();
  } catch {
    // No/invalid JSON body is fine — fall back to the default identifier below.
  }

  const identifier = body.identifier || process.env.TEST_IDENTIFIER || 'demo-connection';
  const roomName = `voice-${randomUUID()}`;
  const metadata = JSON.stringify({ scalekitConnectionId: identifier });

  console.log('[livekit/start] Received request', { identifier, roomName });

  try {
    const dispatchClient = new AgentDispatchClient(livekitUrl, apiKey, apiSecret);
    console.log('[livekit/start] Dispatching agent', { agentName: AGENT_NAME, roomName, metadata });
    await dispatchClient.createDispatch(roomName, AGENT_NAME, { metadata });

    const at = new AccessToken(apiKey, apiSecret, { identity: `user-${randomUUID()}` });
    at.addGrant({ roomJoin: true, room: roomName });
    const token = await at.toJwt();
    console.log('[livekit/start] Token minted', { roomName, identity: at.identity });

    return NextResponse.json({ roomName, token, url: livekitUrl, identifier });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[livekit/start] Dispatch/token error:', e);
    return NextResponse.json(
      {
        error: message,
        hint: 'Check LIVEKIT_URL/LIVEKIT_API_KEY/LIVEKIT_API_SECRET in .env.local and that the LiveKit Cloud project is reachable.',
      },
      { status: 500 }
    );
  }
}

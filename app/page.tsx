'use client';

import { useEffect, useState } from 'react';
import { LiveKitRoom, RoomAudioRenderer } from '@livekit/components-react';
import { DisconnectReason, Room, RoomEvent } from 'livekit-client';

type CallStatus = 'idle' | 'connecting' | 'active';

export default function LiveKitScalekitDemo() {
  const [room] = useState(() => new Room());
  const [status, setStatus] = useState<CallStatus>('idle');
  const [connectionDetails, setConnectionDetails] = useState<{ url: string; token: string } | null>(null);
  const [transcript, setTranscript] = useState<string[]>([]);

  const isConnecting = status === 'connecting';
  const isCallActive = status === 'active';

  // Room-level lifecycle logging (real transcription/data-message wiring is a later task).
  useEffect(() => {
    const onParticipantConnected = (participant: { identity: string }) => {
      setTranscript((prev) => [...prev, `→ ${participant.identity} joined the room.`]);
    };
    const onParticipantDisconnected = (participant: { identity: string }) => {
      setTranscript((prev) => [...prev, `→ ${participant.identity} left the room.`]);
    };

    room.on(RoomEvent.ParticipantConnected, onParticipantConnected);
    room.on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);

    return () => {
      room.off(RoomEvent.ParticipantConnected, onParticipantConnected);
      room.off(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
    };
  }, [room]);

  const startCall = async () => {
    const identifier = process.env.NEXT_PUBLIC_TEST_SCALEKIT_CONNECTION_ID || 'demo-connection';

    setStatus('connecting');
    setTranscript(['Connecting to LiveKit room...']);

    try {
      const res = await fetch('/api/livekit/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || 'Failed to start the call.');
      }

      setConnectionDetails({ url: data.url, token: data.token });
    } catch (e: unknown) {
      console.error('Failed to start LiveKit call:', e);
      const message = e instanceof Error ? e.message : 'Connection failed (check console and server logs)';
      setStatus('idle');
      setTranscript((prev) => [...prev, `❌ Error: ${message}`]);
    }
  };

  const endCall = () => {
    room.disconnect();
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-8 font-sans">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-4xl font-semibold tracking-tighter">LiveKit + Scalekit</h1>
            <p className="text-zinc-400">Voice that can act on your behalf via authenticated tools.</p>
          </div>
          <div className="flex items-center gap-3">
            {isConnecting && (
              <div className="flex items-center gap-2 text-yellow-400 text-sm">
                <div className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse" />
                Connecting...
              </div>
            )}
            {isCallActive && (
              <div className="flex items-center gap-2 text-green-400 text-sm">
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                Connected
              </div>
            )}
            <button
              onClick={isCallActive || isConnecting ? endCall : startCall}
              disabled={isConnecting}
              className={`px-5 py-2 rounded-full text-sm font-medium transition disabled:opacity-50 ${
                isCallActive ? 'bg-red-600' : 'bg-white text-black'
              }`}
            >
              {isConnecting ? 'Connecting...' : isCallActive ? 'End Call' : 'Start Voice Call'}
            </button>
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 min-h-[320px] font-mono text-sm overflow-auto">
          {transcript.length === 0 && !isConnecting && (
            <div className="text-zinc-500">Transcript will appear here once the call starts...</div>
          )}
          {transcript.map((line, idx) => (
            <div key={idx} className="py-0.5">{line}</div>
          ))}
        </div>

        <div className="mt-6 text-xs text-zinc-500 space-y-1 leading-relaxed">
          <div>• Make sure <code>LIVEKIT_URL</code>, <code>LIVEKIT_API_KEY</code>, and <code>LIVEKIT_API_SECRET</code> are set (from your LiveKit Cloud project) in <code>.env.local</code>.</div>
          <div>• Make sure the voice agent worker is running (<code>npm run dev:agent</code>) so it can join the room after dispatch.</div>
          <div>• <code>NEXT_PUBLIC_TEST_SCALEKIT_CONNECTION_ID</code> tells Scalekit which user&apos;s connections to use — it must match an active connection&apos;s identifier.</div>
          <div>• Tool names must match tools the voice agent registers and tools available in Scalekit AgentKit.</div>
          <div>• Watch the browser console and the Next.js server logs for connection errors.</div>
        </div>

        <div className="mt-4 text-[10px] text-zinc-400">
          <span className="font-medium text-zinc-300">Try saying (examples):</span> &quot;What&apos;s on my calendar?&quot;, &quot;Find emails from Acme&quot;, &quot;Summarize #product on Slack&quot;, &quot;Show my open PRs&quot;, &quot;Find the roadmap doc and email it&quot;
        </div>
      </div>

      {connectionDetails && (
        <LiveKitRoom
          room={room}
          serverUrl={connectionDetails.url}
          token={connectionDetails.token}
          connect
          audio
          onConnected={() => {
            setStatus('active');
            setTranscript((prev) => [...prev, '✅ Connected — agent should join shortly. Speak to trigger a tool.']);
          }}
          onDisconnected={(reason?: DisconnectReason) => {
            setStatus('idle');
            setConnectionDetails(null);
            const reasonLabel = reason !== undefined ? ` (${DisconnectReason[reason]})` : '';
            setTranscript((prev) => [...prev, `Call ended.${reasonLabel}`]);
          }}
          onError={(error: Error) => {
            console.error('LiveKit connection error:', error);
            setStatus('idle');
            setConnectionDetails(null);
            setTranscript((prev) => [...prev, `❌ Error: ${error.message}`]);
          }}
        >
          <RoomAudioRenderer />
        </LiveKitRoom>
      )}
    </div>
  );
}

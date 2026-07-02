import { NextResponse } from 'next/server';
import { getScalekitClient } from '@/lib/scalekit';

export async function GET() {
  const identifier =
    process.env.TEST_IDENTIFIER ||
    process.env.NEXT_PUBLIC_TEST_SCALEKIT_CONNECTION_ID ||
    'demo';

  try {
    let scopedTools: unknown[] = [];
    let source = 'none';

    const scalekit = getScalekitClient();

    // listScopedTools is the right call for tools already available to this identifier.
    // It requires a filter (providers/toolNames/connectionNames).
    // We pass a plain object; the SDK internally creates the protobuf message.
    try {
      const filter = {
        providers: [],
        toolNames: [],
        connectionNames: [],
      };
      // Cast to satisfy the strict MessageInitShape while keeping the file free of internal pb imports
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await scalekit.tools.listScopedTools(identifier, { filter } as any);
      scopedTools = (res as { tools?: unknown[] }).tools ?? [];
      source = 'listScopedTools';
    } catch (scopedErr) {
      console.warn('[debug/tools] listScopedTools failed (may need active connection):', scopedErr);
    }

    // Fallback / supplement with listAvailableTools (no filter required).
    let availableTools: unknown[] = [];
    if (scopedTools.length === 0) {
      try {
        const res = await scalekit.tools.listAvailableTools(identifier);
        availableTools = (res as { tools?: unknown[] }).tools ?? [];
        source = source === 'none' ? 'listAvailableTools' : `${source}+listAvailableTools`;
      } catch (availErr) {
        console.warn('[debug/tools] listAvailableTools failed:', availErr);
      }
    }

    const tools = scopedTools.length > 0 ? scopedTools : availableTools;

    // Tool definitions are often wrapped:
    // ScopedTool { tool: Tool, identifier, connectedAccountId }
    // Tool { id, provider, definition: {name, description, ...} (Struct), metadata, ... }
    const normalized = tools.map((entry: unknown) => {
      const scoped = entry as { tool?: Record<string, unknown>; identifier?: string; connectedAccountId?: string };
      const t = (scoped.tool ?? entry) as Record<string, unknown>;
      const def = (t.definition ?? {}) as Record<string, unknown>;

      // Common places the callable tool name lives
      const name =
        (t.name as string) ||
        (t.toolName as string) ||
        (def.name as string) ||
        (def.function as Record<string, unknown>)?.name as string ||
        'unknown-tool';

      const description =
        (t.description as string) ||
        (def.description as string) ||
        ((def.function as Record<string, unknown>)?.description as string) ||
        '';

      return {
        name,
        description,
        provider: (t.provider as string) || '',
        connectedAccountId: scoped.connectedAccountId || '',
        // Convenience value you can copy in as the toolName when calling executeTool
        suggestedToolName: name,
      };
    });

    return NextResponse.json({
      identifier,
      source,
      count: normalized.length,
      tools: normalized,
      // Always include raw so you can see the exact structure from Scalekit
      raw: tools,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('List tools error:', e);
    return NextResponse.json(
      {
        error: message,
        identifier,
        hint: 'Set SCALEKIT_* env vars. Make sure TEST_IDENTIFIER matches an ACTIVE connection in the Scalekit AgentKit dashboard. Visit /api/debug/tools after starting the server.',
      },
      { status: 500 }
    );
  }
}

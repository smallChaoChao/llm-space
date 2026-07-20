import type { AgentEvent, AgentStreamRequest } from "@llm-space/core";
import { describe, expect, test } from "bun:test";

import { RemoteRuntimeClient } from "./remote-runtime-client";

const HEALTH_BODY = {
  ok: true,
  version: "4.2.0",
  protocolVersion: 1,
  capabilities: ["filesystem"],
  homePath: "/tmp/remote",
  workspacePath: "/tmp/remote/workspace",
  platform: { os: "linux", arch: "x64" },
};

describe("RemoteRuntimeClient", () => {
  test("connects with bearer auth and exposes remote info", async () => {
    const requests: Request[] = [];
    await _withFetch(
      (request) => {
        requests.push(request);
        return Response.json(HEALTH_BODY);
      },
      async () => {
        const client = new RemoteRuntimeClient({
          id: "remote:test",
          name: "Test Remote",
          baseUrl: "http://remote.test/",
          token: "secret",
        });
        await client.connect();
        expect(client.info()).toEqual({
          id: "remote:test",
          kind: "remote",
          name: "Test Remote",
          status: "connected",
          capabilities: ["filesystem"],
        });
      }
    );

    expect(requests[0].url).toBe("http://remote.test/health");
    expect(requests[0].headers.get("authorization")).toBe("Bearer secret");
  });

  test("posts runtime RPC envelopes and unwraps results", async () => {
    let body: unknown;
    await _withFetch(
      async (request) => {
        body = await request.json();
        return Response.json({ id: "1", ok: true, result: [] });
      },
      async () => {
        const client = new RemoteRuntimeClient({
          id: "remote:test",
          name: "Test Remote",
          baseUrl: "http://remote.test",
          token: "secret",
        });
        expect(await client.availableModels()).toEqual([]);
      }
    );

    expect(body).toMatchObject({ method: "models.available" });
  });

  test("throws on runtime RPC errors", async () => {
    await _withFetch(
      () =>
        Response.json({
          id: "1",
          ok: false,
          error: { code: "boom", message: "Remote failed" },
        }),
      async () => {
        const client = new RemoteRuntimeClient({
          id: "remote:test",
          name: "Test Remote",
          baseUrl: "http://remote.test",
          token: "secret",
        });
        let rejection: unknown;
        try {
          await client.availableModels();
        } catch (error) {
          rejection = error;
        }
        expect(rejection).toBeInstanceOf(Error);
        expect((rejection as Error).message).toBe("Remote failed");
      }
    );
  });

  test("parses SSE stream events", async () => {
    const events: AgentEvent[] = [];
    await _withFetch(
      () => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const encoder = new TextEncoder();
            controller.enqueue(encoder.encode("data: [START]\n\n"));
            controller.enqueue(
              encoder.encode('data: {"type":"agent_start"}\n\n')
            );
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        });
        return new Response(stream, {
          headers: { "Content-Type": "text/event-stream" },
        });
      },
      async () => {
        const client = new RemoteRuntimeClient({
          id: "remote:test",
          name: "Test Remote",
          baseUrl: "http://remote.test",
          token: "secret",
        });
        await client.streamThread(
          { streamId: "s1", request: {} as AgentStreamRequest },
          (message) => {
            if (message.type === "event") {
              events.push(message.event);
            }
          }
        );
      }
    );

    expect(events).toEqual([{ type: "agent_start" }]);
  });
});

async function _withFetch(
  handler: (request: Request) => Response | Promise<Response>,
  run: () => Promise<void>
): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = ((input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    return handler(request);
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}

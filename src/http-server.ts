/** Minimal zero-dependency node:http adapter for a fetch-compatible Hono
 *  app. Keeps the server dependency-free (usable in sandboxes and the
 *  "scale to zero" story) while still answering real HTTP clients. */

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Hono } from "hono";

export interface RunningServer {
  port: number;
  host: string;
  close(): Promise<void>;
}

export async function attachHttp(app: Hono, port = 3001, host = "127.0.0.1"): Promise<RunningServer> {
  const server = createServer(async (req, res) => {
    try {
      const headers = new Headers();
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const key = req.rawHeaders[i];
        const value = req.rawHeaders[i + 1];
        if (key && value) headers.append(key, value);
      }
      headers.delete("content-length"); // recomputed from the body we read

      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = Buffer.concat(chunks);

      const url = new URL(req.url || "/", `http://${req.headers.host || `localhost:${port}`}`);
      const request = new Request(url, {
        method: req.method || "GET",
        headers,
        body: body.length ? new Uint8Array(body) : undefined,
      });

      const response = await app.request(request);
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      const text = await response.text();
      res.end(text);
    } catch (err: any) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ code: "PGRST000", message: "Internal server error", details: String(err?.message || err), hint: null }));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });

  const addr = server.address() as AddressInfo;
  return {
    port: addr.port,
    host,
    close: () =>
      new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** A `fetch`-compatible function bound to a Hono app — used by tests and
 *  by tools that speak the native fetch API. */
export function fetchApp(app: Hono): typeof fetch {
  return ((input: any, init?: any) => {
    const req = toRequest(input, init);
    return app.request(req);
  }) as typeof fetch;
}

function toRequest(input: any, init?: any): Request {
  if (input instanceof Request) return input;
  const url = input instanceof URL ? input : new URL(String(input), "http://localhost");
  const body = init?.body;
  const headers = new Headers(init?.headers || {});
  const hasBody = body !== undefined && body !== null;
  if (hasBody && typeof body === "object" && !(body instanceof FormData) && !(body instanceof ReadableStream) && !(body instanceof Blob)) {
    headers.set("Content-Type", headers.get("Content-Type") ?? "application/json");
  }
  return new Request(url, {
    method: init?.method ?? "GET",
    headers,
    body: hasBody ? body : undefined,
    credentials: init?.credentials ?? "same-origin",
  });
}
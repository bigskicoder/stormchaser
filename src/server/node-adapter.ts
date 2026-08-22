/**
 * Web Request <-> Node req/res adapter so the Express 5 app
 * (src/server/express-app.ts) can be mounted inside a Next.js App Router
 * Route Handler, which speaks the Web Fetch API rather than Node's
 * http.IncomingMessage/ServerResponse.
 *
 * Uses node-mocks-http rather than a hand-rolled net.Socket-backed
 * IncomingMessage/ServerResponse: an early version of this adapter built
 * req/res directly against `new net.Socket()`, and Node's http internals
 * (corking/uncorking against a socket that's never actually connected to
 * anything) made every response hang for several seconds to over a minute
 * before finally resolving — reproduced locally via `next dev` + curl.
 * node-mocks-http's mock response has no real socket underneath, which
 * resolves immediately — but by default it also wires up a no-op
 * EventEmitter stub (see node_modules/node-mocks-http/lib/mockEventEmitter.js:
 * every method, including `on`/`emit`, is `() => {}`). Its own README
 * documents this: you must explicitly pass Node's real `events.EventEmitter`
 * via the `eventEmitter` option to get working `res.on('end', ...)`
 * notifications, which is exactly what this adapter needs to know when the
 * Express app finished responding.
 */

import { EventEmitter } from "node:events";
import httpMocks from "node-mocks-http";
import type express from "express";

export async function runExpressHandler(app: express.Express, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const bodyBuffer =
    request.method !== "GET" && request.method !== "HEAD" ? Buffer.from(await request.arrayBuffer()) : Buffer.alloc(0);

  const headers = Object.fromEntries(request.headers.entries());
  const contentType = headers["content-type"] ?? "";
  let body: unknown = undefined;
  if (bodyBuffer.length > 0) {
    body = contentType.includes("application/json") ? safeJsonParse(bodyBuffer.toString("utf-8")) : bodyBuffer.toString("utf-8");
  }

  const nodeReq = httpMocks.createRequest({
    method: request.method as httpMocks.RequestMethod,
    url: url.pathname + url.search,
    headers,
    body: body as httpMocks.Body,
    eventEmitter: EventEmitter,
  });
  const nodeRes = httpMocks.createResponse({ eventEmitter: EventEmitter });

  return new Promise<Response>((resolve) => {
    nodeRes.on("end", () => {
      const responseHeaders = new Headers();
      const raw = nodeRes.getHeaders();
      for (const [key, value] of Object.entries(raw)) {
        if (value == null) continue;
        responseHeaders.set(key, Array.isArray(value) ? value.join(", ") : String(value));
      }
      const data = nodeRes._getData();
      resolve(
        new Response(data, {
          status: nodeRes.statusCode,
          headers: responseHeaders,
        })
      );
    });

    app(nodeReq, nodeRes);
  });
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

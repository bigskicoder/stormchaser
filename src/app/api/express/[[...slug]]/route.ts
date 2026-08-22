import { expressApp } from "@/server/express-app";
import { runExpressHandler } from "@/server/node-adapter";

export const runtime = "nodejs";

async function handle(request: Request): Promise<Response> {
  return runExpressHandler(expressApp, request);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;

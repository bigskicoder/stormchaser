/**
 * Meta Instagram Graph API client (BUILD_PRIMER section 3/8). Single-account
 * use via a development-mode app + Instagram Tester role — no App Review,
 * no multi-tenant OAuth flow. Two-call publish flow per section 3:
 *   1. POST /{ig-user-id}/media          (create container)
 *   2. POST /{ig-user-id}/media_publish  (publish container)
 *
 * VERIFIED this session via WebSearch (graph.facebook.com/graph.instagram.com
 * themselves aren't reachable from this sandbox for a live check, but
 * multiple current sources converged on the same shape): the two-call
 * parameter names (`image_url`, `caption` on step 1; `creation_id` on step
 * 2) are confirmed correct as originally built.
 *
 * TWO THINGS FIXED:
 * 1. API version — this originally hardcoded v21.0, which by now (per the
 *    same search results, referencing v26.0 as current) is likely close to
 *    or past Meta's ~2-year deprecation window. Made configurable via
 *    IG_GRAPH_API_VERSION so a future bump doesn't need a code change.
 * 2. Base domain ambiguity — search results show examples on BOTH
 *    graph.facebook.com (the classic Instagram Graph API, used via a
 *    Facebook-connected Business/Creator account — this is what "Tester
 *    role" and "development-mode app" in the primer's own wording map to)
 *    and graph.instagram.com (a newer, separate "Instagram API with
 *    Instagram Login" product that doesn't go through a Facebook App at
 *    all). Kept graph.facebook.com as the default since it matches the
 *    primer's described setup, but this is a real fork in Meta's current
 *    product line — confirm which one your actual app setup uses once
 *    it's created, via IG_GRAPH_API_BASE_URL if it turns out to be the
 *    other one.
 */

const GRAPH_API_BASE_URL = process.env.IG_GRAPH_API_BASE_URL ?? "https://graph.facebook.com";
const GRAPH_API_VERSION = process.env.IG_GRAPH_API_VERSION ?? "v23.0";
const GRAPH_API_BASE = `${GRAPH_API_BASE_URL}/${GRAPH_API_VERSION}`;

interface CreateContainerResponse {
  id: string;
}

interface PublishResponse {
  id: string;
}

export async function createMediaContainer(params: { imageUrl: string; caption: string }): Promise<string> {
  const igUserId = process.env.IG_USER_ID;
  const accessToken = process.env.IG_ACCESS_TOKEN;
  if (!igUserId || !accessToken) throw new Error("Missing IG_USER_ID or IG_ACCESS_TOKEN env vars");

  const url = new URL(`${GRAPH_API_BASE}/${igUserId}/media`);
  url.searchParams.set("image_url", params.imageUrl);
  url.searchParams.set("caption", params.caption);
  url.searchParams.set("access_token", accessToken);

  const res = await fetch(url.toString(), { method: "POST" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Instagram container creation failed (${res.status}): ${body.slice(0, 500)}`);
  }
  const body = (await res.json()) as CreateContainerResponse;
  return body.id;
}

export async function publishMediaContainer(containerId: string): Promise<string> {
  const igUserId = process.env.IG_USER_ID;
  const accessToken = process.env.IG_ACCESS_TOKEN;
  if (!igUserId || !accessToken) throw new Error("Missing IG_USER_ID or IG_ACCESS_TOKEN env vars");

  const url = new URL(`${GRAPH_API_BASE}/${igUserId}/media_publish`);
  url.searchParams.set("creation_id", containerId);
  url.searchParams.set("access_token", accessToken);

  const res = await fetch(url.toString(), { method: "POST" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Instagram publish failed (${res.status}): ${body.slice(0, 500)}`);
  }
  const body = (await res.json()) as PublishResponse;
  return body.id;
}

/** Full two-call flow. Caller (admin API route) persists ig_container_id/ig_media_id at each step. */
export async function publishToInstagram(params: {
  imageUrl: string;
  caption: string;
  onContainerCreated?: (containerId: string) => Promise<void>;
}): Promise<{ containerId: string; mediaId: string }> {
  const containerId = await createMediaContainer(params);
  if (params.onContainerCreated) await params.onContainerCreated(containerId);
  const mediaId = await publishMediaContainer(containerId);
  return { containerId, mediaId };
}

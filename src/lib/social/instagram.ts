/**
 * Meta Instagram Graph API client (BUILD_PRIMER section 3/8). Single-account
 * use via a development-mode app + Instagram Tester role — no App Review,
 * no multi-tenant OAuth flow. Two-call publish flow per section 3:
 *   1. POST /{ig-user-id}/media          (create container)
 *   2. POST /{ig-user-id}/media_publish  (publish container)
 */

const GRAPH_API_BASE = "https://graph.facebook.com/v21.0";

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

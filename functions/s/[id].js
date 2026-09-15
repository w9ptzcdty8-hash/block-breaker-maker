const PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]{16}$/;

export async function onRequest(context) {
  if (context.request.method !== "GET" && context.request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { "Allow": "GET, HEAD" },
    });
  }

  if (!PUBLIC_ID_PATTERN.test(String(context.params.id || ""))) {
    return new Response("Not Found", { status: 404 });
  }

  const assetUrl = new URL("/", context.request.url);
  const assetRequest = new Request(assetUrl, {
    method: context.request.method,
    headers: context.request.headers,
  });
  const response = await context.env.ASSETS.fetch(assetRequest);
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}



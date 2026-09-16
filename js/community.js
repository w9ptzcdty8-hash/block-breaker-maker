const SHARED_STAGE_PATH = /^\/s\/([A-Za-z0-9_-]{16})\/?$/;

export class CommunityError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = "CommunityError";
    this.status = status;
  }
}

async function readResponse(response) {
  let body = null;
  try {
    body = await response.json();
  } catch {
    // The user should see a stable message even if an edge error returns HTML.
  }
  if (!response.ok) {
    throw new CommunityError(body?.error || "通信に失敗しました。時間をおいてお試しください", response.status);
  }
  return body;
}

function normalizeStageForPublish(stage) {
  return {
    schemaVersion: stage.schemaVersion,
    grid: {
      columns: stage.grid?.columns,
      rows: stage.grid?.rows,
    },
    blocks: Array.isArray(stage.blocks) ? stage.blocks.map((block) => ({
      x: block.x,
      y: block.y,
      type: block.type,
      ...(block.type === "item" ? { item: block.item } : {}),
    })) : [],
  };
}

export function getSharedStageId(pathname = window.location.pathname) {
  return pathname.match(SHARED_STAGE_PATH)?.[1] || null;
}

export async function publishStage(stage, authorClearTimeSeconds) {
  const response = await fetch("/api/stages", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      stage: normalizeStageForPublish(stage),
      authorClearTimeMs: Math.round(authorClearTimeSeconds * 1000),
    }),
  });
  return readResponse(response);
}

export async function fetchSharedStage(publicId) {
  const response = await fetch(`/api/stages/${encodeURIComponent(publicId)}`, {
    method: "GET",
    credentials: "same-origin",
    headers: {
      "Accept": "application/json",
    },
  });
  return readResponse(response);
}

export async function fetchCommunityList(cursor = null) {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return readResponse(await fetch(`/api/stages${query}`, { credentials: "same-origin" }));
}

export async function fetchCommunityRanking(kind) {
  return readResponse(await fetch(`/api/rankings?kind=${encodeURIComponent(kind)}`, { credentials: "same-origin" }));
}

export async function beginSharedPlay(publicId) {
  return readResponse(await fetch(`/api/stages/${encodeURIComponent(publicId)}/plays`, {
    method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}",
  }));
}

export async function reportSharedClear(publicId, playId) {
  return readResponse(await fetch(`/api/stages/${encodeURIComponent(publicId)}/clears`, {
    method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playId }),
  }));
}

export async function copyShareUrl(url) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(url);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = url;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("copy failed");
}


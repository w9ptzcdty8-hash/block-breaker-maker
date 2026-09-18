const COLUMNS = 10;
const ROWS = 12;
const DESIGN_WIDTH = 100;
const DESIGN_HEIGHT = 120;
const BLOCK_CROP = Object.freeze({ x: 9 / 256, y: 14 / 128, width: 238 / 256, height: 103 / 128 });
const PREVIEW_PATTERN = /^[.n23serpmlbu]{120}$/;
const ITEM_MARKS = Object.freeze({
  r: "?",
  p: "↔",
  m: "••",
  l: "●",
  b: "✹",
  u: "1",
});
const FALLBACK_COLORS = Object.freeze({
  n: ["#58a6ff", "#2266c2"],
  "2": ["#ffb84d", "#e47718"],
  "3": ["#c084fc", "#7137b5"],
  s: ["#8792a5", "#3f4858"],
  e: ["#ff5f62", "#bd2028"],
  r: ["#42d6a4", "#12845f"],
  p: ["#42d6a4", "#12845f"],
  m: ["#42d6a4", "#12845f"],
  l: ["#42d6a4", "#12845f"],
  b: ["#42d6a4", "#12845f"],
  u: ["#42d6a4", "#12845f"],
});
const IMAGE_URLS = Object.freeze({
  n: new URL("../assets/images/block-normal.png", import.meta.url).href,
  "2": new URL("../assets/images/block-2hit.png", import.meta.url).href,
  "3": new URL("../assets/images/block-3hit.png", import.meta.url).href,
  s: new URL("../assets/images/block-unbreakable.png", import.meta.url).href,
  e: new URL("../assets/images/block-bomb.png", import.meta.url).href,
});

let imagePromise = null;

function loadImages() {
  if (imagePromise) return imagePromise;
  if (typeof Image === "undefined") return Promise.resolve({});
  imagePromise = Promise.all(Object.entries(IMAGE_URLS).map(([code, source]) => new Promise((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.addEventListener("load", () => resolve([code, image]), { once: true });
    image.addEventListener("error", () => resolve([code, null]), { once: true });
    image.src = source;
  }))).then((entries) => Object.fromEntries(entries.filter(([, image]) => image)));
  return imagePromise;
}

function prepareCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const width = Math.round(DESIGN_WIDTH * dpr);
  const height = Math.round(DESIGN_HEIGHT * dpr);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function drawFallback(ctx, code, x, y, width, height) {
  const [top, bottom] = FALLBACK_COLORS[code];
  const gradient = ctx.createLinearGradient(x, y, x, y + height);
  gradient.addColorStop(0, top);
  gradient.addColorStop(1, bottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = "rgba(255,255,255,.25)";
  ctx.lineWidth = 0.5;
  ctx.strokeRect(x, y, width, height);
}

function drawPreview(canvas, preview, images) {
  const ctx = prepareCanvas(canvas);
  ctx.clearRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
  const background = ctx.createLinearGradient(0, 0, 0, DESIGN_HEIGHT);
  background.addColorStop(0, "#17233c");
  background.addColorStop(1, "#0b1020");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);

  if (!PREVIEW_PATTERN.test(preview || "")) {
    ctx.fillStyle = "rgba(255,255,255,.75)";
    ctx.font = "700 22px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("?", DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2);
    return;
  }

  const cellWidth = DESIGN_WIDTH / COLUMNS;
  const cellHeight = DESIGN_HEIGHT / ROWS;
  for (let index = 0; index < preview.length; index += 1) {
    const code = preview[index];
    if (code === ".") continue;
    const x = index % COLUMNS * cellWidth + 0.5;
    const y = Math.floor(index / COLUMNS) * cellHeight + 0.5;
    const width = cellWidth - 1;
    const height = cellHeight - 1;
    const image = images[ITEM_MARKS[code] ? "n" : code];
    if (image?.naturalWidth) {
      ctx.drawImage(
        image,
        image.naturalWidth * BLOCK_CROP.x,
        image.naturalHeight * BLOCK_CROP.y,
        image.naturalWidth * BLOCK_CROP.width,
        image.naturalHeight * BLOCK_CROP.height,
        x, y, width, height,
      );
    } else {
      drawFallback(ctx, code, x, y, width, height);
    }
    if (ITEM_MARKS[code]) {
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "rgba(18,32,55,.9)";
      ctx.lineWidth = 1.5;
      ctx.font = "900 6px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.strokeText(ITEM_MARKS[code], x + width / 2, y + height / 2 + 0.3);
      ctx.fillText(ITEM_MARKS[code], x + width / 2, y + height / 2 + 0.3);
    }
  }
}

export function drawStagePreview(canvas, preview) {
  drawPreview(canvas, preview, {});
  void loadImages().then((images) => {
    if (canvas.isConnected) drawPreview(canvas, preview, images);
  });
}

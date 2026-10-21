import { randomBytes } from "node:crypto";
export const token = () => randomBytes(24).toString("hex");
export function validateLayout(input, previous = []) {
  if (!input || typeof input !== "object") throw new Error("Invalid layout");
  if (input.mode && !["grid", "freeform"].includes(input.mode)) throw new Error("Invalid layout mode");
  if (input.mode === "freeform") {
    const integer = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
    if (!integer(input.canvasWidth, 1, 65536) || !integer(input.canvasHeight, 1, 65536) || !Array.isArray(input.screens) || input.screens.length < 1 || input.screens.length > 16) throw new Error("Invalid freeform canvas / 自定义画布无效");
    const ids = new Set();
    const screens = input.screens.map((s, i) => {
      if (!s || !integer(s.x, 0, 65536) || !integer(s.y, 0, 65536) || !integer(s.width, 1, 65536) || !integer(s.height, 1, 65536) || s.x + s.width > input.canvasWidth || s.y + s.height > input.canvasHeight || ![0,90,180,270].includes(s.rotation ?? 0)) throw new Error("Invalid screen rectangle / 屏幕矩形无效");
      if (s.id && ids.has(s.id)) throw new Error("Duplicate screen ID");
      if (s.id) ids.add(s.id);
      const old = s.id ? previous.find(p => p.id === s.id) : undefined;
      return {id: old?.id || token().slice(0,12), key: old?.key || token(), name: old?.name || `屏幕 ${String(i+1).padStart(2,"0")}`, row: 0, col: i, x:s.x,y:s.y,width:s.width,height:s.height,rotation:s.rotation ?? 0};
    });
    for (let i=0;i<screens.length;i++) for (let j=0;j<i;j++) {
      const a=screens[i],b=screens[j];
      if (a.x < b.x+b.width && b.x < a.x+a.width && a.y < b.y+b.height && b.y < a.y+a.height) throw new Error("Screen rectangles overlap / 屏幕矩形重叠");
    }
    return {mode:"freeform",canvasWidth:input.canvasWidth,canvasHeight:input.canvasHeight,cols:screens.length,rows:1,tileWidth:1920,tileHeight:1080,gapX:0,gapY:0,screens};
  }
  const bounds = {
    cols: [1, 8],
    rows: [1, 8],
    tileWidth: [320, 7680],
    tileHeight: [240, 4320],
    gapX: [0, 500],
    gapY: [0, 500],
  };
  const result = {};
  for (const [key, [min, max]] of Object.entries(bounds)) {
    if (!Number.isInteger(input[key]) || input[key] < min || input[key] > max)
      throw new Error(`${key} 必须是 ${min}–${max} 的整数`);
    result[key] = input[key];
  }
  if (result.cols * result.rows > 16) throw new Error("最多支持 16 块屏幕");
  result.screens = Array.from({ length: result.rows * result.cols }, (_, i) => {
    const row = Math.floor(i / result.cols),
      col = i % result.cols;
    const old = previous.find((s) => s.row === row && s.col === col);
    return {
      id: old?.id || token().slice(0, 12),
      key: old?.key || token(),
      name: `屏幕 ${String(i + 1).padStart(2, "0")}`,
      row,
      col,
    };
  });
  return result;
}

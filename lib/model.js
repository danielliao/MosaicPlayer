import { randomBytes } from "node:crypto";
export const token = () => randomBytes(24).toString("hex");
export function validateLayout(input, previous = []) {
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

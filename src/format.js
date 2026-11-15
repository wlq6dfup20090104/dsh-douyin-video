// 结果的人话渲染：文案、大小、时长。
export function humanBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / 1048576).toFixed(1) + " MB";
  return (n / 1073741824).toFixed(2) + " GB";
}

export function humanDuration(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return "";
  const total = Math.round(n / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m ? m + ":" + String(s).padStart(2, "0") : s + " 秒";
}

export function humanStats(stats) {
  if (!stats) return "";
  const parts = [];
  const map = { like: "赞", comment: "评", collect: "藏", share: "转", play: "播" };
  for (const [k, label] of Object.entries(map)) {
    const v = Number(stats[k]);
    if (!Number.isFinite(v) || v <= 0) continue;
    parts.push(label + (v >= 10000 ? " " + (v / 10000).toFixed(1) + "w" : " " + v));
  }
  return parts.join(" · ");
}

/** 发文案：标题 + 作者（抖音标题自带 #tag，不重复拼）。 */
export function captionOf(parsed) {
  const lines = [];
  const title = String(parsed?.title || "").trim();
  if (title) lines.push(title);
  lines.push("作者：" + (parsed?.author?.nickname || "未知作者"));
  if (Array.isArray(parsed?.images) && parsed.images.length) lines.push("图集 · " + parsed.images.length + " 张");
  return lines.join("\n");
}

/** 一行摘要，给工具回执用。 */
export function summaryOf(parsed) {
  const bits = [];
  if (parsed?.durationMs) bits.push(humanDuration(parsed.durationMs));
  if (parsed?.sizeBytes) bits.push(humanBytes(parsed.sizeBytes));
  if (parsed?.width && parsed?.height) bits.push(parsed.width + "×" + parsed.height);
  const stat = humanStats(parsed?.stats);
  if (stat) bits.push(stat);
  if (parsed?.kind === "gallery") bits.push("图集");
  return bits.join(" · ");
}

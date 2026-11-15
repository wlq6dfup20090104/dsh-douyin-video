// 编排层：CLI / MCP server / DSH 插件都走这里，保证三处行为一致。
import path from "node:path";
import { loadConfig, resolveOutputDir } from "./config.js";
import { extractDouyinUrls } from "./extract.js";
import { parseDouyin } from "./parse.js";
import { downloadVideo, downloadImages, downloadCover } from "./download.js";
import { captionOf, summaryOf, humanBytes } from "./format.js";

export * from "./config.js";
export * from "./extract.js";
export * from "./parse.js";
export * from "./download.js";
export * from "./format.js";

function linksFrom(text, limit) {
  const max = Math.max(1, limit ?? 3);
  const all = extractDouyinUrls(text);
  if (all.length) return all.slice(0, max);
  // 兜底：直接丢来的就是 mp4 直链（有的群友会把无水印地址转出来）
  const direct = String(text ?? "").match(/https?:\/\/[^\s"'<>]+\.(?:mp4|mov|m4v|webm)(?:\?[^\s"'<>]*)?/i);
  return direct ? [direct[0]] : [];
}

/** 只看：解析元信息，不下载。返回 { ok, items: [...] }。 */
export async function inspect(text, opts = {}) {
  const config = opts.config || loadConfig(opts.pluginConfig);
  const urls = linksFrom(text, opts.maxLinks ?? 3);
  if (!urls.length) return { ok: false, error: "这段文字里没找到抖音链接", items: [] };
  const items = [];
  for (const url of urls) {
    const parsed = await parseDouyin(url, { timeoutMs: config.timeoutMs, extraApis: config.extraApis });
    items.push({ url, parsed });
  }
  const good = items.filter((i) => i.parsed?.ok);
  return { ok: good.length > 0, items, error: good.length ? "" : items[0]?.parsed?.error || "解析失败" };
}

/**
 * 下载：解析 + 落盘。返回 { ok, items: [{ url, kind, title, author, caption, video?, images?, error? }], dir }。
 * opts.dir 覆盖输出目录；opts.sessionCwd 用会话工作区（插件模式下从 exec 拿）。
 */
export async function fetchAll(text, opts = {}) {
  const config = opts.config || loadConfig(opts.pluginConfig);
  const dir = resolveOutputDir(opts.dir || config.outputDir, opts.sessionCwd);
  const urls = linksFrom(text, opts.maxLinks ?? 3);
  if (!urls.length) return { ok: false, error: "这段文字里没找到抖音链接", items: [], dir };

  const items = [];
  for (const url of urls) {
    const parsed = await parseDouyin(url, { timeoutMs: config.timeoutMs, extraApis: config.extraApis });
    if (!parsed?.ok) {
      items.push({ url, ok: false, error: parsed?.error || "解析失败" });
      continue;
    }
    const row = {
      url,
      ok: true,
      kind: parsed.kind || "video",
      source: parsed.source,
      contentId: parsed.contentId,
      title: parsed.title,
      author: parsed.author,
      webUrl: parsed.webUrl,
      coverUrl: parsed.coverUrl,
      durationMs: parsed.durationMs,
      sizeBytes: parsed.sizeBytes,
      stats: parsed.stats,
      summary: summaryOf(parsed),
      caption: captionOf(parsed),
    };
    if (config.keepCover) {
      const cover = await downloadCover(parsed, { dir, timeoutMs: 30_000 });
      if (cover.ok) row.coverPath = cover.path;
    }
    if (row.kind === "gallery") {
      const imgs = await downloadImages(parsed, { dir, limit: config.maxImages, timeoutMs: 60_000 });
      row.ok = imgs.ok;
      row.images = imgs.files || [];
      if (!imgs.ok) row.error = imgs.error;
      else if (imgs.errors?.length) row.warnings = imgs.errors;
    } else {
      const video = await downloadVideo(parsed, {
        dir,
        maxBytes: config.maxMB * 1024 * 1024,
        timeoutMs: config.downloadTimeoutMs,
      });
      row.ok = video.ok;
      if (video.ok) {
        row.videoPath = video.path;
        row.videoBytes = video.bytes;
        row.cached = video.cached === true;
        row.fileName = path.basename(video.path);
      } else {
        row.error = video.error;
      }
    }
    items.push(row);
  }
  const good = items.filter((i) => i.ok);
  return { ok: good.length > 0, items, dir, error: good.length ? "" : items[0]?.error || "全都没成" };
}

/** 工具回执用的纯文本。 */
export function renderFetch(result) {
  if (!result?.ok) return "✗ " + (result?.error || "没拿到视频");
  return result.items
    .map((row) => {
      if (!row.ok) return "✗ " + row.url + " —— " + (row.error || "失败");
      const head = "✓ " + (row.title || "（无标题）") + " — " + (row.author?.nickname || "未知作者");
      const meta = row.summary ? "（" + row.summary + "）" : "";
      const files = [];
      if (row.videoPath) files.push("视频：" + row.videoPath + (row.videoBytes ? "（" + humanBytes(row.videoBytes) + "）" : ""));
      if (row.images?.length) files.push("图集：" + row.images.length + " 张 → " + path.dirname(row.images[0].path));
      if (row.coverPath) files.push("封面：" + row.coverPath);
      const warn = row.warnings?.length ? "\n  部分失败：" + row.warnings.join("；") : "";
      return head + meta + "\n  " + files.join("\n  ") + warn;
    })
    .join("\n");
}

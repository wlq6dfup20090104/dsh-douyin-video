// 下载：视频 / 图集 / 封面。落盘到指定目录，同名同大小直接复用（重复贴同一条链接不重复下）。
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { UA_IPHONE } from "./parse.js";

const REFERER = "https://www.douyin.com/";

function safeName(text, fallback) {
  const s = String(text || "")
    .replace(/[\\/:*?"<>|\n\r\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return s || fallback;
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

async function existing(file) {
  try {
    const st = await fsp.stat(file);
    if (st.isFile() && st.size > 0) return st.size;
  } catch {}
  return 0;
}

function looksLikeVideo(buf) {
  if (buf.length < 12) return false;
  const head = buf.subarray(0, 12);
  // mp4/mov: ftyp at 4..8
  if (head.subarray(4, 8).toString("latin1") === "ftyp") return true;
  // webm/mkv: EBML
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return true;
  return false;
}

/** 下载视频。返回 { ok, path, bytes, cached }。 */
export async function downloadVideo(parsed, opts = {}) {
  const maxBytes = (opts.maxBytes ?? 200 * 1024 * 1024);
  const timeoutMs = opts.timeoutMs ?? 300_000;
  const dir = await ensureDir(opts.dir || path.join(process.cwd(), "douyin"));
  const stem = "dy-" + (parsed.contentId || crypto.randomBytes(6).toString("hex"));
  const file = path.join(dir, stem + ".mp4");

  const hit = await existing(file);
  if (hit) return { ok: true, path: file, bytes: hit, cached: true };

  const urls = (Array.isArray(parsed.videoUrls) && parsed.videoUrls.length ? parsed.videoUrls : [parsed.videoUrl]).filter(Boolean);
  let lastError = "没有可用的视频直链";
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": UA_IPHONE, referer: REFERER, accept: "*/*" },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "follow",
      });
      if (!res.ok) {
        lastError = "HTTP " + res.status;
        continue;
      }
      const declared = Number(res.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > maxBytes) {
        return { ok: false, error: "视频太大（" + (declared / 1048576).toFixed(1) + "MB，上限 " + (maxBytes / 1048576).toFixed(0) + "MB）" };
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length) {
        lastError = "下载到 0 字节";
        continue;
      }
      if (buf.length > maxBytes) {
        return { ok: false, error: "视频太大（" + (buf.length / 1048576).toFixed(1) + "MB，上限 " + (maxBytes / 1048576).toFixed(0) + "MB）" };
      }
      if (!looksLikeVideo(buf)) {
        lastError = "拿到的不是视频（可能是防盗链页或图片）";
        continue;
      }
      const tmp = file + ".part";
      await fsp.writeFile(tmp, buf);
      await fsp.rename(tmp, file);
      return { ok: true, path: file, bytes: buf.length, cached: false };
    } catch (error) {
      lastError = String(error?.message || error);
    }
  }
  return { ok: false, error: lastError };
}

/** 下载图集。返回 { ok, files: [{index, path, bytes}], errors }。 */
export async function downloadImages(parsed, opts = {}) {
  const list = Array.isArray(parsed.images) ? parsed.images : [];
  const limit = Math.max(1, opts.limit ?? 20);
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const dir = await ensureDir(opts.dir || path.join(process.cwd(), "douyin"));
  const stem = "dyg-" + (parsed.contentId || crypto.randomBytes(6).toString("hex"));
  const files = [];
  const errors = [];
  for (let i = 0; i < Math.min(list.length, limit); i += 1) {
    const url = typeof list[i] === "string" ? list[i] : list[i]?.url;
    if (!url) continue;
    const file = path.join(dir, stem + "-" + String(i + 1).padStart(2, "0") + ".jpg");
    const hit = await existing(file);
    if (hit) {
      files.push({ index: i + 1, path: file, bytes: hit, cached: true });
      continue;
    }
    try {
      const res = await fetch(url, {
        headers: { "user-agent": UA_IPHONE, referer: REFERER, accept: "image/*,*/*" },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "follow",
      });
      if (!res.ok) {
        errors.push("第 " + (i + 1) + " 张 HTTP " + res.status);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length) {
        errors.push("第 " + (i + 1) + " 张是 0 字节");
        continue;
      }
      const tmp = file + ".part";
      await fsp.writeFile(tmp, buf);
      await fsp.rename(tmp, file);
      files.push({ index: i + 1, path: file, bytes: buf.length, cached: false });
    } catch (error) {
      errors.push("第 " + (i + 1) + " 张 " + String(error?.message || error));
    }
  }
  if (!files.length) return { ok: false, error: errors.join("；") || "一张都没下下来", errors };
  return { ok: true, files, errors };
}

/** 顺手存个封面（可选）。 */
export async function downloadCover(parsed, opts = {}) {
  if (!parsed.coverUrl) return { ok: false, error: "没有封面" };
  const dir = await ensureDir(opts.dir || path.join(process.cwd(), "douyin"));
  const file = path.join(dir, "dy-" + (parsed.contentId || crypto.randomBytes(6).toString("hex")) + "-cover.jpg");
  const hit = await existing(file);
  if (hit) return { ok: true, path: file, bytes: hit, cached: true };
  try {
    const res = await fetch(parsed.coverUrl, {
      headers: { "user-agent": UA_IPHONE, referer: REFERER, accept: "image/*,*/*" },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
      redirect: "follow",
    });
    if (!res.ok) return { ok: false, error: "HTTP " + res.status };
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return { ok: false, error: "封面是 0 字节" };
    await fsp.writeFile(file, buf);
    return { ok: true, path: file, bytes: buf.length };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

export function fileSizeOf(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

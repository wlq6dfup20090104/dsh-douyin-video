// 抖音解析：两条通道，谁先通用谁。
//   1) xingzhige 公益接口  GET https://api.xingzhige.com/API/douyin/?url=<链接>   免登录，约 1 秒
//   2) api.douyin.wtf      登录 demo 账号 -> POST /api/v1/parse(202) -> 轮询 /api/v1/tasks/{id}
// 官方接口全是 403 ArgusSecurityPlugin，分享页 SSR 的 video_layout 是 null，yt-dlp 缺 ttwid，都别试。
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const XZG_API = process.env.DOUYIN_XZG_API || "https://api.xingzhige.com/API/douyin/";
const WTF_BASE = process.env.DOUYIN_API_BASE || "https://api.douyin.wtf";
const WTF_USER = process.env.DOUYIN_DEMO_USER || "demo";
const WTF_PASS = process.env.DOUYIN_DEMO_PASS || "kelp-kelp-delta-3690";
const COOKIE_FILE = path.join(os.tmpdir(), "dsh-douyin-wtf-cookie.json");
export const UA_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const UA_DESKTOP =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function textTags(title) {
  return String(title || "")
    .match(/#[^\s#]+/g)
    ? String(title || "").match(/#[^\s#]+/g) ?? []
    : [];
}

function tagsOf(title) {
  return textTags(title).map((t) => t.replace(/^#/, "")).filter(Boolean);
}

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function statsFrom(stat) {
  const out = {};
  for (const k of ["like", "comment", "collect", "share", "play"]) {
    const v = Number(stat?.[k]);
    if (Number.isFinite(v)) out[k] = v;
  }
  if (Number(stat?.time)) out.createdAt = Number(stat.time) * 1000;
  return Object.keys(out).length ? out : null;
}

/** 直链就是 .mp4 的情况（有人直接丢 CDN 地址）。 */
export function isDirectVideoUrl(url) {
  return /^https?:\/\//i.test(String(url || "")) && /\.(mp4|mov|m4v|webm)(\?|#|$)/i.test(String(url));
}

// ---------------------------------------------------------------- xingzhige
export function mapXingzhige(body) {
  if (!body || Number(body.code) !== 0) {
    const msg = body?.msg || body?.message || "解析失败";
    return { ok: false, error: "xingzhige: " + msg };
  }
  const d = body.data || {};
  const item = d.item || {};
  const author = d.author || {};
  const stat = d.stat || {};
  const jx = d.jx || {};
  const urls = [];
  if (item.url) urls.push(String(item.url));
  if (item.ury && !urls.includes(String(item.ury))) urls.push(String(item.ury));
  const imgs = Array.isArray(item.images) ? item.images : Array.isArray(d.images) ? d.images : [];
  const title = String(item.title || "").trim();
  const base = {
    source: "xingzhige",
    contentId: jx.item_id || stat.aweme_id || null,
    title,
    description: title,
    tags: tagsOf(title),
    author: {
      nickname: String(author.name || "").trim() || "未知作者",
      uid: author.uid || null,
      uniqueId: author.short_id || null,
      signature: null,
      verified: false,
    },
    webUrl: jx.url || null,
    coverUrl: item.cover || item.cover_gif || null,
    stats: statsFrom(stat),
  };
  if (!urls.length) {
    if (imgs.length) {
      return { ok: true, kind: "gallery", ...base, images: imgs.map((u) => ({ url: typeof u === "string" ? u : u?.url })).filter((x) => x.url) };
    }
    if (/图文/.test(String(jx.type || ""))) return { ok: false, error: "这是一条图文，但没拿到图片列表" };
    return { ok: false, error: "没拿到视频直链（xingzhige）" };
  }
  return {
    ok: true,
    kind: "video",
    ...base,
    durationMs: numOrNull(Number(item.duration) * 1000),
    sizeBytes: numOrNull(item.size),
    width: numOrNull(item.width),
    height: numOrNull(item.height),
    watermark: false,
    videoUrl: urls[0],
    videoUrls: urls,
  };
}

async function parseXingzhige(target, timeoutMs) {
  const res = await fetch(XZG_API + "?url=" + encodeURIComponent(target), {
    headers: { "user-agent": UA_IPHONE, accept: "application/json" },
    signal: AbortSignal.timeout(Math.min(Math.max(8_000, timeoutMs), 45_000)),
  });
  if (!res.ok) throw new Error("xingzhige HTTP " + res.status);
  const body = await res.json().catch(() => ({}));
  return mapXingzhige(body);
}

// --------------------------------------------------------------- douyin.wtf
let cookieCache = null;
let cookieExpiry = 0;

function cookiesOf(res) {
  if (typeof res.headers.getSetCookie === "function") {
    return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  }
  const raw = res.headers.get("set-cookie");
  if (!raw) return "";
  return raw.split(/,(?=[^;]+=)/).map((c) => c.split(";")[0]).join("; ");
}

async function loadCookie() {
  if (cookieCache && Date.now() < cookieExpiry) return cookieCache;
  try {
    const saved = JSON.parse(await fsp.readFile(COOKIE_FILE, "utf8"));
    if (saved?.cookie && Number(saved.expiresAt) > Date.now()) {
      cookieCache = saved.cookie;
      cookieExpiry = Number(saved.expiresAt);
      return cookieCache;
    }
  } catch {}
  return null;
}

async function loginWtf() {
  const res = await fetch(WTF_BASE + "/api/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": UA_DESKTOP },
    body: JSON.stringify({ username: WTF_USER, password: WTF_PASS }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.success) throw new Error("解析服务登录失败：" + (body?.error || res.status));
  const cookie = cookiesOf(res);
  if (cookie) {
    cookieCache = cookie;
    cookieExpiry = Date.now() + 6 * 24 * 3600 * 1000;
    await fsp
      .writeFile(COOKIE_FILE, JSON.stringify({ cookie, expiresAt: cookieExpiry }), { mode: 0o600 })
      .catch(() => {});
  }
  return cookie;
}

async function wtfCall(pathname, opts = {}) {
  const cookie = (await loadCookie()) || (await loginWtf());
  const headers = { "content-type": "application/json", "user-agent": UA_DESKTOP };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(WTF_BASE + pathname, {
    method: opts.method || "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 401 && opts.retryAuth !== false) {
    await fsp.rm(COOKIE_FILE, { force: true }).catch(() => {});
    cookieCache = null;
    cookieExpiry = 0;
    await loginWtf();
    return wtfCall(pathname, { method: opts.method, body: opts.body, retryAuth: false });
  }
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

function mapWtf(data) {
  if (data.is_deleted) return { ok: false, error: "这条视频已删除" };
  if (data.is_private) return { ok: false, error: "这条视频是私密的" };
  const media = data.media || {};
  const video = media.video || {};
  const urls = [];
  if (video.url) urls.push(String(video.url));
  for (const u of Array.isArray(video.urls) ? video.urls : []) {
    const s = typeof u === "string" ? u : u?.url;
    if (s && !urls.includes(s)) urls.push(s);
  }
  const author = data.author || {};
  const base = {
    source: "douyin.wtf",
    contentId: data.content_id || null,
    title: String(data.title || data.description || "").trim(),
    description: String(data.description || "").trim(),
    tags: Array.isArray(data.tags) ? data.tags : [],
    author: {
      nickname: String(author.nickname || "").trim() || "未知作者",
      uid: author.uid || null,
      uniqueId: author.unique_id || null,
      signature: author.signature || null,
      verified: author.verified === true,
    },
    webUrl: data.web_url || null,
    stats: data.stats || null,
  };
  const covers = Array.isArray(media.covers) ? media.covers : [];
  base.coverUrl = typeof covers[0] === "string" ? covers[0] : covers[0]?.url || null;
  if (data.kind !== "video" || !urls.length) {
    return { ok: false, error: data.kind === "image" ? "这是一条图文，不是视频" : "没拿到视频直链（douyin.wtf）" };
  }
  return {
    ok: true,
    kind: "video",
    ...base,
    durationMs: numOrNull(data.duration_ms),
    sizeBytes: numOrNull(video.size_bytes),
    width: numOrNull(video.width),
    height: numOrNull(video.height),
    watermark: video.watermark === true,
    videoUrl: urls[0],
    videoUrls: urls,
  };
}

async function parseWtf(target, timeoutMs) {
  const started = Date.now();
  const created = await wtfCall("/api/v1/parse", { method: "POST", body: { url: target } });
  if (created.status !== 200 && created.status !== 202) {
    return { ok: false, error: "提交解析失败：HTTP " + created.status + " " + String(created.json?.error || "").slice(0, 160) };
  }
  const taskId = created.json?.data?.task_id;
  if (!taskId) return { ok: false, error: "解析服务没回 task_id" };
  let data = null;
  while (Date.now() - started < timeoutMs) {
    await sleep(700);
    const t = await wtfCall("/api/v1/tasks/" + encodeURIComponent(taskId));
    const dd = t.json?.data || {};
    if (dd.state === "done") {
      data = dd.data;
      break;
    }
    if (dd.state === "failed" || dd.state === "error") {
      return { ok: false, error: "解析失败：" + JSON.stringify(dd.error || dd.data || "未知").slice(0, 200) };
    }
  }
  if (!data) return { ok: false, error: "解析超时（" + Math.round((Date.now() - started) / 1000) + " 秒）" };
  return mapWtf(data);
}

// --------------------------------------------------------------- 对外
/** 自定义接口：模板里 {url} 换成编码后的链接，返回 JSON 里找第一个像视频的字段。 */
async function parseExtra(target, template, timeoutMs) {
  const url = String(template).replace("\{url\}", encodeURIComponent(target));
  const res = await fetch(url, {
    headers: { "user-agent": UA_IPHONE, accept: "application/json" },
    signal: AbortSignal.timeout(Math.min(Math.max(8_000, timeoutMs), 45_000)),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const body = await res.json().catch(() => ({}));
  const seen = new Set();
  const hits = [];
  const walk = (node) => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === "string" && /\.(mp4|m3u8)(\?|#|$)/i.test(v) && !hits.includes(v)) hits.push(v);
      else if (v && typeof v === "object") walk(v);
    }
  };
  walk(body);
  if (!hits.length) return { ok: false, error: "自定义接口里没找到视频直链" };
  const title = String(body?.data?.title || body?.data?.desc || body?.title || "").trim();
  return {
    ok: true,
    kind: "video",
    source: "custom",
    contentId: null,
    title,
    description: title,
    tags: tagsOf(title),
    author: { nickname: "未知作者", uid: null, uniqueId: null, signature: null, verified: false },
    webUrl: null,
    coverUrl: null,
    stats: null,
    videoUrl: hits[0],
    videoUrls: hits,
  };
}

/** 解析一条链接，返回元信息，不下载。 */
export async function parseDouyin(input, opts = {}) {
  const timeoutMs = opts.timeoutMs || 90_000;
  const target = String(input || "").trim();
  if (!target) return { ok: false, error: "没给链接" };
  if (isDirectVideoUrl(target)) {
    return {
      ok: true,
      kind: "video",
      source: "direct",
      contentId: null,
      title: target.split("/").pop().split("?")[0] || "视频",
      description: "",
      tags: [],
      author: { nickname: "未知", uid: null, uniqueId: null, signature: null, verified: false },
      webUrl: null,
      coverUrl: null,
      stats: null,
      videoUrl: target,
      videoUrls: [target],
    };
  }

  const errors = [];
  try {
    const viaXzg = await parseXingzhige(target, timeoutMs);
    if (viaXzg?.ok) return viaXzg;
    if (viaXzg?.error) errors.push(viaXzg.error);
  } catch (e) {
    errors.push("xingzhige: " + (e?.message || e));
  }

  for (const template of String(opts.extraApis || "").split(",").map((s) => s.trim()).filter(Boolean)) {
    try {
      const r = await parseExtra(target, template, timeoutMs);
      if (r?.ok) return r;
      if (r?.error) errors.push("custom: " + r.error);
    } catch (e) {
      errors.push("custom: " + (e?.message || e));
    }
  }

  try {
    const viaWtf = await parseWtf(target, timeoutMs);
    if (viaWtf?.ok) return viaWtf;
    if (viaWtf?.error) errors.push(viaWtf.error);
  } catch (e) {
    errors.push("douyin.wtf: " + (e?.message || e));
  }

  return { ok: false, error: errors.join("；") || "解析失败" };
}

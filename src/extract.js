// 从一段分享文案里把所有抖音链接抠出来。分享口令长这样：
// 「8.92 复制打开抖音，看看【某某的作品】... https://v.douyin.com/abcdef/ 复制此链接...」
const URL_RE = /https?:\/\/[^\s，,。、；;）)】\]"'<>|]*(?:v\.douyin\.com|www\.douyin\.com|douyin\.com|iesdouyin\.com)[^\s，,。、；;）)】\]"'<>|]*/gi;
const BARE_RE = /(?:v\.douyin\.com|www\.douyin\.com|douyin\.com|iesdouyin\.com)\/[^\s，,。、；;）)】\]"'<>|]*/gi;
const INVALID_RE = /^(?:https?:\/\/)?(?:www\.|v\.)?(?:ies)?douyin\.com\/?$/i;

function tidy(raw) {
  let s = String(raw || "").trim();
  s = s.replace(/[.,;:!?）)】\]"'<>]+$/g, "");
  if (!/^https?:\/\//i.test(s)) s = "https://" + s.replace(/^\/+/, "");
  return s;
}

/** 返回去重后的链接数组；一个都没有就是空数组。 */
export function extractDouyinUrls(text) {
  const s = String(text ?? "");
  const found = [];
  const seen = new Set();
  const push = (raw) => {
    const url = tidy(raw);
    if (!url || INVALID_RE.test(url)) return;
    if (seen.has(url)) return;
    seen.add(url);
    found.push(url);
  };
  for (const m of s.matchAll(URL_RE)) push(m[0]);
  if (!found.length) for (const m of s.matchAll(BARE_RE)) push(m[0]);
  return found;
}

/** 只要第一条（大多数场景够用）。 */
export function extractDouyinUrl(text) {
  const all = extractDouyinUrls(text);
  return all.length ? all[0] : null;
}

/** 这段文字里有没有抖音链接。 */
export function hasDouyinUrl(text) {
  return extractDouyinUrls(text).length > 0;
}

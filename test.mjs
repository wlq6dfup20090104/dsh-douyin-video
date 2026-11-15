// 自测：不联网也能跑（默认只测纯逻辑），加 --net 再跑一遍真实解析。
//   node test.mjs          # 纯逻辑
//   node test.mjs --net    # 顺带打一次真链接
import process from "node:process";
import assert from "node:assert/strict";
import { extractDouyinUrls, extractDouyinUrl, hasDouyinUrl } from "./src/extract.js";
import { isDirectVideoUrl, mapXingzhige } from "./src/parse.js";
import { humanBytes, humanDuration, humanStats, captionOf, summaryOf } from "./src/format.js";
import { loadConfig, resolveOutputDir } from "./src/config.js";

let pass = 0;
let fail = 0;
const t = (name, fn) => {
  try {
    fn();
    pass += 1;
    console.log("  ✓ " + name);
  } catch (error) {
    fail += 1;
    console.log("  ✗ " + name + " —— " + error.message);
  }
};

console.log("抽链接");
t("纯链接", () => {
  assert.deepEqual(extractDouyinUrls("https://v.douyin.com/iRNBqXnH/"), ["https://v.douyin.com/iRNBqXnH/"]);
});
t("整段分享文案", () => {
  const text = "7.43 复制打开抖音，看看【小二的视频】超好笑 https://v.douyin.com/abcDEF12/ 复制此链接，打开Dou音搜索";
  assert.deepEqual(extractDouyinUrls(text), ["https://v.douyin.com/abcDEF12/"]);
});
t("没有 https 前缀也认", () => {
  assert.deepEqual(extractDouyinUrls("看这个 v.douyin.com/xyz789/"), ["https://v.douyin.com/xyz789/"]);
});
t("去掉尾随标点", () => {
  assert.deepEqual(extractDouyinUrls("链接 https://v.douyin.com/abc123/。"), ["https://v.douyin.com/abc123/"]);
});
t("多个链接去重", () => {
  const text = "https://v.douyin.com/aaa/ 和 https://v.douyin.com/bbb/ 还有 https://v.douyin.com/aaa/";
  assert.deepEqual(extractDouyinUrls(text), ["https://v.douyin.com/aaa/", "https://v.douyin.com/bbb/"]);
});
t("www 与 iesdouyin 也认", () => {
  assert.equal(extractDouyinUrls("https://www.douyin.com/video/7300000000000000000").length, 1);
  assert.equal(extractDouyinUrls("https://www.iesdouyin.com/share/video/123").length, 1);
});
t("不是抖音的链接不认", () => {
  assert.deepEqual(extractDouyinUrls("https://www.bilibili.com/video/BV1xx"), []);
  assert.deepEqual(extractDouyinUrls("https://douyin.com/"), []);
});
t("hasDouyinUrl / extractDouyinUrl", () => {
  assert.equal(hasDouyinUrl("随便说说 https://v.douyin.com/a1/"), true);
  assert.equal(hasDouyinUrl("没有链接"), false);
  assert.equal(extractDouyinUrl("没有链接"), null);
});

console.log("直链判断");
t("mp4 直链", () => {
  assert.equal(isDirectVideoUrl("https://x.com/a.mp4"), true);
  assert.equal(isDirectVideoUrl("https://x.com/a.mp4?k=1"), true);
  assert.equal(isDirectVideoUrl("https://v.douyin.com/abc/"), false);
  assert.equal(isDirectVideoUrl("https://x.com/a.jpg"), false);
});

console.log("xingzhige 字段映射");
t("视频", () => {
  const r = mapXingzhige({
    code: 0,
    data: {
      item: { url: "https://cdn/a.mp4", title: "标题 #tag1 #tag2", duration: 12.5, size: 1048576, width: 720, height: 1280, cover: "https://cdn/c.jpg" },
      author: { name: "某人", uid: "1", short_id: "abc" },
      stat: { like: 100, comment: 2, time: 1700000000 },
      jx: { item_id: "7300000000000000000", url: "https://www.douyin.com/video/1" },
    },
  });
  assert.equal(r.ok, true);
  assert.equal(r.kind, "video");
  assert.equal(r.videoUrl, "https://cdn/a.mp4");
  assert.deepEqual(r.tags, ["tag1", "tag2"]);
  assert.equal(r.durationMs, 12500);
  assert.equal(r.author.nickname, "某人");
  assert.equal(r.stats.like, 100);
});
t("图集", () => {
  const r = mapXingzhige({
    code: 0,
    data: { item: { title: "图集 #x", images: ["https://cdn/1.jpg", "https://cdn/2.jpg"] }, author: { name: "某" }, jx: { item_id: "1" } },
  });
  assert.equal(r.ok, true);
  assert.equal(r.kind, "gallery");
  assert.equal(r.images.length, 2);
});
t("接口报错", () => {
  const r = mapXingzhige({ code: -404, msg: "资源id获取失败" });
  assert.equal(r.ok, false);
  assert.match(r.error, /资源id获取失败/);
});
t("啥也没有", () => {
  const r = mapXingzhige({ code: 0, data: {} });
  assert.equal(r.ok, false);
});

console.log("格式化");
t("大小", () => {
  assert.equal(humanBytes(512), "512 B");
  assert.equal(humanBytes(2048), "2 KB");
  assert.equal(humanBytes(5 * 1048576), "5.0 MB");
  assert.equal(humanBytes(0), "");
});
t("时长", () => {
  assert.equal(humanDuration(12500), "13 秒");
  assert.equal(humanDuration(75000), "1:15");
  assert.equal(humanDuration(0), "");
});
t("统计", () => {
  assert.equal(humanStats({ like: 12345, comment: 8 }), "赞 1.2w · 评 8");
  assert.equal(humanStats(null), "");
});
t("文案与摘要", () => {
  const p = { title: "标题 #a", author: { nickname: "某人" }, durationMs: 12000, sizeBytes: 1048576, stats: { like: 5 } };
  assert.equal(captionOf(p), "标题 #a\n作者：某人");
  assert.match(summaryOf(p), /12 秒/);
});

console.log("配置");
t("默认值", () => {
  const c = loadConfig({}, {});
  assert.equal(c.maxMB, 200);
  assert.equal(c.maxImages, 20);
  assert.equal(c.autoHint, true);
  assert.equal(c.outputDir, "");
});
t("环境变量盖过插件配置", () => {
  const c = loadConfig({ maxMB: 10, autoHint: false }, { DOUYIN_MAX_MB: "50", DOUYIN_AUTO_HINT: "0" });
  assert.equal(c.maxMB, 50);
  assert.equal(c.autoHint, false);
});
t("插件配置盖过默认", () => {
  const c = loadConfig({ maxMB: 10, outputDir: "/tmp/x" }, {});
  assert.equal(c.maxMB, 10);
  assert.equal(c.outputDir, "/tmp/x");
});
t("坏值退回默认", () => {
  const c = loadConfig({ maxMB: "abc" }, {});
  assert.equal(c.maxMB, 200);
});
t("输出目录：配置 > 会话工作区 > 家目录", () => {
  assert.equal(resolveOutputDir("/a/b", "/c"), "/a/b");
  assert.equal(resolveOutputDir("", "/c"), "/c/douyin");
  assert.match(resolveOutputDir("", ""), /douyin-videos$/);
});

console.log("\n" + pass + " 通过 / " + fail + " 失败");

if (process.argv.includes("--net")) {
  console.log("\n联网实测（真实抖音链接）");
  const { inspect } = await import("./src/index.js");
  const link = process.env.TEST_LINK || "https://v.douyin.com/CIIeGIZHsM4/";
  const r = await inspect(link, { config: loadConfig(), maxLinks: 1 });
  if (r.ok) {
    const p = r.items[0].parsed;
    console.log("  ✓ " + p.kind + " · " + p.title.slice(0, 30) + " · " + p.author.nickname);
  } else {
    fail += 1;
    console.log("  ✗ 联网解析失败：" + r.error);
  }
}

process.exit(fail ? 1 : 0);

// DSH 宿主半边：两个工具 + 一句每轮提示。
// 贴一条抖音分享链接进来，模型会先 douyin_info 看是什么，能下就 douyin_download 落成 mp4，
// 然后把绝对路径给你（配合 present 就能直接点开播放）。
import { loadConfig, cwdOfExec } from "./src/config.js";
import { fetchAll, inspect, renderFetch, summaryOf } from "./src/index.js";

export const name = "douyin-video";
export const inject = ["tools", "systemPrompt", "agents"];

const HINT = [
  "【抖音链接】这条会话装了抖音链接转视频：用户贴来抖音分享链接或分享文案时，",
  "先调 douyin_info 看是什么（标题/作者/时长/是不是图集），别自己猜内容；",
  "能往下走就直接调 douyin_download，它会落成本地 mp4（图集会落成 jpg），把返回的绝对路径给用户。",
  "拿到路径后用 present 把文件列出来，用户就能点开看。",
  "链接里没给具体作品、或者解析失败，就照实说没拿到，别编视频内容。",
].join("");

function promptSectionOrder(ctx) {
  try {
    const value = ctx.systemPrompt?.getSectionOrder?.("DEPLOYMENT_PERSONA_PREFIX");
    return Number.isFinite(value) ? value + 1 : 89990;
  } catch {
    return 89990;
  }
}

const INFO_SCHEMA = {
  type: "object",
  additionalProperties: true,
  properties: {
    ok: { type: "boolean" },
    error: { type: "string" },
    items: { type: "array", items: { type: "object", additionalProperties: true } },
  },
};

const FETCH_SCHEMA = {
  type: "object",
  additionalProperties: true,
  properties: {
    ok: { type: "boolean" },
    error: { type: "string" },
    dir: { type: "string" },
    items: { type: "array", items: { type: "object", additionalProperties: true } },
  },
};

export function apply(ctx, config = {}) {
  const pluginConfig = config && typeof config === "object" ? config : {};
  const currentConfig = () => loadConfig(pluginConfig);
  const toolDisposers = [];

  toolDisposers.push(
    ctx.tools.register({
      name: "douyin_info",
      description:
        "解析抖音分享链接/分享文案，只返回这条作品的元信息（标题、作者、时长、大小、点赞、封面、是视频还是图集），不下载。"
        + "用户贴来抖音链接、想先知道那是什么的时候用；参数可以整段分享文案，插件自己抠链接。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: { type: "string", description: "抖音链接，或者一整段分享文案（带口令那种也行）。" },
        },
        required: ["text"],
      },
      output: {
        schema: INFO_SCHEMA,
        render(_args, value) {
          if (!value?.ok) return [{ type: "text", text: "✗ " + (value?.error || "解析失败") }];
          const lines = [];
          for (const row of value.items || []) {
            const p = row.parsed || {};
            if (!p.ok) {
              lines.push("✗ " + row.url + " —— " + (p.error || "解析失败"));
              continue;
            }
            const meta = summaryOf(p);
            lines.push(
              "✓ " + (p.kind === "gallery" ? "【图集】" : "【视频】") + (p.title || "（无标题）")
                + "\n  作者：" + (p.author?.nickname || "未知作者")
                + (meta ? "\n  " + meta : "")
                + (p.webUrl ? "\n  " + p.webUrl : "")
            );
          }
          return [{ type: "text", text: lines.join("\n") }];
        },
      },
      async execute(args) {
        try {
          const result = await inspect(String(args?.text ?? ""), { config: currentConfig(), maxLinks: 3 });
          return {
            ok: result.ok,
            error: result.error,
            items: (result.items || []).map((row) => ({
              url: row.url,
              parsed: row.parsed,
              summary: row.parsed?.ok ? summaryOf(row.parsed) : "",
            })),
          };
        } catch (error) {
          return { ok: false, error: String(error?.message || error), items: [] };
        }
      },
    })
  );

  toolDisposers.push(
    ctx.tools.register({
      name: "douyin_download",
      description:
        "把抖音分享链接下载成本地文件：视频落成 mp4，图集落成若干 jpg，用的是无水印直链。返回绝对路径。"
        + "参数可以是一条链接，也可以是一整段分享文案；一段文字里有多个链接会逐个处理（最多 3 条）。"
        + "下载完把路径告诉用户，并用 present 把文件列出来。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: { type: "string", description: "抖音链接，或包含链接的整段分享文案。" },
          dir: { type: "string", description: "可选，保存目录。不填就存到当前工作区的 douyin/ 下。" },
        },
        required: ["text"],
      },
      output: {
        schema: FETCH_SCHEMA,
        render(_args, value) {
          return [{ type: "text", text: renderFetch(value) }];
        },
      },
      async execute(args, exec) {
        try {
          const result = await fetchAll(String(args?.text ?? ""), {
            config: currentConfig(),
            dir: String(args?.dir || "").trim() || undefined,
            sessionCwd: cwdOfExec(exec),
            maxLinks: 3,
          });
          return {
            ok: result.ok,
            error: result.error,
            dir: result.dir,
            items: (result.items || []).map((row) => ({
              url: row.url,
              ok: row.ok,
              kind: row.kind,
              title: row.title,
              authorName: row.author?.nickname || "",
              caption: row.caption || "",
              durationMs: row.durationMs ?? null,
              videoPath: row.videoPath || "",
              videoBytes: row.videoBytes || 0,
              images: (row.images || []).map((i) => ({ index: i.index, path: i.path, bytes: i.bytes })),
              error: row.error || "",
            })),
          };
        } catch (error) {
          return { ok: false, error: String(error?.message || error), items: [], dir: "" };
        }
      },
    })
  );

  ctx.effect(() => () => {
    for (const dispose of toolDisposers) {
      try {
        dispose();
      } catch {}
    }
    toolDisposers.length = 0;
  });

  /* ---------------- 每轮提示：让模型见到链接就动手 ---------------- */
  const order = promptSectionOrder(ctx);
  const attached = new Set();

  const attachAgent = (agent) => {
    if (!agent?.id || attached.has(agent.id)) return;
    let prompt = null;
    try {
      prompt = agent.ctx.get("systemPrompt");
    } catch {
      prompt = null;
    }
    if (!prompt) return;
    attached.add(agent.id);
    agent.ctx.effect(() => {
      const off = agent.ctx.systemPrompt.section({
        name: "douyin-video-hint",
        order,
        interpolate: false,
        text: () => (currentConfig().autoHint ? HINT : ""),
      });
      return () => {
        try {
          off();
        } catch {}
        attached.delete(agent.id);
      };
    });
  };

  const stopCreated = ctx.on("agent/created", (payload) => attachAgent(payload?.agent));
  try {
    for (const agent of ctx.agents?.list?.() ?? []) attachAgent(agent);
  } catch {}

  const stopDisposed = ctx.on("agent/disposed", (payload) => {
    const id = payload?.agent?.id;
    if (id) attached.delete(id);
  });

  ctx.effect(() => () => {
    try {
      stopCreated();
      stopDisposed();
    } catch {}
    attached.clear();
  });
}

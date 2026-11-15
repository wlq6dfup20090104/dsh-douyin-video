#!/usr/bin/env node
// 标准 MCP server（stdio，JSON-RPC 2.0 按行分隔），零依赖。
// 任何支持 MCP 的客户端都能接：Claude Desktop / Claude Code / Cline / Cherry Studio / Continue …
//
// 接法（Claude Desktop 的 claude_desktop_config.json）：
//   { "mcpServers": { "douyin": { "command": "node", "args": ["/绝对路径/dsh-douyin-video/mcp-server.js"] } } }
import process from "node:process";
import { createInterface } from "node:readline";
import { loadConfig } from "./src/config.js";
import { inspect, fetchAll, renderFetch, summaryOf } from "./src/index.js";

const VERSION = "1.0.0";

const TOOLS = [
  {
    name: "douyin_info",
    description:
      "解析抖音分享链接/分享文案，只返回作品元信息（标题、作者、时长、大小、点赞、封面、视频还是图集），不下载。",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "抖音链接，或一整段分享文案。" },
      },
      required: ["text"],
    },
  },
  {
    name: "douyin_download",
    description:
      "把抖音分享链接下载成本地文件：视频落成 mp4（无水印直链），图集落成若干 jpg，返回绝对路径。",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "抖音链接，或包含链接的整段分享文案。" },
        dir: { type: "string", description: "可选，保存目录。不填就是 ./douyin。" },
      },
      required: ["text"],
    },
  },
];

async function callTool(name, args) {
  const config = loadConfig();
  if (name === "douyin_info") {
    const result = await inspect(String(args?.text ?? ""), { config, maxLinks: 3 });
    if (!result.ok) return "✗ " + result.error;
    return result.items
      .map((row) => {
        const p = row.parsed || {};
        if (!p.ok) return "✗ " + row.url + " —— " + (p.error || "解析失败");
        const meta = summaryOf(p);
        return "✓ " + (p.kind === "gallery" ? "【图集】" : "【视频】") + (p.title || "（无标题）")
          + "\n  作者：" + (p.author?.nickname || "未知作者")
          + (meta ? "\n  " + meta : "")
          + (p.webUrl ? "\n  " + p.webUrl : "");
      })
      .join("\n");
  }
  if (name === "douyin_download") {
    const result = await fetchAll(String(args?.text ?? ""), {
      config,
      dir: String(args?.dir || "").trim() || undefined,
      maxLinks: 3,
    });
    return renderFetch(result);
  }
  throw new Error("未知工具：" + name);
}

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

function fail(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
}

async function handle(msg) {
  const { id, method, params } = msg || {};
  if (method === undefined) return;
  if (method === "initialize") {
    reply(id, {
      protocolVersion: params?.protocolVersion || "2024-11-05",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "douyin-video", version: VERSION },
    });
    return;
  }
  if (method === "notifications/initialized" || method === "initialized") return;
  if (method === "ping") {
    reply(id, {});
    return;
  }
  if (method === "tools/list") {
    reply(id, { tools: TOOLS });
    return;
  }
  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments || {};
    try {
      const text = await callTool(name, args);
      reply(id, { content: [{ type: "text", text }], isError: false });
    } catch (error) {
      reply(id, {
        content: [{ type: "text", text: "✗ " + String(error?.message || error) }],
        isError: true,
      });
    }
    return;
  }
  if (method === "resources/list") {
    reply(id, { resources: [] });
    return;
  }
  if (method === "prompts/list") {
    reply(id, { prompts: [] });
    return;
  }
  if (id !== undefined) fail(id, -32601, "不支持的方法：" + method);
}

let pending = 0;

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const text = line.trim();
  if (!text) return;
  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    return;
  }
  pending += 1;
  handle(msg)
    .catch((error) => {
      if (msg?.id !== undefined) fail(msg.id, -32603, String(error?.message || error));
    })
    .finally(() => {
      pending -= 1;
    });
});
// stdin 关了不代表活干完了：等手上这笔工具调用写完再退，否则客户端拿到空回复。
rl.on("close", () => {
  const waitThenExit = () => {
    if (pending > 0) return setTimeout(waitThenExit, 50);
    setTimeout(() => process.exit(0), 100);
  };
  waitThenExit();
});

process.stderr.write("[douyin-video] MCP server 起来了，等客户端初始化\n");

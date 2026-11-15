#!/usr/bin/env node
// 命令行形态，不需要 DSH，也不需要装任何依赖。
//
//   node cli.js "https://v.douyin.com/xxxx/"            # 下载（存到 ./douyin/）
//   node cli.js "7.43 复制打开抖音... https://v.douyin.com/xxxx/"  # 整段分享文案也行
//   node cli.js <链接> --info                            # 只看信息，不下
//   node cli.js <链接> --out ~/视频                      # 指定目录
//   node cli.js <链接> --json                            # 输出 JSON，接脚本用
//   echo "<链接>" | node cli.js -                        # 从 stdin 读
import process from "node:process";
import { loadConfig } from "./src/config.js";
import { inspect, fetchAll, renderFetch } from "./src/index.js";

function parseArgv(argv) {
  const opts = { text: "", info: false, json: false, out: "", max: 3, help: false };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--info" || arg === "-i") opts.info = true;
    else if (arg === "--json" || arg === "-j") opts.json = true;
    else if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--out" || arg === "-o") opts.out = argv[++i] || "";
    else if (arg.startsWith("--out=")) opts.out = arg.slice(6);
    else if (arg === "--max" || arg === "-m") opts.max = Number(argv[++i]) || 3;
    else rest.push(arg);
  }
  opts.text = rest.join(" ").trim();
  return opts;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

const USAGE = `抖音链接转视频 · 命令行

用法：
  node cli.js <链接或分享文案> [选项]
  node cli.js -                 从标准输入读

选项：
  -i, --info       只解析信息，不下载
  -o, --out <目录>  保存目录（默认 ./douyin）
  -m, --max <n>    一次最多处理几个链接（默认 3）
  -j, --json       输出 JSON
  -h, --help       看这个

例子：
  node cli.js "https://v.douyin.com/iRNBqXnH/"
  node cli.js "7.43 复制打开抖音，看看【某某】... https://v.douyin.com/xxxx/" --out ~/视频
  echo "https://v.douyin.com/xxxx/" | node cli.js -
`;

async function main() {
  const opts = parseArgv(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  let text = opts.text;
  if (text === "-" || (!text && !process.stdin.isTTY)) {
    const piped = await readStdin();
    text = (text === "-" ? piped : text + "\n" + piped).trim();
  }
  if (!text) {
    process.stderr.write(USAGE);
    return 2;
  }
  const config = loadConfig();
  if (opts.info) {
    const result = await inspect(text, { config, maxLinks: opts.max });
    if (opts.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      return result.ok ? 0 : 1;
    }
    if (!result.ok) {
      process.stderr.write("✗ " + result.error + "\n");
      return 1;
    }
    for (const row of result.items) {
      const p = row.parsed || {};
      if (!p.ok) {
        process.stdout.write("✗ " + row.url + " —— " + (p.error || "解析失败") + "\n");
        continue;
      }
      process.stdout.write(
        "✓ " + (p.kind === "gallery" ? "【图集】" : "【视频】") + (p.title || "（无标题）") + "\n"
        + "  作者：" + (p.author?.nickname || "未知作者") + "\n"
        + (p.durationMs ? "  时长：" + Math.round(p.durationMs / 1000) + " 秒\n" : "")
        + (p.webUrl ? "  链接：" + p.webUrl + "\n" : "")
      );
    }
    return 0;
  }
  const result = await fetchAll(text, { config, dir: opts.out || undefined, maxLinks: opts.max });
  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return result.ok ? 0 : 1;
  }
  process.stdout.write(renderFetch(result) + "\n");
  return result.ok ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    process.stderr.write("✗ " + (error?.stack || error?.message || error) + "\n");
    process.exit(1);
  });

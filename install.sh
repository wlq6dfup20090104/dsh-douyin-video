#!/usr/bin/env bash
# 一键装：先看你这台机器上有没有 DSH，有就装成插件，没有就只留 CLI / MCP。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PROFILE="${DSH_PROFILE:-web}"

say() { printf '%s\n' "$*"; }
die() { printf '✗ %s\n' "$*" >&2; exit 1; }

say "== 抖音链接转视频 · 安装器 =="
say "目录：$HERE"

# 1. Node
command -v node >/dev/null 2>&1 || die "没找到 node。先装 Node 20 以上：https://nodejs.org/"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node 版本太老（$(node -v)），这个插件要 20 以上。"
say "✓ Node $(node -v)"

# 2. 自测
say ""
say "== 自测 =="
( cd "$HERE" && node test.mjs ) || die "自测没过，先别装。把上面的报错发给我。"

# 3. DSH 插件
say ""
if command -v dsh >/dev/null 2>&1; then
  say "== 装成 DSH 插件（profile: $PROFILE）=="
  if dsh plugin --profile "$PROFILE" add "link:$HERE"; then
    say "✓ 装好了。"
    say ""
    say "⚠️ 还差最后一步：DSH 要重启才会加载新插件。"
    say "   重启后随便打开一个会话，贴一条抖音链接试试："
    say "   https://v.douyin.com/xxxxx/"
  else
    say "✗ dsh plugin add 失败。可以只用命令行或 MCP：见下面。"
  fi
else
  say "== 这台机器上没有 dsh 命令 =="
  say "跳过了插件安装。下面两种用法不受影响。"
fi

# 4. 用法
say ""
say "== 命令行 =="
say "  node \"$HERE/cli.js\" \"https://v.douyin.com/xxxxx/\""
say "  node \"$HERE/cli.js\" \"<整段分享文案>\" --out ~/视频"
say "  node \"$HERE/cli.js\" \"<链接>\" --info      # 只看信息不下"
say "  node \"$HERE/cli.js\" \"<链接>\" --json      # 给脚本用"
say ""
say "想在任何目录直接敲 douyin-video："
say "  npm link   # 在 $HERE 里执行一次"
say ""
say "== MCP server =="
say "把这段贴进客户端的配置文件（Claude Desktop 的 claude_desktop_config.json，或 Cline / Cherry Studio 里对应的位置）："
say ""
say '  {'
say '    "mcpServers": {'
say '      "douyin": {'
say '        "command": "node",'
say '        "args": ["'"$HERE"'/mcp-server.js"]'
say '      }'
say '    }'
say '  }'
say ""
say "装完了。有解析不出来的链接，先跑 node test.mjs --net 看是不是接口挂了。"

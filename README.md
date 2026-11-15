# 抖音链接转视频

> 贴一条抖音分享链接，直接落成能播放的 **mp4**；图集落成一批 **jpg**。不带水印。

![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)
![deps](https://img.shields.io/badge/dependencies-0-blue)
![license](https://img.shields.io/badge/license-MIT-lightgrey)

同一个包，三种用法：**DSH 插件** / **命令行** / **标准 MCP server**。零依赖，不装任何 npm 包。

```bash
git clone https://github.com/wlq6dfup20090104/dsh-douyin-video.git
cd dsh-douyin-video
node test.mjs                      # 22 条自测，不联网
node cli.js "https://v.douyin.com/xxxxx/"
```

不想 clone 就下 zip：右上角 **Code → Download ZIP**。

---

## 三种用法对照

| 用法 | 适合谁 | 要装什么 |
| --- | --- | --- |
| **DSH 插件** | 用 DeepSeek Harness 的 | 一条 `dsh plugin add` |
| **命令行** | 谁都能用，脚本也行 | 只要 Node 20+ |
| **MCP server** | Claude Desktop / Claude Code / Cline / Cherry Studio | 只要 Node 20+ |

零依赖：不装 npm 包，不加任何第三方库。

---

## 一、装

解压后进目录：

```bash
bash install.sh
```

它会先检查 Node、跑一遍自测，再按这台机器上有没有 `dsh` 决定装不装插件。

### 只想手动来

```bash
# 1) DSH 插件（装完要重启 DSH 才生效）
dsh plugin --profile web add "link:/你解压的路径/dsh-douyin-video"

# 2) 命令行，随便用
node /你解压的路径/dsh-douyin-video/cli.js "https://v.douyin.com/xxxxx/"

# 3) 想全局敲 douyin-video
cd /你解压的路径/dsh-douyin-video && npm link
```

---

## 二、用

### DSH 插件

装好重启后，在会话里直接贴链接就行。模型会自己走这条路：

1. `douyin_info` —— 先看你丢的是什么（标题、作者、时长、是不是图集）
2. `douyin_download` —— 落成本地文件，回你绝对路径
3. `present` —— 把文件列出来，点开就能看

两个工具也能手动指定：

- `douyin_info({ text })` —— 只解析，不下载
- `douyin_download({ text, dir? })` —— 下载，`dir` 不填就存到当前工作区的 `douyin/`

### 命令行

```bash
# 下载（默认存 ./douyin/）
node cli.js "https://v.douyin.com/xxxxx/"

# 整段分享文案，带口令那种也行
node cli.js "7.43 复制打开抖音，看看【某某的作品】... https://v.douyin.com/xxxxx/ 复制此链接"

# 指定目录
node cli.js "https://v.douyin.com/xxxxx/" --out ~/视频

# 只看信息，不下载
node cli.js "https://v.douyin.com/xxxxx/" --info

# 输出 JSON，接自己脚本
node cli.js "https://v.douyin.com/xxxxx/" --json

# 从管道读
echo "https://v.douyin.com/xxxxx/" | node cli.js -

# 一段文字里有好几条，最多处理 3 条
node cli.js "<一堆链接>" --max 5
```

### MCP server

`claude_desktop_config.json`（Claude Code 用 `claude mcp add`，其他客户端有各自的位置）：

```json
{
  "mcpServers": {
    "douyin": {
      "command": "node",
      "args": ["/你解压的路径/dsh-douyin-video/mcp-server.js"]
    }
  }
}
```

工具名和 DSH 那边一样：`douyin_info`、`douyin_download`。

---

## 三、配置

环境变量优先，其次插件 config，最后默认值。**改完立即生效，不用重启。**

| 环境变量 | 插件 config | 默认 | 说明 |
| --- | --- | --- | --- |
| `DOUYIN_OUTPUT_DIR` | `outputDir` | 工作区 `douyin/` | 存哪儿。绝对路径。 |
| `DOUYIN_MAX_MB` | `maxMB` | `200` | 单个视频上限（MB），超了直接拒 |
| `DOUYIN_MAX_IMAGES` | `maxImages` | `20` | 图集最多下几张 |
| `DOUYIN_TIMEOUT_MS` | `timeoutMs` | `90000` | 解析超时 |
| `DOUYIN_DOWNLOAD_TIMEOUT_MS` | `downloadTimeoutMs` | `300000` | 下载超时 |
| `DOUYIN_KEEP_COVER` | `keepCover` | `false` | 顺手存封面 |
| `DOUYIN_AUTO_HINT` | `autoHint` | `true` | 要不要往每轮提示里塞「见到链接就调工具」 |
| `DOUYIN_EXTRA_APIS` | `extraApis` | 空 | 自己的解析接口，`{url}` 会在里面替换成链接，逗号分隔多个 |

DSH 插件改 config 就在 `cordis.patch.yml` 里写：

```yaml
- insert:
    - id: douyin-video
      name: dsh-douyin-video
      config:
        maxMB: 300
        outputDir: /root/视频
```

---

## 四、它是怎么做到的

抖音官方接口现在全被 `ArgusSecurityPlugin` 风控（403），分享页 SSR 里的 `video_layout` 是 null，yt-dlp 又缺 `ttwid`，都不好用。所以走两条第三方通道：

1. **主通道** `api.xingzhige.com` —— `GET /API/douyin/?url=<链接>`，免登录，约 1 秒出无水印直链
2. **回落** `api.douyin.wtf` —— 登录 demo 账号 → `POST /api/v1/parse`（202 异步）→ 轮询 `/api/v1/tasks/{id}`，内容在 `data.data`

拿到直链后带 iPhone UA + `Referer: https://www.douyin.com/` 直接下 mp4，落盘前校验 `ftyp` 头（防止拿到防盗链 HTML 冒充视频）。

同一个作品重复下不会重下：文件名用 `contentId`，已存在且非空直接复用。

---

## 五、常见问题

**解析失败 / 资源id获取失败**
链接本身可能失效（作品删了、私密、或者只是作者主页）。换一条正常的分享链接再试。接口挂了就跑 `node test.mjs --net` 看是哪条通道死了。

**视频太大（xx MB，上限 200MB）**
改 `DOUYIN_MAX_MB`。抖音一般几十 MB，200 够用。

**图集只下了一部分**
默认上限 20 张，改 `DOUYIN_MAX_IMAGES`。

**想先看看是什么再决定下不下**
用 `--info`（或者 `douyin_info`）。它只解析，不占流量。

**节点/代理环境**
插件走的是 `fetch`，不吃系统代理。要走代理自己设 `HTTPS_PROXY`，或者用 `extraApis` 换成你能访问的接口。

**给别的程序用**
`--json` 输出是稳定结构：`{ ok, dir, items: [{ ok, kind, title, author, videoPath, videoBytes, images, error }] }`。

---

## 六、自测

```bash
node test.mjs          # 22 条纯逻辑，不联网
node test.mjs --net    # 顺带打一次真链接
```

---

MIT。随便改，随便传。

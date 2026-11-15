// 配置：环境变量 > 插件 config > 默认值。改了不用重启（每次调用现读）。
import os from "node:os";
import path from "node:path";

export const DEFAULTS = {
  /** 下载目录。空字符串 = 用会话工作区下的 douyin/，拿不到工作区就落到 ~/douyin-videos */
  outputDir: "",
  /** 单个视频上限（MB） */
  maxMB: 200,
  /** 解析超时（毫秒） */
  timeoutMs: 90_000,
  /** 下载超时（毫秒） */
  downloadTimeoutMs: 300_000,
  /** 图集最多下几张 */
  maxImages: 20,
  /** 是否把封面也存一份 */
  keepCover: false,
  /** 自定义解析接口，{url} 会被替换成编码后的抖音链接；逗号分隔多个 */
  extraApis: "",
  /** 是否往每轮提示里塞「见到抖音链接就调工具」那句 */
  autoHint: true,
};

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function bool(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const s = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on", "y"].includes(s)) return true;
  if (["0", "false", "no", "off", "n"].includes(s)) return false;
  return fallback;
}

/** 把插件 config / 环境变量揉成一份配置。每次调用都现算，改配置立即生效。 */
export function loadConfig(pluginConfig = {}, env = process.env) {
  const c = pluginConfig && typeof pluginConfig === "object" ? pluginConfig : {};
  const pick = (pluginKey, envKey) => {
    if (env[envKey] !== undefined && env[envKey] !== "") return env[envKey];
    return c[pluginKey];
  };
  return {
    outputDir: String(pick("outputDir", "DOUYIN_OUTPUT_DIR") ?? DEFAULTS.outputDir).trim(),
    maxMB: num(pick("maxMB", "DOUYIN_MAX_MB"), DEFAULTS.maxMB),
    timeoutMs: num(pick("timeoutMs", "DOUYIN_TIMEOUT_MS"), DEFAULTS.timeoutMs),
    downloadTimeoutMs: num(pick("downloadTimeoutMs", "DOUYIN_DOWNLOAD_TIMEOUT_MS"), DEFAULTS.downloadTimeoutMs),
    maxImages: num(pick("maxImages", "DOUYIN_MAX_IMAGES"), DEFAULTS.maxImages),
    keepCover: bool(pick("keepCover", "DOUYIN_KEEP_COVER"), DEFAULTS.keepCover),
    extraApis: String(pick("extraApis", "DOUYIN_EXTRA_APIS") ?? DEFAULTS.extraApis).trim(),
    autoHint: bool(pick("autoHint", "DOUYIN_AUTO_HINT"), DEFAULTS.autoHint),
  };
}

/** 决定文件落哪儿：显式配置 > 会话工作区 > 家目录。 */
export function resolveOutputDir(configured, sessionCwd) {
  if (configured) return path.resolve(configured);
  if (sessionCwd) return path.join(path.resolve(sessionCwd), "douyin");
  return path.join(os.homedir(), "douyin-videos");
}

/** 从工具执行上下文里尽量捞出会话工作目录；捞不到就空串。 */
export function cwdOfExec(exec) {
  const agent = exec?.agent ?? exec?.caller ?? null;
  const candidates = [
    exec?.cwd,
    exec?.workspace?.cwd,
    agent?.cwd,
    agent?.session?.cwd,
    agent?.session?.header?.cwd,
    agent?.session?.header?.workspace?.cwd,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

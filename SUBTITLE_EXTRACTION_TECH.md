# YouTube 字幕稳定提取技术 - 完整复刻指南

> **本文档基于参考项目 `0REFER/1.5.0_0` 的逆向分析，提供可直接复刻的完整技术实现。**
> 所有代码已从混淆代码中还原为可读版本，并添加详细注释。

---

## 目录

1. [技术背景](#一技术背景)
2. [提取策略总览](#二提取策略总览)
3. [方法一：Timedtext API 提取](#三方法一timedtext-api-提取主要方法)
4. [方法二：DOM Transcript 面板解析](#四方法二dom-transcript-面板解析备用方案)
5. [方法三：YouTubei Internal API](#五方法三youtubei-internal-api最后手段)
6. [数据规范化处理](#六数据规范化处理)
7. [完整提取流程实现](#七完整提取流程实现)
8. [错误处理与重试机制](#八错误处理与重试机制)
9. [特殊场景处理](#九特殊场景处理)
10. [稳定性保障措施](#十稳定性保障措施)
11. [完整可复刻代码汇总](#十一完整可复刻代码汇总)
12. [关键选择器参考表](#十二关键选择器参考表)

---

## 一、技术背景

### 1.1 YouTube 字幕系统架构

YouTube 的字幕系统由以下几个部分组成：

```
┌─────────────────────────────────────────────────────────────┐
│                    YouTube 字幕系统                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────┐    ┌─────────────────┐                │
│  │   人工上传字幕   │    │  自动生成字幕   │                │
│  │  (Manual CC)    │    │    (ASR)        │                │
│  └────────┬────────┘    └────────┬────────┘                │
│           │                      │                          │
│           ▼                      ▼                          │
│  ┌─────────────────────────────────────────┐               │
│  │         字幕存储服务器                    │               │
│  │    (Timedtext API Backend)              │               │
│  └────────────────────┬────────────────────┘               │
│                       │                                     │
│           ┌───────────┴───────────┐                        │
│           ▼                       ▼                        │
│  ┌─────────────────┐    ┌─────────────────┐               │
│  │  Timedtext API  │    │  Internal API   │               │
│  │  (公开端点)      │    │  (youtubei)     │               │
│  └─────────────────┘    └─────────────────┘               │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 字幕数据在页面中的存在形式

YouTube 页面加载时，字幕相关数据存在于三个位置：

| 位置 | 数据对象 | 包含信息 |
|------|---------|---------|
| Script 标签 | `ytInitialPlayerResponse` | 字幕轨道URL、视频元信息 |
| Script 标签 | `ytInitialData` | 转录面板参数、engagement panels |
| DOM 元素 | Transcript Panel | 已渲染的字幕文本（需点击展开） |

### 1.3 YouTube 的反爬措施

YouTube 在2024年加强了字幕保护：

1. **POT (Proof of Origin Token)** - 必须携带有效 token 才能访问 Timedtext API
2. **签名验证** - API 请求需要特定的签名参数
3. **频率限制** - 短时间大量请求会被封禁
4. **动态渲染** - 部分数据通过 JavaScript 动态加载

---

## 二、提取策略总览

### 2.1 多层降级策略

为保证稳定性，采用**三层降级策略**：

```
┌─────────────────────────────────────────────────────────────┐
│                     字幕提取请求                             │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  第一层：Timedtext API + POT Token                          │
│  - 最快、最完整                                              │
│  - 成功率: ~90%                                              │
└─────────────────────────┬───────────────────────────────────┘
                          │ 失败
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  第二层：DOM Transcript 面板解析                             │
│  - 需要模拟用户交互                                          │
│  - 成功率: ~85%                                              │
└─────────────────────────┬───────────────────────────────────┘
                          │ 失败
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  第三层：YouTubei Internal API                               │
│  - 需要构造复杂请求体                                        │
│  - 成功率: ~80%                                              │
└─────────────────────────┬───────────────────────────────────┘
                          │ 失败
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  返回错误：该视频没有可用字幕                                 │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 各方法优劣对比

| 方法 | 优点 | 缺点 | 适用场景 |
|------|------|------|---------|
| Timedtext API | 速度快、数据完整、格式规范 | 需要 POT token | 首选方法 |
| DOM 解析 | 不需要 token、稳定 | 需要等待 DOM 渲染、速度慢 | API 失败时的备选 |
| Internal API | 不需要 POT | 请求体复杂、可能被封 | 最后手段 |

---

## 三、方法一：Timedtext API 提取（主要方法）

### 3.1 整体流程

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  提取页面数据 │ -> │  获取字幕URL │ -> │  获取POT     │ -> │  请求字幕    │
│              │    │              │    │  Token       │    │  数据        │
└──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
```

### 3.2 步骤1：提取页面嵌入数据

YouTube 页面的 `<script>` 标签中包含 JSON 格式的视频数据：

```javascript
/**
 * 从页面 HTML 中提取 YouTube 数据对象
 *
 * YouTube 在页面中以多种方式声明这些变量：
 * - window["ytInitialPlayerResponse"] = {...};
 * - var ytInitialPlayerResponse = {...};
 * - ytInitialPlayerResponse = {...};
 *
 * @param {string} html - 页面 HTML 内容
 * @param {string} key - 要提取的数据键名
 * @returns {Object} 解析后的 JSON 对象
 * @throws {Error} 如果找不到指定的数据
 */
function extractYtData(html, key) {
  // 定义多种可能的声明模式
  const patterns = [
    // 模式1: window["key"] = {...};
    new RegExp(`window\\["${key}"\\]\\s*=\\s*({[\\s\\S]+?})\\s*;`),
    // 模式2: var key = {...};
    new RegExp(`var ${key}\\s*=\\s*({[\\s\\S]+?})\\s*;`),
    // 模式3: key = {...};
    new RegExp(`${key}\\s*=\\s*({[\\s\\S]+?})\\s*;`)
  ];

  for (const regex of patterns) {
    const match = html.match(regex);
    if (match && match[1]) {
      try {
        return JSON.parse(match[1]);
      } catch (parseError) {
        console.warn(`解析 ${key} 失败:`, parseError.message);
        continue; // 尝试下一个模式
      }
    }
  }

  throw new Error(`页面中未找到 ${key} 数据`);
}

/**
 * 从当前页面或通过 fetch 获取页面数据
 * @param {string} url - 视频 URL
 * @returns {Promise<Object>} 包含 title, ytData, dataKey, resolvedType 的对象
 */
async function fetchVideoPageData(url) {
  // 获取页面 HTML
  const html = await fetch(url).then(response => response.text());

  // 优先尝试提取 ytInitialData（包含转录面板参数）
  try {
    const ytInitialData = extractYtData(html, "ytInitialData");

    // 提取视频标题
    const title = ytInitialData?.videoDetails?.title ||
                  ytInitialData?.playerOverlays
                    ?.playerOverlayRenderer
                    ?.videoDetails
                    ?.playerOverlayVideoDetailsRenderer
                    ?.title?.simpleText ||
                  "未知标题";

    // 检查是否有转录面板（说明有字幕）
    const hasTranscriptPanel = ytInitialData?.engagementPanels?.some(
      panel => panel.engagementPanelSectionListRenderer
        ?.content
        ?.continuationItemRenderer
        ?.continuationEndpoint
        ?.getTranscriptEndpoint
    );

    if (hasTranscriptPanel) {
      return {
        title,
        ytData: ytInitialData,
        dataKey: "ytInitialData",
        resolvedType: "regular"
      };
    }
  } catch (e) {
    console.warn("提取 ytInitialData 失败:", e);
  }

  // 降级：提取 ytInitialPlayerResponse
  try {
    const playerResponse = extractYtData(html, "ytInitialPlayerResponse");

    const title = playerResponse?.videoDetails?.title ||
                  playerResponse?.microformat
                    ?.playerMicroformatRenderer
                    ?.title?.simpleText ||
                  "未知标题";

    return {
      title,
      ytData: playerResponse,
      dataKey: "ytInitialPlayerResponse",
      resolvedType: "shorts" // 通常 Shorts 视频走这个分支
    };
  } catch (e) {
    throw new Error("无法获取视频数据，视频可能是私密的或已被删除");
  }
}
```

### 3.3 步骤2：获取字幕轨道 URL

从 `ytInitialPlayerResponse` 中提取字幕 URL：

```javascript
/**
 * ytInitialPlayerResponse 中的字幕数据结构示例：
 *
 * {
 *   "captions": {
 *     "playerCaptionsTracklistRenderer": {
 *       "captionTracks": [
 *         {
 *           "baseUrl": "https://www.youtube.com/api/timedtext?v=xxx&...",
 *           "name": { "simpleText": "English" },
 *           "vssId": ".en",
 *           "languageCode": "en",
 *           "kind": "asr",        // "asr" = 自动生成，无此字段 = 人工字幕
 *           "isTranslatable": true
 *         },
 *         {
 *           "baseUrl": "https://www.youtube.com/api/timedtext?v=xxx&lang=zh-Hans...",
 *           "name": { "simpleText": "Chinese (Simplified)" },
 *           "vssId": ".zh-Hans",
 *           "languageCode": "zh-Hans",
 *           "isTranslatable": true
 *         }
 *       ],
 *       "translationLanguages": [
 *         { "languageCode": "en", "languageName": { "simpleText": "English" } },
 *         ...
 *       ]
 *     }
 *   }
 * }
 */

/**
 * 获取字幕轨道 URL
 * @param {Object} ytData - YouTube 数据对象
 * @param {string} preferredLang - 首选语言代码（可选）
 * @returns {string|null} 字幕 baseUrl 或 null
 */
function getCaptionTrackUrl(ytData, preferredLang = null) {
  const tracks = ytData?.captions
    ?.playerCaptionsTracklistRenderer
    ?.captionTracks;

  if (!tracks || tracks.length === 0) {
    return null;
  }

  // 优先级排序：
  // 1. 首选语言的人工字幕
  // 2. 首选语言的自动字幕
  // 3. 任意人工字幕
  // 4. 任意自动字幕

  let selectedTrack = null;

  if (preferredLang) {
    // 查找首选语言的人工字幕
    selectedTrack = tracks.find(
      t => t.languageCode === preferredLang && !t.kind
    );

    // 查找首选语言的自动字幕
    if (!selectedTrack) {
      selectedTrack = tracks.find(
        t => t.languageCode === preferredLang
      );
    }
  }

  // 查找任意人工字幕（优先）
  if (!selectedTrack) {
    selectedTrack = tracks.find(t => !t.kind);
  }

  // 使用第一个可用字幕
  if (!selectedTrack) {
    selectedTrack = tracks[0];
  }

  return selectedTrack?.baseUrl || null;
}

/**
 * 从页面脚本中直接提取字幕 URL（备用方法）
 * 有时 ytInitialPlayerResponse 未正确加载，但页面脚本中有数据
 * @returns {string|null} 字幕 URL 或 null
 */
function extractCaptionUrlFromPageScripts() {
  try {
    const scripts = document.querySelectorAll("script");

    for (const script of scripts) {
      const content = script.textContent || "";

      // 方法1：从 ytInitialPlayerResponse 中提取
      if (content.includes("ytInitialPlayerResponse")) {
        const match = content.match(
          /ytInitialPlayerResponse\s*=\s*(\{.+?\});\s*(?:var|let|const|<\/script>)/s
        );
        if (match) {
          const data = JSON.parse(match[1]);
          const url = data?.captions
            ?.playerCaptionsTracklistRenderer
            ?.captionTracks?.[0]
            ?.baseUrl;
          if (url) return url;
        }
      }

      // 方法2：直接搜索 timedtext URL
      if (content.includes('"baseUrl"') && content.includes("timedtext")) {
        const match = content.match(
          /"baseUrl"\s*:\s*"(https:\/\/www\.youtube\.com\/api\/timedtext[^"]+)"/
        );
        if (match) {
          // 解码 Unicode 转义
          return match[1].replace(/\\u0026/g, "&");
        }
      }
    }
  } catch (error) {
    console.warn("从页面脚本提取字幕URL失败:", error);
  }

  return null;
}
```

### 3.4 步骤3：POT Token 获取（核心技术）

**这是整个字幕提取最关键的技术点。**

#### 3.4.1 POT Token 原理

```
┌─────────────────────────────────────────────────────────────┐
│                    POT Token 获取原理                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. 用户点击字幕按钮 (CC)                                     │
│           │                                                  │
│           ▼                                                  │
│  2. YouTube 播放器发起字幕请求                                │
│           │                                                  │
│           ▼                                                  │
│  3. 请求 URL 中包含 pot=xxx 参数                             │
│           │                                                  │
│           ▼                                                  │
│  4. 我们通过 Performance API 捕获这个请求                    │
│           │                                                  │
│           ▼                                                  │
│  5. 从 URL 中提取 pot 参数值                                 │
│           │                                                  │
│           ▼                                                  │
│  6. 使用该 token 发起我们自己的请求                          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

#### 3.4.2 完整实现代码

```javascript
/**
 * POT Token 缓存
 * 使用 Map 存储，避免重复获取
 */
const potTokenCache = new Map();

/**
 * 字幕按钮选择器
 * YouTube 有多种布局，需要兼容
 */
const CC_BUTTON_SELECTORS = [
  // 新版布局
  "#movie_player > div.ytp-chrome-bottom > div.ytp-chrome-controls > " +
    "div.ytp-right-controls > button.ytp-subtitles-button.ytp-button",
  // 旧版布局
  "#movie_player > div.ytp-chrome-bottom > div.ytp-chrome-controls > " +
    "div.ytp-right-controls > div.ytp-right-controls-left > " +
    "button.ytp-subtitles-button.ytp-button"
];

/**
 * 查找字幕按钮元素
 * @returns {HTMLElement|null} 字幕按钮元素
 */
function findCCButton() {
  for (const selector of CC_BUTTON_SELECTORS) {
    const button = document.querySelector(selector);
    if (button) return button;
  }
  return null;
}

/**
 * 获取 POT (Proof of Origin Token)
 *
 * 实现原理：
 * 1. 清空 Performance 计时器，准备捕获新请求
 * 2. 模拟点击字幕按钮，触发 YouTube 的真实字幕请求
 * 3. 使用 Performance API 监听所有网络请求
 * 4. 找到 timedtext 请求后，从 URL 中提取 pot 参数
 *
 * @param {string} videoId - 视频 ID，用于缓存
 * @returns {Promise<string>} POT token 字符串，失败返回空字符串
 */
async function getPOToken(videoId = "") {
  const cacheKey = `yt-caption-potoken-${videoId}`;

  // 检查缓存
  if (potTokenCache.has(cacheKey)) {
    return potTokenCache.get(cacheKey);
  }

  try {
    // 查找字幕按钮
    const ccButton = findCCButton();

    if (!ccButton) {
      console.warn("未找到字幕按钮，视频可能没有字幕");
      return "";
    }

    // 清空性能计时器，只捕获接下来的请求
    performance.clearResourceTimings();

    // 创建 Promise 来等待 token
    const tokenPromise = new Promise((resolve) => {
      // 设置一次性点击监听器
      ccButton.addEventListener("click", async () => {
        // 轮询检查 timedtext 请求
        for (let elapsed = 0; elapsed <= 500; elapsed += 50) {
          await sleep(50);

          // 获取所有资源请求
          const entries = performance.getEntriesByType("resource");

          // 筛选 timedtext 请求
          const timedtextEntries = entries.filter(
            entry => entry.name.includes("/api/timedtext?")
          );

          if (timedtextEntries.length > 0) {
            // 获取最新的请求
            const latestEntry = timedtextEntries[timedtextEntries.length - 1];

            try {
              const url = new URL(latestEntry.name);
              const pot = url.searchParams.get("pot");

              if (pot) {
                potTokenCache.set(cacheKey, pot);
                resolve(pot);
                return;
              }
            } catch (e) {
              console.warn("解析 timedtext URL 失败:", e);
            }
          }
        }

        // 超时，返回空
        resolve("");
      }, { once: true });
    });

    // 模拟双击字幕按钮
    // 第一次点击：如果字幕关闭则打开
    // 第二次点击：恢复原状态
    // 这样做是为了触发请求同时不改变用户的字幕显示状态
    ccButton.click();
    ccButton.click();

    // 等待 token 获取完成（最多 500ms + 额外等待）
    await sleep(350);

    return await tokenPromise;

  } catch (error) {
    console.error("获取 POT token 失败:", error);
    return "";
  }
}

/**
 * 辅助函数：延时
 * @param {number} ms - 毫秒数
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

#### 3.4.3 POT 获取的关键点

| 要点 | 说明 |
|------|------|
| Performance API | 唯一能捕获页面内部网络请求的方法 |
| 双击策略 | 避免改变用户的字幕显示状态 |
| 一次性监听器 | `{ once: true }` 避免重复触发 |
| 轮询机制 | 请求可能有延迟，需要持续检查 |
| 缓存机制 | 同一视频的 token 可以复用 |

### 3.5 步骤4：请求字幕数据

```javascript
/**
 * 使用 Timedtext API 获取字幕
 *
 * @param {string} baseUrl - 从 ytInitialPlayerResponse 获取的基础 URL
 * @param {string} videoId - 视频 ID
 * @returns {Promise<Array>} 字幕事件数组
 */
async function fetchTimedtextAPI(baseUrl, videoId) {
  // 获取 POT token
  const pot = await getPOToken(videoId);

  // 构建完整 URL
  // fmt=json3: 返回结构化 JSON 数据
  // c=WEB: 标识 Web 客户端
  const separator = baseUrl.includes("?") ? "&" : "?";
  const url = pot
    ? `${baseUrl}${separator}fmt=json3&pot=${pot}&c=WEB`
    : `${baseUrl}${separator}fmt=json3`;

  console.log("请求字幕 URL:", url);

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Timedtext API 返回错误: ${response.status}`);
  }

  const data = await response.json();

  if (!data.events || data.events.length === 0) {
    throw new Error("Timedtext API 返回空数据");
  }

  return data.events;
}

/**
 * Timedtext API 返回数据格式 (fmt=json3)：
 *
 * {
 *   "wireMagic": "pb3",
 *   "events": [
 *     {
 *       "tStartMs": 1000,        // 开始时间（毫秒）
 *       "dDurationMs": 3500,     // 持续时间（毫秒）
 *       "segs": [                // 文本片段数组
 *         {
 *           "utf8": "Hello ",    // UTF-8 编码的文本
 *           "acAsrConf": 0       // ASR 置信度（仅自动字幕）
 *         },
 *         {
 *           "utf8": "world"
 *         }
 *       ],
 *       "wWinId": 1              // 窗口 ID（用于定位）
 *     },
 *     {
 *       "tStartMs": 4500,
 *       "dDurationMs": 2000,
 *       "segs": [
 *         { "utf8": "This is a test" }
 *       ]
 *     },
 *     // 注意：有些事件没有 segs，只是用于格式控制
 *     {
 *       "tStartMs": 6500,
 *       "dDurationMs": 0
 *       // 无 segs，跳过此事件
 *     }
 *   ]
 * }
 */
```

---

## 四、方法二：DOM Transcript 面板解析（备用方案）

当 Timedtext API 失败时，可以通过解析页面的转录面板获取字幕。

### 4.1 工作原理

```
┌─────────────────────────────────────────────────────────────┐
│                  DOM 解析工作流程                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. 查找"显示转录"按钮                                        │
│           │                                                  │
│           ▼                                                  │
│  2. 模拟点击，打开转录面板                                    │
│           │                                                  │
│           ▼                                                  │
│  3. 等待面板内容加载完成                                      │
│           │                                                  │
│           ▼                                                  │
│  4. 遍历所有字幕片段 DOM 元素                                 │
│           │                                                  │
│           ▼                                                  │
│  5. 提取时间戳和文本                                          │
│           │                                                  │
│           ▼                                                  │
│  6. 返回结构化数据                                            │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 完整实现

```javascript
/**
 * "显示转录"按钮的可能选择器
 * YouTube 界面经常变化，需要兼容多种情况
 */
const TRANSCRIPT_BUTTON_SELECTORS = [
  // 视频描述区域的按钮
  'button[aria-label="Show transcript"]',
  '#button[aria-label="Show transcript"]',
  // 展开的描述区域
  'ytd-video-description-transcript-section-renderer #primary-button button',
  // 其他可能的位置
  '#primary-button > ytd-button-renderer > yt-button-shape > button'
];

/**
 * 字幕片段容器选择器
 */
const TRANSCRIPT_SEGMENTS_SELECTOR =
  "#segments-container > ytd-transcript-segment-renderer";

/**
 * 等待 DOM 元素出现
 *
 * 使用 MutationObserver 监听 DOM 变化，比轮询更高效
 *
 * @param {string} selector - CSS 选择器
 * @param {number} timeout - 超时时间（毫秒）
 * @returns {Promise<boolean>} 是否成功找到元素
 */
function waitForElement(selector, timeout = 3000) {
  return new Promise((resolve) => {
    // 元素已存在，直接返回
    const existing = document.querySelector(selector);
    if (existing) {
      return resolve(true);
    }

    // 创建 MutationObserver
    const observer = new MutationObserver((mutations, obs) => {
      const element = document.querySelector(selector);
      if (element) {
        obs.disconnect();
        resolve(true);
      }
    });

    // 开始观察
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // 超时处理
    setTimeout(() => {
      observer.disconnect();
      resolve(false);
    }, timeout);
  });
}

/**
 * 解析时间戳字符串
 *
 * 支持格式：
 * - "1:23" (MM:SS)
 * - "1:23:45" (HH:MM:SS)
 *
 * @param {string} timeStr - 时间戳字符串
 * @returns {number} 毫秒数
 */
function parseTimestamp(timeStr) {
  if (!timeStr) return 0;

  const parts = timeStr.trim().split(":").map(Number);

  if (parts.length === 2) {
    // MM:SS
    const [minutes, seconds] = parts;
    return (minutes * 60 + seconds) * 1000;
  }

  if (parts.length === 3) {
    // HH:MM:SS
    const [hours, minutes, seconds] = parts;
    return (hours * 3600 + minutes * 60 + seconds) * 1000;
  }

  return 0;
}

/**
 * 从 DOM 提取字幕
 *
 * @returns {Promise<Array|null>} 字幕数组或 null
 */
async function extractFromDOM() {
  // 步骤1: 查找"显示转录"按钮
  let transcriptButton = null;

  for (const selector of TRANSCRIPT_BUTTON_SELECTORS) {
    transcriptButton = document.querySelector(selector);
    if (transcriptButton) {
      console.log("找到转录按钮:", selector);
      break;
    }
  }

  if (!transcriptButton) {
    console.warn("未找到转录按钮");
    return null;
  }

  // 步骤2: 点击按钮打开转录面板
  transcriptButton.click();

  // 步骤3: 等待转录内容加载
  const loaded = await waitForElement(TRANSCRIPT_SEGMENTS_SELECTOR, 3000);

  if (!loaded) {
    console.warn("转录面板加载超时");
    return null;
  }

  // 额外等待，确保内容完全渲染
  await sleep(300);

  // 步骤4: 提取所有字幕片段
  const segments = document.querySelectorAll(TRANSCRIPT_SEGMENTS_SELECTOR);

  if (!segments.length) {
    console.warn("未找到字幕片段");
    return null;
  }

  console.log(`找到 ${segments.length} 个字幕片段`);

  // 步骤5: 解析每个片段
  const transcript = [];

  segments.forEach((segment, index) => {
    // 提取时间戳
    const timestampEl = segment.querySelector("div.segment-timestamp");
    const timestamp = timestampEl?.textContent?.trim() || "";

    // 提取文本内容
    const textEl = segment.querySelector("yt-formatted-string");
    const text = textEl?.textContent?.trim() || "";

    // 跳过空内容
    if (!text) {
      return;
    }

    transcript.push({
      tStartMs: parseTimestamp(timestamp),
      segs: [{ utf8: text }]
    });
  });

  if (transcript.length === 0) {
    console.warn("提取的字幕内容为空");
    return null;
  }

  console.log(`成功提取 ${transcript.length} 条字幕`);
  return transcript;
}

/**
 * DOM 结构示例：
 *
 * <div id="segments-container">
 *   <ytd-transcript-segment-renderer>
 *     <div class="segment-start-offset">
 *       <div class="segment-timestamp">0:01</div>
 *     </div>
 *     <dom-if>
 *       <template>...</template>
 *     </dom-if>
 *     <yt-formatted-string class="segment-text">
 *       Hello world, this is the subtitle text.
 *     </yt-formatted-string>
 *   </ytd-transcript-segment-renderer>
 *   ...
 * </div>
 */
```

### 4.3 DOM 方法的注意事项

| 注意点 | 说明 |
|--------|------|
| 按钮位置变化 | YouTube 经常更新 UI，需要维护多个选择器 |
| 加载时间 | 转录面板需要网络请求，要有足够等待时间 |
| 渲染延迟 | DOM 元素出现后，内容可能还在填充 |
| 语言设置 | 按钮文本可能因语言不同而变化 |
| 已打开状态 | 如果面板已打开，点击会关闭它 |

---

## 五、方法三：YouTubei Internal API（最后手段）

### 5.1 API 端点说明

```
POST https://www.youtube.com/youtubei/v1/get_transcript

这是 YouTube 的内部 API，用于获取视频转录内容。
它不需要 POT token，但需要构造正确的请求体。
```

### 5.2 完整实现

```javascript
/**
 * 生成模拟的客户端版本号
 *
 * YouTube 客户端版本格式: 2.YYYYMMDD.00.00
 * 使用最近30天内的随机日期，避免被识别为异常请求
 *
 * @returns {string} 客户端版本字符串
 */
function generateClientVersion() {
  const dates = [];
  const today = new Date();

  for (let i = 0; i < 30; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    // 格式化为 YYYYMMDD
    const formatted = date.toISOString().split("T")[0].replace(/-/g, "");
    dates.push(formatted);
  }

  // 随机选择一个日期
  const randomDate = dates[Math.floor(Math.random() * dates.length)];
  return `2.${randomDate}.00.00`;
}

/**
 * 从 ytInitialData 中提取转录参数
 *
 * @param {Object} ytData - ytInitialData 对象
 * @returns {string|null} base64 编码的参数字符串
 */
function extractTranscriptParams(ytData) {
  // 遍历 engagementPanels 查找转录面板
  const panels = ytData?.engagementPanels || [];

  for (const panel of panels) {
    const params = panel
      ?.engagementPanelSectionListRenderer
      ?.content
      ?.continuationItemRenderer
      ?.continuationEndpoint
      ?.getTranscriptEndpoint
      ?.params;

    if (params) {
      return params;
    }
  }

  return null;
}

/**
 * 通过 YouTubei Internal API 获取字幕
 *
 * @param {Object} ytData - ytInitialData 对象
 * @returns {Promise<Array>} 字幕片段数组
 */
async function fetchViaInternalAPI(ytData) {
  // 步骤1: 提取必要参数
  const params = extractTranscriptParams(ytData);

  if (!params) {
    throw new Error("无法从 ytInitialData 中提取转录参数");
  }

  // 步骤2: 提取上下文信息
  const hl = ytData?.topbar
    ?.desktopTopbarRenderer
    ?.searchbox
    ?.fusionSearchboxRenderer
    ?.config
    ?.webSearchboxConfig
    ?.requestLanguage || "en";

  const visitorData = ytData?.responseContext
    ?.webResponseContextExtensionData
    ?.ytConfigData
    ?.visitorData || "";

  // 步骤3: 构建请求体
  const payload = {
    context: {
      client: {
        hl: hl,                              // 界面语言
        visitorData: visitorData,            // 访客标识
        clientName: "WEB",                   // 客户端类型
        clientVersion: generateClientVersion() // 客户端版本
      },
      request: {
        useSsl: true
      }
    },
    params: params  // base64 编码的转录参数
  };

  console.log("Internal API 请求体:", payload);

  // 步骤4: 发送请求
  const response = await fetch(
    "https://www.youtube.com/youtubei/v1/get_transcript?prettyPrint=false",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }
  );

  if (!response.ok) {
    throw new Error(`Internal API 返回错误: ${response.status}`);
  }

  const data = await response.json();

  // 步骤5: 提取字幕数据
  // Internal API 返回的数据结构较深层嵌套
  const segments = data?.actions?.[0]
    ?.updateEngagementPanelAction
    ?.content
    ?.transcriptRenderer
    ?.content
    ?.transcriptSearchPanelRenderer
    ?.body
    ?.transcriptSegmentListRenderer
    ?.initialSegments || [];

  if (segments.length === 0) {
    throw new Error("Internal API 返回空数据");
  }

  console.log(`Internal API 返回 ${segments.length} 个字幕片段`);
  return segments;
}

/**
 * Internal API 返回数据结构：
 *
 * {
 *   "actions": [
 *     {
 *       "updateEngagementPanelAction": {
 *         "content": {
 *           "transcriptRenderer": {
 *             "content": {
 *               "transcriptSearchPanelRenderer": {
 *                 "body": {
 *                   "transcriptSegmentListRenderer": {
 *                     "initialSegments": [
 *                       {
 *                         "transcriptSegmentRenderer": {
 *                           "startMs": "1000",
 *                           "endMs": "4000",
 *                           "startTimeText": {
 *                             "simpleText": "0:01"
 *                           },
 *                           "snippet": {
 *                             "runs": [
 *                               { "text": "Hello world" }
 *                             ]
 *                           },
 *                           "targetId": "..."
 *                         }
 *                       },
 *                       ...
 *                     ]
 *                   }
 *                 },
 *                 "header": {...},
 *                 "footer": {...}
 *               }
 *             }
 *           }
 *         },
 *         "targetId": "..."
 *       }
 *     }
 *   ],
 *   "responseContext": {...}
 * }
 */
```

---

## 六、数据规范化处理

### 6.1 为什么需要规范化

三种提取方法返回的数据格式不同：

| 方法 | 时间格式 | 文本格式 |
|------|---------|---------|
| Timedtext API | `tStartMs` (毫秒数) | `segs` 数组 |
| DOM 解析 | 字符串 "M:SS" | 单个字符串 |
| Internal API | `startMs` (字符串) | `snippet.runs` 数组 |

### 6.2 规范化实现

```javascript
/**
 * 统一的字幕数据格式
 *
 * @typedef {Object} NormalizedCaption
 * @property {string} timestamp - 格式化的时间戳 "M:SS" 或 "H:MM:SS"
 * @property {string} text - 字幕文本
 */

/**
 * 将毫秒转换为时间戳字符串
 *
 * @param {number} ms - 毫秒数
 * @returns {string} 格式化的时间戳
 */
function formatMilliseconds(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * 规范化 Timedtext API 数据
 *
 * @param {Array} events - Timedtext API 返回的 events 数组
 * @returns {Array<NormalizedCaption>} 规范化后的字幕数组
 */
function normalizeTimedtextData(events) {
  return events
    // 过滤掉没有 segs 的事件（格式控制事件）
    .filter(event => event.segs && event.segs.length > 0)
    .map(event => ({
      timestamp: formatMilliseconds(event.tStartMs || 0),
      text: event.segs
        .map(seg => seg.utf8 || "")
        .join("")
        .replace(/\n/g, " ")  // 移除换行
        .trim()
    }))
    // 过滤空文本
    .filter(item => item.text.length > 0);
}

/**
 * 规范化 Internal API 数据
 *
 * @param {Array} segments - Internal API 返回的 segments 数组
 * @returns {Array<NormalizedCaption>} 规范化后的字幕数组
 */
function normalizeInternalAPIData(segments) {
  return segments
    .filter(segment => segment.transcriptSegmentRenderer)
    .map(segment => {
      const renderer = segment.transcriptSegmentRenderer;
      return {
        timestamp: renderer.startTimeText?.simpleText || "",
        text: (renderer.snippet?.runs || [])
          .map(run => run.text || "")
          .join("")
          .trim()
      };
    })
    .filter(item => item.text.length > 0);
}

/**
 * 规范化 DOM 解析数据
 *
 * @param {Array} items - DOM 解析返回的数组
 * @returns {Array<NormalizedCaption>} 规范化后的字幕数组
 */
function normalizeDOMData(items) {
  return items.map(item => ({
    timestamp: formatMilliseconds(item.tStartMs || 0),
    text: (item.segs || [])
      .map(seg => seg.utf8 || "")
      .join("")
      .trim()
  })).filter(item => item.text.length > 0);
}

/**
 * 统一的规范化入口
 *
 * @param {Array} data - 原始字幕数据
 * @param {string} source - 数据来源 ("timedtext" | "internal" | "dom")
 * @returns {Array<NormalizedCaption>} 规范化后的字幕数组
 */
function normalizeTranscript(data, source) {
  if (!data || data.length === 0) {
    return [];
  }

  // 自动检测数据类型
  const firstItem = data[0];

  // Timedtext API 格式：有 tStartMs 和 segs
  if (firstItem.tStartMs !== undefined && firstItem.segs) {
    return normalizeTimedtextData(data);
  }

  // Internal API 格式：有 transcriptSegmentRenderer
  if (firstItem.transcriptSegmentRenderer) {
    return normalizeInternalAPIData(data);
  }

  // 已经是规范化格式或 DOM 格式
  if (firstItem.timestamp !== undefined || firstItem.tStartMs !== undefined) {
    return normalizeDOMData(data);
  }

  console.warn("未知的数据格式:", firstItem);
  return [];
}
```

### 6.3 规范化后的数据示例

```javascript
// 输入（Timedtext API 格式）
const timedtextData = [
  {
    tStartMs: 1000,
    dDurationMs: 3000,
    segs: [{ utf8: "Hello " }, { utf8: "world" }]
  },
  {
    tStartMs: 4000,
    dDurationMs: 2500,
    segs: [{ utf8: "This is a test" }]
  }
];

// 输出（规范化格式）
const normalized = [
  { timestamp: "0:01", text: "Hello world" },
  { timestamp: "0:04", text: "This is a test" }
];
```

---

## 七、完整提取流程实现

### 7.1 主函数

```javascript
/**
 * 从 YouTube 视频提取字幕
 *
 * 这是对外暴露的主函数，整合了所有提取方法
 *
 * @param {string} url - 视频 URL
 * @returns {Promise<{title: string, transcript: Array}>}
 */
async function getTranscript(url) {
  console.log("开始提取字幕:", url);

  // 判断视频类型
  const isShorts = /youtube\.com\/shorts\//.test(url);

  // 提取视频 ID
  const videoId = isShorts
    ? url.split("/shorts/")[1].split(/[/?#&]/)[0]
    : new URLSearchParams(new URL(url).search).get("v");

  if (!videoId) {
    throw new Error("无法从 URL 中提取视频 ID");
  }

  console.log("视频 ID:", videoId, "类型:", isShorts ? "Shorts" : "普通视频");

  // ==================== 普通视频处理 ====================
  if (!isShorts) {
    // 获取页面数据
    const pageData = await fetchVideoPageData(url);
    console.log("页面数据类型:", pageData.dataKey);

    // 尝试获取字幕
    const events = await fetchTranscriptWithFallback(
      pageData.ytData,
      pageData.dataKey,
      videoId
    );

    if (!events || events.length === 0) {
      throw new Error("该视频没有可用字幕");
    }

    // 规范化数据
    const transcript = normalizeTranscript(events);

    return {
      title: pageData.title,
      transcript: transcript
    };
  }

  // ==================== Shorts 视频处理 ====================
  // Shorts 需要转换为普通视频 URL
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;

  try {
    // 通过 background script 获取页面（避免 CORS）
    const response = await chrome.runtime.sendMessage({
      action: "fetchTransformedUrl",
      url: watchUrl
    });

    if (!response.success) {
      throw new Error("获取 Shorts 页面失败");
    }

    // 从 HTML 中提取数据
    const pageData = extractDataFromHtml(response.html);

    // 尝试获取字幕
    const events = await fetchTranscriptWithFallback(
      pageData.ytData,
      pageData.dataKey,
      videoId
    );

    if (!events || events.length === 0) {
      throw new Error("该 Shorts 没有可用字幕");
    }

    return {
      title: pageData.title,
      transcript: normalizeTranscript(events)
    };

  } catch (error) {
    throw new Error(`Shorts 字幕提取失败: ${error.message}`);
  }
}

/**
 * 带降级机制的字幕获取
 *
 * @param {Object} ytData - YouTube 数据对象
 * @param {string} dataKey - 数据类型
 * @param {string} videoId - 视频 ID
 * @returns {Promise<Array>} 字幕事件数组
 */
async function fetchTranscriptWithFallback(ytData, dataKey, videoId) {
  const errors = [];

  // ==================== 方法1: Timedtext API ====================
  console.log("尝试方法1: Timedtext API");

  try {
    // 先尝试从页面脚本获取 URL
    let baseUrl = extractCaptionUrlFromPageScripts();

    // 如果失败，从数据对象获取
    if (!baseUrl && dataKey === "ytInitialPlayerResponse") {
      baseUrl = getCaptionTrackUrl(ytData);
    }

    // 如果还是没有，尝试重新获取 playerResponse
    if (!baseUrl) {
      const html = await fetch(window.location.href).then(r => r.text());
      try {
        const playerResponse = extractYtData(html, "ytInitialPlayerResponse");
        baseUrl = getCaptionTrackUrl(playerResponse);
      } catch (e) {
        console.warn("获取 playerResponse 失败");
      }
    }

    if (baseUrl) {
      const events = await fetchTimedtextAPI(baseUrl, videoId);
      if (events && events.length > 0) {
        console.log("方法1成功: 获取", events.length, "条字幕");
        return events;
      }
    }
  } catch (error) {
    console.warn("方法1失败:", error.message);
    errors.push(`Timedtext API: ${error.message}`);
  }

  // ==================== 方法2: DOM 解析 ====================
  console.log("尝试方法2: DOM 解析");

  try {
    const domTranscript = await extractFromDOM();
    if (domTranscript && domTranscript.length > 0) {
      console.log("方法2成功: 获取", domTranscript.length, "条字幕");
      return domTranscript;
    }
  } catch (error) {
    console.warn("方法2失败:", error.message);
    errors.push(`DOM 解析: ${error.message}`);
  }

  // ==================== 方法3: Internal API ====================
  console.log("尝试方法3: Internal API");

  try {
    // Internal API 需要 ytInitialData
    let initialData = ytData;

    if (dataKey !== "ytInitialData") {
      // 重新获取
      const html = await fetch(window.location.href).then(r => r.text());
      try {
        initialData = extractYtData(html, "ytInitialData");
      } catch (e) {
        throw new Error("无法获取 ytInitialData");
      }
    }

    if (initialData.engagementPanels) {
      const segments = await fetchViaInternalAPI(initialData);
      if (segments && segments.length > 0) {
        console.log("方法3成功: 获取", segments.length, "条字幕");
        return segments;
      }
    }
  } catch (error) {
    console.warn("方法3失败:", error.message);
    errors.push(`Internal API: ${error.message}`);
  }

  // ==================== 所有方法都失败 ====================
  console.error("所有字幕提取方法都失败:", errors);
  throw new Error("无法获取字幕。可能原因：\n" + errors.join("\n"));
}
```

### 7.2 流程图

```
┌─────────────────────────────────────────────────────────────────┐
│                        getTranscript(url)                        │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  解析视频 URL   │
                    │  提取 videoId   │
                    └────────┬────────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
              ▼                             ▼
     ┌────────────────┐           ┌────────────────┐
     │   普通视频     │           │    Shorts      │
     └───────┬────────┘           └───────┬────────┘
             │                            │
             ▼                            ▼
   ┌──────────────────┐        ┌──────────────────┐
   │ fetchVideoPage   │        │ 转换为普通URL     │
   │ Data(url)        │        │ background fetch │
   └────────┬─────────┘        └────────┬─────────┘
            │                           │
            └─────────────┬─────────────┘
                          │
                          ▼
           ┌──────────────────────────┐
           │  fetchTranscriptWith     │
           │  Fallback()              │
           └──────────────┬───────────┘
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
        ▼                 ▼                 ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ 方法1:       │  │ 方法2:       │  │ 方法3:       │
│ Timedtext    │->│ DOM 解析     │->│ Internal API │
│ API + POT    │  │              │  │              │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │                 │                 │
       └─────────────────┴─────────────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │  normalizeTranscript │
              │  规范化数据格式      │
              └──────────┬──────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │  返回 { title,      │
              │    transcript }     │
              └─────────────────────┘
```

---

## 八、错误处理与重试机制

### 8.1 错误类型分类

```javascript
/**
 * 字幕提取错误类型
 */
const ErrorTypes = {
  // 可重试的错误
  NETWORK_ERROR: "NETWORK_ERROR",           // 网络问题
  TIMEOUT: "TIMEOUT",                       // 超时
  RATE_LIMITED: "RATE_LIMITED",             // 频率限制

  // 不可重试的错误
  NO_CAPTIONS: "NO_CAPTIONS",              // 视频没有字幕
  VIDEO_UNAVAILABLE: "VIDEO_UNAVAILABLE",  // 视频不可用
  PRIVATE_VIDEO: "PRIVATE_VIDEO",          // 私密视频
  AGE_RESTRICTED: "AGE_RESTRICTED",        // 年龄限制

  // 程序错误
  PARSE_ERROR: "PARSE_ERROR",              // 解析失败
  UNKNOWN: "UNKNOWN"                       // 未知错误
};

/**
 * 判断错误是否可重试
 */
function isRetryableError(error) {
  const message = error.message.toLowerCase();

  if (message.includes("network") ||
      message.includes("timeout") ||
      message.includes("fetch") ||
      message.includes("failed to fetch")) {
    return true;
  }

  if (message.includes("429") || message.includes("rate limit")) {
    return true;
  }

  return false;
}
```

### 8.2 重试机制实现

```javascript
/**
 * 带重试的函数执行器
 *
 * @param {Function} fn - 要执行的异步函数
 * @param {Object} options - 配置选项
 * @param {number} options.maxRetries - 最大重试次数
 * @param {number} options.baseDelay - 基础延迟（毫秒）
 * @param {boolean} options.exponentialBackoff - 是否使用指数退避
 * @returns {Promise} 函数执行结果
 */
async function withRetry(fn, options = {}) {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    exponentialBackoff = true
  } = options;

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // 如果不是可重试的错误，直接抛出
      if (!isRetryableError(error)) {
        throw error;
      }

      // 如果是最后一次尝试，抛出错误
      if (attempt === maxRetries) {
        throw error;
      }

      // 计算延迟时间
      const delay = exponentialBackoff
        ? baseDelay * Math.pow(2, attempt)
        : baseDelay;

      console.log(`第 ${attempt + 1} 次尝试失败，${delay}ms 后重试...`);
      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * 使用示例
 */
async function fetchWithRetry(url) {
  return withRetry(
    () => fetch(url).then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    }),
    {
      maxRetries: 3,
      baseDelay: 1000,
      exponentialBackoff: true
    }
  );
}
```

### 8.3 优雅的错误提示

```javascript
/**
 * 将技术错误转换为用户友好的提示
 *
 * @param {Error} error - 原始错误
 * @returns {string} 用户友好的错误信息
 */
function formatErrorForUser(error) {
  const message = error.message.toLowerCase();

  // 无字幕
  if (message.includes("no caption") ||
      message.includes("no subtitle") ||
      message.includes("没有字幕")) {
    return "该视频没有可用字幕。可能是：\n" +
           "• 视频较新，字幕尚未生成\n" +
           "• 视频创作者禁用了字幕\n" +
           "• 该语言没有字幕";
  }

  // 视频不可用
  if (message.includes("unavailable") ||
      message.includes("private") ||
      message.includes("不可用")) {
    return "无法访问该视频。可能是：\n" +
           "• 视频是私密的\n" +
           "• 视频已被删除\n" +
           "• 该地区无法观看";
  }

  // 年龄限制
  if (message.includes("age") || message.includes("年龄")) {
    return "该视频有年龄限制，需要登录 YouTube 账户才能访问字幕。";
  }

  // 网络错误
  if (message.includes("network") ||
      message.includes("fetch") ||
      message.includes("网络")) {
    return "网络连接失败，请检查网络后重试。";
  }

  // 频率限制
  if (message.includes("429") || message.includes("rate")) {
    return "请求过于频繁，请稍后再试。";
  }

  // 默认
  return "获取字幕失败，请刷新页面后重试。\n" +
         "如果问题持续，视频可能没有可用字幕。";
}
```

---

## 九、特殊场景处理

### 9.1 YouTube Shorts 处理

```javascript
/**
 * Shorts 视频的特殊处理
 *
 * Shorts 视频的 URL 格式: https://youtube.com/shorts/VIDEO_ID
 * 需要转换为普通视频格式才能获取字幕
 */
async function handleShortsVideo(url) {
  // 提取视频 ID
  const match = url.match(/shorts\/([a-zA-Z0-9_-]+)/);
  if (!match) {
    throw new Error("无效的 Shorts URL");
  }

  const videoId = match[1];

  // 转换为普通视频 URL
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;

  // Shorts 页面在 content script 中无法直接 fetch 普通视频页面
  // 需要通过 background script 代理
  const response = await chrome.runtime.sendMessage({
    action: "fetchTransformedUrl",
    url: watchUrl
  });

  if (!response.success) {
    throw new Error("无法获取 Shorts 视频信息");
  }

  // 从返回的 HTML 中提取数据
  return extractDataFromHtml(response.html);
}

/**
 * 从 HTML 字符串中提取 YouTube 数据
 */
function extractDataFromHtml(html) {
  // 尝试提取 ytInitialData
  try {
    const ytInitialData = extractYtData(html, "ytInitialData");

    if (ytInitialData) {
      const title = ytInitialData?.videoDetails?.title ||
                    ytInitialData?.playerOverlays
                      ?.playerOverlayRenderer
                      ?.videoDetails
                      ?.playerOverlayVideoDetailsRenderer
                      ?.title?.simpleText ||
                    "未知标题";

      // 检查是否有转录面板
      const hasTranscript = ytInitialData?.engagementPanels?.some(
        p => p.engagementPanelSectionListRenderer
          ?.content
          ?.continuationItemRenderer
          ?.continuationEndpoint
          ?.getTranscriptEndpoint
      );

      if (hasTranscript) {
        return {
          title,
          ytData: ytInitialData,
          dataKey: "ytInitialData",
          resolvedType: "regular"
        };
      }
    }
  } catch (e) {
    console.warn("从 HTML 提取 ytInitialData 失败:", e);
  }

  // 降级到 ytInitialPlayerResponse
  try {
    const playerResponse = extractYtData(html, "ytInitialPlayerResponse");

    if (playerResponse) {
      const title = playerResponse?.videoDetails?.title ||
                    playerResponse?.microformat
                      ?.playerMicroformatRenderer
                      ?.title?.simpleText ||
                    "未知标题";

      return {
        title,
        ytData: playerResponse,
        dataKey: "ytInitialPlayerResponse",
        resolvedType: "shorts"
      };
    }
  } catch (e) {
    console.warn("从 HTML 提取 ytInitialPlayerResponse 失败:", e);
  }

  throw new Error("无法从页面提取视频数据");
}
```

### 9.2 多语言字幕选择

```javascript
/**
 * 获取所有可用字幕轨道
 *
 * @param {Object} ytData - YouTube 数据对象
 * @returns {Array} 字幕轨道列表
 */
function getAvailableCaptionTracks(ytData) {
  const tracks = ytData?.captions
    ?.playerCaptionsTracklistRenderer
    ?.captionTracks || [];

  return tracks.map(track => ({
    languageCode: track.languageCode,
    languageName: track.name?.simpleText || track.languageCode,
    isAutoGenerated: track.kind === "asr",
    baseUrl: track.baseUrl
  }));
}

/**
 * 获取指定语言的字幕
 *
 * @param {string} url - 视频 URL
 * @param {string} languageCode - 语言代码（如 "en", "zh-Hans"）
 * @returns {Promise<Object>} 字幕数据
 */
async function getTranscriptByLanguage(url, languageCode) {
  const pageData = await fetchVideoPageData(url);

  const tracks = getAvailableCaptionTracks(pageData.ytData);
  const track = tracks.find(t => t.languageCode === languageCode);

  if (!track) {
    throw new Error(`没有找到 ${languageCode} 语言的字幕`);
  }

  const videoId = new URLSearchParams(new URL(url).search).get("v");
  const pot = await getPOToken(videoId);

  const apiUrl = pot
    ? `${track.baseUrl}&fmt=json3&pot=${pot}&c=WEB`
    : `${track.baseUrl}&fmt=json3`;

  const response = await fetch(apiUrl);
  const data = await response.json();

  return {
    title: pageData.title,
    language: track.languageName,
    languageCode: track.languageCode,
    isAutoGenerated: track.isAutoGenerated,
    transcript: normalizeTranscript(data.events)
  };
}
```

### 9.3 直播视频处理

```javascript
/**
 * 检测是否为直播视频
 */
function isLiveVideo(ytData) {
  return ytData?.videoDetails?.isLive === true ||
         ytData?.videoDetails?.isLiveContent === true;
}

/**
 * 直播视频的字幕处理
 *
 * 直播视频通常没有预生成的字幕，
 * 但可能有实时字幕（如果主播启用）
 */
async function handleLiveVideo(url) {
  // 对于直播，只能使用 DOM 方法
  // 因为字幕是实时生成的

  const domTranscript = await extractFromDOM();

  if (!domTranscript || domTranscript.length === 0) {
    throw new Error("直播视频暂无可用字幕。\n" +
                   "实时字幕需要主播启用，且可能有延迟。");
  }

  return domTranscript;
}
```

---

## 十、稳定性保障措施

### 10.1 检测点和监控

```javascript
/**
 * 字幕提取健康检查
 */
const HealthCheck = {
  // 记录各方法的成功率
  stats: {
    timedtextAPI: { success: 0, failure: 0 },
    domExtraction: { success: 0, failure: 0 },
    internalAPI: { success: 0, failure: 0 }
  },

  /**
   * 记录成功
   */
  recordSuccess(method) {
    if (this.stats[method]) {
      this.stats[method].success++;
    }
  },

  /**
   * 记录失败
   */
  recordFailure(method) {
    if (this.stats[method]) {
      this.stats[method].failure++;
    }
  },

  /**
   * 获取各方法成功率
   */
  getSuccessRates() {
    const rates = {};
    for (const [method, stat] of Object.entries(this.stats)) {
      const total = stat.success + stat.failure;
      rates[method] = total > 0
        ? Math.round((stat.success / total) * 100)
        : 0;
    }
    return rates;
  },

  /**
   * 判断某方法是否应该被跳过
   * 如果连续失败多次，临时跳过
   */
  shouldSkipMethod(method) {
    const stat = this.stats[method];
    if (!stat) return false;

    // 如果最近10次有8次失败，跳过
    const recentFailureRate = stat.failure / (stat.success + stat.failure);
    return recentFailureRate > 0.8 && (stat.success + stat.failure) > 10;
  }
};
```

### 10.2 自动恢复机制

```javascript
/**
 * 扩展上下文检测
 *
 * 当扩展更新时，content script 的 chrome API 会失效
 */
function isExtensionContextValid() {
  try {
    // 尝试访问 chrome.runtime
    return chrome.runtime && chrome.runtime.id;
  } catch (e) {
    return false;
  }
}

/**
 * 处理扩展上下文失效
 */
function handleInvalidatedContext() {
  console.warn("扩展上下文已失效，需要刷新页面");

  // 移除已注入的按钮
  const button = document.getElementById("ext-copy-transcript-btn");
  if (button) {
    button.remove();
  }

  // 停止监听
  window.transcriptListenerActive = false;

  // 可选：显示提示
  // alert("扩展已更新，请刷新页面。");
}

/**
 * 包装函数，自动处理上下文失效
 */
function withContextCheck(fn) {
  return async (...args) => {
    if (!isExtensionContextValid()) {
      handleInvalidatedContext();
      throw new Error("扩展上下文已失效，请刷新页面");
    }

    try {
      return await fn(...args);
    } catch (error) {
      if (error.message.includes("Extension context invalidated")) {
        handleInvalidatedContext();
      }
      throw error;
    }
  };
}
```

### 10.3 YouTube 页面变化适配

```javascript
/**
 * DOM 选择器版本管理
 *
 * YouTube 经常更新页面结构，需要维护多版本选择器
 */
const SelectorVersions = {
  // 转录按钮
  transcriptButton: [
    // 2024 新版
    'button[aria-label="Show transcript"]',
    // 2023 版本
    '#button[aria-label="Show transcript"]',
    // 描述区域
    'ytd-video-description-transcript-section-renderer #primary-button button',
    // 更早版本
    '#primary-button > ytd-button-renderer > yt-button-shape > button'
  ],

  // 字幕按钮
  ccButton: [
    // 新布局
    "#movie_player .ytp-right-controls > button.ytp-subtitles-button",
    // 旧布局
    "#movie_player .ytp-right-controls-left > button.ytp-subtitles-button"
  ],

  // 操作栏
  actionBar: [
    "#below #actions",
    "#secondary-metadata #actions",
    "ytd-menu-renderer #top-level-buttons-computed"
  ]
};

/**
 * 使用多版本选择器查找元素
 */
function findElement(selectorKey) {
  const selectors = SelectorVersions[selectorKey] || [];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      return element;
    }
  }

  return null;
}

/**
 * 定期检查选择器有效性
 * 如果所有选择器都失效，可以上报问题
 */
function checkSelectorValidity() {
  const results = {};

  for (const [key, selectors] of Object.entries(SelectorVersions)) {
    results[key] = selectors.some(s => document.querySelector(s) !== null);
  }

  // 如果关键选择器全部失效，记录警告
  if (!results.ccButton && !results.transcriptButton) {
    console.warn("警告：所有字幕相关选择器都已失效，可能需要更新");
    // 可选：发送遥测数据
  }

  return results;
}
```

### 10.4 总结：稳定性保障清单

| 措施 | 说明 |
|------|------|
| 多层降级 | 三种方法依次尝试，单一方法失败不影响整体 |
| 重试机制 | 网络错误自动重试，指数退避 |
| 缓存机制 | POT token 缓存，避免重复获取 |
| 错误分类 | 区分可重试和不可重试错误 |
| 上下文检测 | 自动检测扩展更新导致的失效 |
| 选择器多版本 | 兼容 YouTube 不同时期的页面结构 |
| 健康监控 | 记录各方法成功率，动态调整策略 |

---

## 十一、完整可复刻代码汇总

以下是从参考项目 `0REFER/1.5.0_0/content.js` 中还原的核心代码，可直接用于复刻。

### 11.1 核心常量定义

```javascript
/**
 * 字幕按钮选择器（YouTube 播放器右下角的 CC 按钮）
 * YouTube 有两种不同的播放器布局，需要都支持
 */
const CC_BUTTON_SELECTOR_1 =
  "#movie_player > div.ytp-chrome-bottom > div.ytp-chrome-controls > " +
  "div.ytp-right-controls > button.ytp-subtitles-button.ytp-button";

const CC_BUTTON_SELECTOR_2 =
  "#movie_player > div.ytp-chrome-bottom > div.ytp-chrome-controls > " +
  "div.ytp-right-controls > div.ytp-right-controls-left > " +
  "button.ytp-subtitles-button.ytp-button";

/**
 * POT Token 缓存
 */
const potTokenCache = new Map();
```

### 11.2 POT Token 获取（从参考项目精确还原）

```javascript
/**
 * 获取 POT Token - 从参考项目 content.js 还原
 *
 * 原理：
 * 1. 清空 Performance 资源计时器
 * 2. 模拟点击字幕按钮，触发 YouTube 的字幕 API 请求
 * 3. 通过 Performance API 捕获请求 URL
 * 4. 从 URL 中提取 pot 参数
 *
 * @param {string} videoId - 视频 ID（用于缓存 key）
 * @returns {Promise<string>} POT token，失败返回空字符串
 */
async function getPOToken(videoId = "") {
  try {
    // 设置捕获
    setupPOTCapture(videoId);

    // 等待捕获完成
    await new Promise(resolve => setTimeout(resolve, 350));

    // 获取结果
    return retrievePOToken(videoId) ?? "";
  } catch {
    return "";
  }
}

/**
 * 设置 POT 捕获（内部函数）
 */
function setupPOTCapture(videoId = "") {
  const cacheKey = `yt-caption-potoken-${videoId}`;

  try {
    // 查找字幕按钮
    const ccButton = document.querySelector(CC_BUTTON_SELECTOR_1) ||
                     document.querySelector(CC_BUTTON_SELECTOR_2);

    if (!ccButton) return;

    // 添加一次性点击监听器
    ccButton.addEventListener("click", async () => {
      // 清空性能计时器
      performance.clearResourceTimings();

      let pot = null;

      // 轮询等待 timedtext 请求（最多 500ms）
      for (let i = 0; i <= 500; i += 50) {
        await new Promise(resolve => setTimeout(resolve, 50));

        // 获取所有资源请求，筛选 timedtext
        const entries = performance.getEntriesByType("resource")
          .filter(entry => entry.name.includes("/api/timedtext?"));

        if (entries.length > 0) {
          // 取最新的请求
          const latestEntry = entries[entries.length - 1];
          pot = new URL(latestEntry.name).searchParams.get("pot");

          if (pot) break;
        }
      }

      // 缓存 token
      if (pot) {
        potTokenCache.set(cacheKey, pot);
      }
    }, { once: true });

    // 双击字幕按钮
    ccButton.click();
    ccButton.click();

  } catch {
    return;
  }
}

/**
 * 获取缓存的 POT Token（内部函数）
 */
function retrievePOToken(videoId = "") {
  try {
    const cacheKey = `yt-caption-potoken-${videoId}`;
    const cached = potTokenCache.get(cacheKey);

    if (cached) return cached;

    // 如果缓存没有，再次尝试触发
    const ccButton = document.querySelector(CC_BUTTON_SELECTOR_1) ||
                     document.querySelector(CC_BUTTON_SELECTOR_2);

    if (ccButton) {
      ccButton.click();
      ccButton.click();
      return potTokenCache.get(cacheKey) || "";
    }

    return "";
  } catch {
    return "";
  }
}
```

### 11.3 页面数据提取（从参考项目精确还原）

```javascript
/**
 * 从 HTML 提取 YouTube 数据对象 - 从参考项目还原
 *
 * @param {string} html - 页面 HTML
 * @param {string} key - 数据键名 (ytInitialData 或 ytInitialPlayerResponse)
 * @returns {Object} 解析后的 JSON 对象
 */
function extractYtData(html, key) {
  const patterns = [
    new RegExp(`window\\["${key}"\\]\\s*=\\s*({[\\s\\S]+?})\\s*;`),
    new RegExp(`var ${key}\\s*=\\s*({[\\s\\S]+?})\\s*;`),
    new RegExp(`${key}\\s*=\\s*({[\\s\\S]+?})\\s*;`)
  ];

  for (const regex of patterns) {
    const match = html.match(regex);
    if (match && match[1]) {
      try {
        return JSON.parse(match[1]);
      } catch (e) {
        console.warn(`Failed to parse ${key}:`, e.message);
      }
    }
  }

  throw new Error(`${key} not found`);
}

/**
 * 从页面脚本中提取字幕 URL - 从参考项目还原
 */
function extractCaptionUrlFromPage() {
  try {
    const scripts = document.querySelectorAll("script");

    for (const script of scripts) {
      const content = script.textContent || "";

      // 方法1: 从 ytInitialPlayerResponse 提取
      if (content.includes("ytInitialPlayerResponse")) {
        const match = content.match(
          /ytInitialPlayerResponse\s*=\s*(\{.+?\});\s*(?:var|let|const|<\/script>)/s
        );
        if (match) {
          const data = JSON.parse(match[1]);
          const url = data?.captions
            ?.playerCaptionsTracklistRenderer
            ?.captionTracks?.[0]
            ?.baseUrl;
          if (url) return url;
        }
      }

      // 方法2: 直接搜索 baseUrl
      if (content.includes('"baseUrl"') && content.includes("timedtext")) {
        const match = content.match(
          /"baseUrl"\s*:\s*"(https:\/\/www\.youtube\.com\/api\/timedtext[^"]+)"/
        );
        if (match) {
          return match[1].replace(/\\u0026/g, "&");
        }
      }
    }
  } catch (e) {
    console.warn("extractCaptionUrlFromPage failed:", e);
  }

  return null;
}
```

### 11.4 DOM 转录面板解析（从参考项目精确还原）

```javascript
/**
 * 转录按钮选择器列表
 */
const TRANSCRIPT_BUTTON_SELECTORS = [
  'button[aria-label="Show transcript"]',
  '#button[aria-label="Show transcript"]',
  'ytd-video-description-transcript-section-renderer #primary-button button',
  '#primary-button > ytd-button-renderer > yt-button-shape > button'
];

/**
 * 转录片段选择器
 */
const TRANSCRIPT_SEGMENTS_SELECTOR =
  "#segments-container > ytd-transcript-segment-renderer";

/**
 * 等待元素出现
 */
function waitForElement(selector, timeout = 3000) {
  return new Promise(resolve => {
    if (document.querySelector(selector)) {
      return resolve(true);
    }

    const observer = new MutationObserver(() => {
      if (document.querySelector(selector)) {
        observer.disconnect();
        resolve(true);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    setTimeout(() => {
      observer.disconnect();
      resolve(false);
    }, timeout);
  });
}

/**
 * 解析时间戳为毫秒
 */
function parseTimestamp(str) {
  const parts = str.split(':').map(Number);

  if (parts.length === 2) {
    return (parts[0] * 60 + parts[1]) * 1000;
  } else if (parts.length === 3) {
    return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
  }

  return 0;
}

/**
 * 从 DOM 提取字幕 - 从参考项目还原
 */
async function extractFromDOM() {
  // 查找转录按钮
  let transcriptBtn = null;
  for (const selector of TRANSCRIPT_BUTTON_SELECTORS) {
    transcriptBtn = document.querySelector(selector);
    if (transcriptBtn) break;
  }

  if (!transcriptBtn) return null;

  // 点击按钮
  transcriptBtn.click();

  // 等待内容加载
  if (!await waitForElement(TRANSCRIPT_SEGMENTS_SELECTOR, 3000)) {
    return null;
  }

  // 额外等待渲染
  await new Promise(resolve => setTimeout(resolve, 300));

  // 提取片段
  const segments = document.querySelectorAll(TRANSCRIPT_SEGMENTS_SELECTOR);
  if (!segments.length) return null;

  const transcript = [];

  segments.forEach(segment => {
    const timestamp = segment.querySelector("div.segment-timestamp")
      ?.textContent?.trim();
    const text = segment.querySelector("yt-formatted-string")
      ?.textContent?.trim();

    if (timestamp && text) {
      transcript.push({
        tStartMs: parseTimestamp(timestamp),
        segs: [{ utf8: text }]
      });
    }
  });

  return transcript.length > 0 ? transcript : null;
}
```

### 11.5 Internal API 请求（从参考项目精确还原）

```javascript
/**
 * 生成客户端版本号 - 从参考项目还原
 */
function generateClientVersion() {
  const dates = Array.from({ length: 30 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - i);
    return date.toISOString().split('T')[0].replace(/-/g, '');
  });

  const randomDate = dates[Math.floor(Math.random() * dates.length)];
  return `2.${randomDate}.00.00`;
}

/**
 * 通过 Internal API 获取字幕 - 从参考项目还原
 */
async function fetchViaInternalAPI(ytData) {
  // 提取 params
  const params = ytData.engagementPanels?.find(panel =>
    panel.engagementPanelSectionListRenderer
      ?.content
      ?.continuationItemRenderer
      ?.continuationEndpoint
      ?.getTranscriptEndpoint
  )?.engagementPanelSectionListRenderer
    ?.content
    ?.continuationItemRenderer
    ?.continuationEndpoint
    ?.getTranscriptEndpoint
    ?.params;

  if (!params) {
    throw new Error("No transcript params found");
  }

  // 获取上下文
  const hl = ytData.topbar
    ?.desktopTopbarRenderer
    ?.searchbox
    ?.fusionSearchboxRenderer
    ?.config
    ?.webSearchboxConfig
    ?.requestLanguage || "en";

  const visitorData = ytData.responseContext
    ?.webResponseContextExtensionData
    ?.ytConfigData
    ?.visitorData;

  // 构建请求体
  const payload = {
    context: {
      client: {
        hl: hl,
        visitorData: visitorData,
        clientName: "WEB",
        clientVersion: generateClientVersion()
      },
      request: {
        useSsl: true
      }
    },
    params: params
  };

  // 发送请求
  const response = await fetch(
    "https://www.youtube.com/youtubei/v1/get_transcript?prettyPrint=false",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }
  );

  if (!response.ok) {
    throw new Error(`Internal API failed: ${response.status}`);
  }

  const data = await response.json();

  // 提取字幕
  return data.actions?.[0]
    ?.updateEngagementPanelAction
    ?.content
    ?.transcriptRenderer
    ?.content
    ?.transcriptSearchPanelRenderer
    ?.body
    ?.transcriptSegmentListRenderer
    ?.initialSegments || [];
}
```

### 11.6 数据规范化（从参考项目精确还原）

```javascript
/**
 * 毫秒转时间戳字符串
 */
function formatMilliseconds(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * 转换 Internal API 格式
 */
function convertFromInternalAPI(event) {
  const renderer = event?.transcriptSegmentRenderer;
  if (!renderer) return ["", ""];

  return [
    renderer.startTimeText?.simpleText || "",
    renderer.snippet?.runs?.map(r => r.text).join(" ") || ""
  ];
}

/**
 * 转换 Timedtext API 格式
 */
function convertFromTimedtext(event) {
  return [
    formatMilliseconds(event.tStartMs),
    (event.segs || []).map(seg => seg.utf8).join(" ").replace(/\n/g, " ")
  ];
}

/**
 * 规范化字幕数据 - 从参考项目还原
 */
function normalizeTranscript(events, resolvedType) {
  if (!events || events.length === 0) return [];

  const first = events[0];

  // Internal API 格式
  if (first?.transcriptSegmentRenderer) {
    return events.map(e => convertFromInternalAPI(e));
  }

  // Timedtext API 格式
  if (first?.segs || first?.tStartMs !== undefined) {
    return events.filter(e => e.segs).map(e => convertFromTimedtext(e));
  }

  // 默认处理
  if (resolvedType === "regular") {
    return events.map(e => convertFromInternalAPI(e));
  }

  return events.filter(e => e.segs).map(e => convertFromTimedtext(e));
}
```

### 11.7 完整主函数（从参考项目精确还原）

```javascript
/**
 * 主函数：获取视频字幕 - 从参考项目还原
 *
 * @param {string} url - 视频 URL
 * @returns {Promise<{title: string, transcript: Array}>}
 */
async function getTranscript(url) {
  const isShorts = /youtube\.com\/shorts\//.test(url);

  const videoId = isShorts
    ? url.split("/shorts/")[1].split(/[/?#&]/)[0]
    : new URLSearchParams(window.location.search).get("v");

  if (!isShorts) {
    // 普通视频
    const { title, ytData, dataKey, resolvedType } = await fetchVideoPageData(url);
    const events = await fetchTranscriptEvents(ytData, dataKey, videoId);

    if (!events.length) return { title, transcript: [] };

    return { title, transcript: normalizeTranscript(events, resolvedType) };
  }

  // Shorts 视频
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;

  try {
    const response = await chrome.runtime.sendMessage({
      action: "fetchTransformedUrl",
      url: watchUrl
    });

    if (!response.success) throw new Error("Failed to fetch");

    const { title, ytData, dataKey, resolvedType } = extractDataFromHtml(response.html);
    const events = await fetchTranscriptEvents(ytData, dataKey, videoId);

    if (!events.length) return { title, transcript: [] };

    return { title, transcript: normalizeTranscript(events, resolvedType) };

  } catch (e) {
    throw new Error("This Short doesn't have captions available.");
  }
}

/**
 * 带降级的字幕事件获取 - 从参考项目还原
 */
async function fetchTranscriptEvents(ytData, dataKey, videoId) {
  // 方法1: Timedtext API
  try {
    let baseUrl = extractCaptionUrlFromPage();

    if (!baseUrl) {
      const html = await fetch(window.location.href).then(r => r.text());
      const playerResponse = extractYtData(html, "ytInitialPlayerResponse");
      baseUrl = playerResponse?.captions
        ?.playerCaptionsTracklistRenderer
        ?.captionTracks?.[0]
        ?.baseUrl;
    }

    if (baseUrl) {
      const pot = videoId ? await getPOToken(videoId) : "";
      const url = pot
        ? `${baseUrl}&fmt=json3&pot=${pot}&c=WEB`
        : `${baseUrl}&fmt=json3`;

      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        if (data.events?.length > 0) return data.events;
      }
    }
  } catch (e) {
    console.warn("Method 1 failed:", e);
  }

  // 方法2: DOM 解析
  try {
    const domResult = await extractFromDOM();
    if (domResult?.length > 0) return domResult;
  } catch (e) {
    console.warn("Method 2 failed:", e);
  }

  // 方法3: Internal API
  if (ytData.engagementPanels) {
    try {
      const segments = await fetchViaInternalAPI(ytData);
      if (segments.length > 0) return segments;
    } catch (e) {
      console.warn("Method 3 failed:", e);
    }
  }

  throw new Error("No captions found.");
}
```

---

## 十二、关键选择器参考表

### 12.1 字幕按钮选择器

| 用途 | 选择器 | 说明 |
|------|--------|------|
| CC 按钮 (新布局) | `#movie_player .ytp-right-controls > button.ytp-subtitles-button` | 播放器右下角 |
| CC 按钮 (旧布局) | `#movie_player .ytp-right-controls-left > button.ytp-subtitles-button` | 按钮在左侧容器 |

### 12.2 转录面板选择器

| 用途 | 选择器 | 说明 |
|------|--------|------|
| 转录按钮 | `button[aria-label="Show transcript"]` | 描述区域的按钮 |
| 转录按钮 | `ytd-video-description-transcript-section-renderer #primary-button button` | 备用选择器 |
| 字幕片段 | `#segments-container > ytd-transcript-segment-renderer` | 转录内容容器 |
| 时间戳 | `div.segment-timestamp` | 片段内的时间戳 |
| 文本 | `yt-formatted-string` | 片段内的文本 |

### 12.3 页面操作栏选择器

| 用途 | 选择器 | 说明 |
|------|--------|------|
| 操作栏 | `#below #actions` | 视频下方操作区 |
| 操作栏 | `#secondary-metadata #actions` | 备用位置 |
| 按钮容器 | `#top-level-buttons-computed` | 操作按钮容器 |
| 分享按钮 | `button[aria-label="Share"]` | 用于定位插入位置 |

---

## 附录：API 端点参考

### Timedtext API

```
GET https://www.youtube.com/api/timedtext

参数：
  v       - 视频 ID (必需)
  lang    - 语言代码 (en, zh-Hans 等)
  fmt     - 格式 (json3 = JSON)
  pot     - POT Token (2024年后必需)
  c       - 客户端 (WEB)
```

### Internal API

```
POST https://www.youtube.com/youtubei/v1/get_transcript

Headers:
  Content-Type: application/json

Body: {
  "context": {
    "client": {
      "hl": "en",
      "visitorData": "...",
      "clientName": "WEB",
      "clientVersion": "2.YYYYMMDD.00.00"
    },
    "request": { "useSsl": true }
  },
  "params": "<base64 编码的参数>"
}
```

---

*文档版本: 2.0*
*基于参考项目: 0REFER/1.5.0_0*
*更新日期: 2026-01-31*
*用途: YouTube 字幕提取模块完整复刻指南*

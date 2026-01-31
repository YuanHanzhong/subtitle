# YouTube 字幕提取 Chrome 扩展 - 完整技术架构文档

> 基于参考项目 `0REFER/1.5.0_0` 的深度逆向分析，可用于完整复刻项目

---

## 目录

1. [项目概述](#一项目概述)
2. [核心架构](#二核心架构)
3. [字幕提取核心技术](#三字幕提取核心技术最重要)
4. [Chrome Extension 架构详解](#四chrome-extension-架构详解)
5. [数据存储架构](#五数据存储架构)
6. [字幕格式化与导出](#六字幕格式化与导出)
7. [AI 对话功能](#七ai-对话功能)
8. [页面注入与UI交互](#八页面注入与ui交互)
9. [关键技术总结](#九关键技术总结)
10. [复刻检查清单](#十复刻检查清单)

---

## 一、项目概述

### 1.1 功能定位

- 从 YouTube 视频页面提取字幕/转录文本
- 支持多种导出格式 (TXT/PDF/Markdown)
- AI 对话分析功能 (侧边栏)
- 历史记录管理
- 页面内一键复制按钮

### 1.2 技术栈

| 层级 | 技术 |
|------|------|
| 扩展架构 | Chrome Extension Manifest V3 |
| 前端 | 原生 JavaScript (无框架) |
| PDF生成 | jsPDF 库 |
| 数据存储 | chrome.storage API |
| AI后端 | 远程 API (cyt.hamzaw.com) |

### 1.3 参考项目文件结构

```
0REFER/1.5.0_0/
├── manifest.json           # 扩展配置清单
├── background.js           # Service Worker (后台服务) - 11KB
├── content.js              # 内容脚本 (注入YouTube页面) - 21KB
├── popup.html              # 弹窗界面 - 52KB
├── jspdf.min.js            # PDF导出库 - 356KB
├── pro-features.js         # Pro功能模块
├── popup/                  # 弹窗脚本模块
│   ├── popup.js            # 主逻辑 - 16KB
│   ├── history.js          # 历史记录
│   ├── settings.js         # 设置管理
│   ├── presets.js          # 预设配置
│   ├── export.js           # 导出功能
│   └── utils.js            # 工具函数
├── shared/                 # 共享模块
│   ├── formatting.js       # 字幕格式化
│   ├── i18n.js             # 国际化
│   └── upgrade.js/css      # 升级提示
├── sidepanel/              # 侧边栏 (AI对话)
│   ├── sidepanel.html
│   ├── sidepanel.css
│   └── sidepanel.js        # 17KB
├── images/                 # 图标 (9种尺寸)
└── _locales/               # 16种语言本地化
```

---

## 二、核心架构

### 2.1 通信架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        Chrome Browser                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐                         ┌──────────────────┐  │
│  │   Popup UI   │                         │    Side Panel    │  │
│  │  (popup.js)  │                         │ (sidepanel.js)   │  │
│  └──────┬───────┘                         └────────┬─────────┘  │
│         │                                          │             │
│         │      chrome.runtime.sendMessage()        │             │
│         ▼                                          ▼             │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              Background Service Worker                   │    │
│  │                   (background.js)                        │    │
│  │  - 消息路由中心                                           │    │
│  │  - 许可证验证                                             │    │
│  │  - AI使用量管理                                           │    │
│  │  - 标签页状态追踪                                         │    │
│  └──────────────────────────┬──────────────────────────────┘    │
│                             │                                    │
│                             │ chrome.tabs.sendMessage()          │
│                             ▼                                    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              Content Script (content.js)                 │    │
│  │                 注入到 YouTube 页面                       │    │
│  │  - 字幕提取核心逻辑                                       │    │
│  │  - 页面按钮注入                                           │    │
│  │  - DOM监听与解析                                          │    │
│  └─────────────────────────────────────────────────────────┘    │
│                             │                                    │
│                             ▼                                    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    YouTube 页面                          │    │
│  │  - ytInitialPlayerResponse (字幕数据源)                   │    │
│  │  - Timedtext API                                         │    │
│  │  - Transcript DOM Panel                                  │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 数据流

```
用户点击"复制字幕"
        │
        ▼
┌───────────────────┐
│  Popup/页面按钮    │
└─────────┬─────────┘
          │ sendMessage({action: "copyTranscript"})
          ▼
┌───────────────────┐
│   Content Script  │
│   (content.js)    │
└─────────┬─────────┘
          │
          ▼
┌───────────────────────────────────────┐
│         字幕提取策略 (降级机制)         │
│                                        │
│  1. Timedtext API + POT Token          │
│         ↓ 失败                         │
│  2. DOM Transcript 面板解析             │
│         ↓ 失败                         │
│  3. YouTubei Internal API              │
│         ↓ 失败                         │
│  4. 返回错误                            │
└─────────┬─────────────────────────────┘
          │
          ▼
┌───────────────────┐
│   数据规范化处理   │
│  (统一格式)        │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│   格式化输出       │
│  (formatting.js)  │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│   复制到剪贴板     │
│   或导出文件       │
└───────────────────┘
```

---

## 三、字幕提取核心技术（最重要）

### 3.1 提取策略概述

扩展使用 **多层级降级策略** 提取字幕，这是整个项目的核心：

```
优先级1: YouTube Timedtext API (直接API请求) ← 最可靠
    ↓ 失败
优先级2: DOM Transcript 面板 (页面DOM解析) ← 备用方案
    ↓ 失败
优先级3: YouTubei Internal API (内部API请求) ← 最后手段
    ↓ 失败
返回错误信息
```

### 3.2 方法一：Timedtext API 提取（主要方法）

#### 3.2.1 步骤1：从页面提取 YouTube 初始数据

YouTube 页面加载时会在 `<script>` 标签中嵌入 JSON 数据，包含视频的所有元信息：

```javascript
/**
 * 从页面HTML中提取指定的YouTube数据对象
 * @param {string} html - 页面HTML内容
 * @param {string} key - 要提取的数据键名 (如 "ytInitialPlayerResponse")
 * @returns {Object} 解析后的JSON对象
 */
function extractYtData(html, key) {
  // YouTube 使用多种方式声明这些变量
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

// 使用示例
const html = await fetch(window.location.href).then(r => r.text());
const playerResponse = extractYtData(html, "ytInitialPlayerResponse");
const initialData = extractYtData(html, "ytInitialData");
```

#### 3.2.2 步骤2：从数据中获取字幕轨道URL

`ytInitialPlayerResponse` 的数据结构（关键部分）：

```javascript
{
  "videoDetails": {
    "videoId": "dQw4w9WgXcQ",
    "title": "Video Title",
    "lengthSeconds": "212"
  },
  "captions": {
    "playerCaptionsTracklistRenderer": {
      "captionTracks": [
        {
          "baseUrl": "https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&...",
          "name": { "simpleText": "English" },
          "languageCode": "en",
          "kind": "asr",  // "asr" = 自动生成, 无此字段 = 人工字幕
          "isTranslatable": true
        },
        {
          "baseUrl": "https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&lang=zh...",
          "name": { "simpleText": "Chinese (Simplified)" },
          "languageCode": "zh-Hans"
        }
      ],
      "translationLanguages": [...]  // 可翻译的目标语言列表
    }
  }
}

// 提取字幕URL
function getCaptionBaseUrl(ytData) {
  const tracks = ytData?.captions
    ?.playerCaptionsTracklistRenderer
    ?.captionTracks;

  if (!tracks || tracks.length === 0) {
    throw new Error("No captions available for this video");
  }

  // 优先选择人工字幕（没有 kind: "asr"）
  const manualTrack = tracks.find(t => !t.kind);
  return (manualTrack || tracks[0]).baseUrl;
}
```

#### 3.2.3 步骤3：POT Token 获取机制（关键技术）

**背景**：YouTube 在2024年引入了 POT (Proof of Origin Token) 验证机制，直接请求字幕API会返回403错误。必须获取有效的 POT token。

**核心原理**：
1. 利用 `Performance API` 监听浏览器的真实网络请求
2. 模拟用户点击字幕按钮，触发 YouTube 自己的字幕请求
3. 从真实请求的URL中截获 `pot` 参数
4. 使用该 token 进行我们自己的 API 请求

```javascript
/**
 * 获取 POT (Proof of Origin Token)
 * 这是绕过 YouTube 字幕保护的关键技术
 * @param {string} videoId - 视频ID
 * @returns {Promise<string>} POT token
 */
async function getPOToken(videoId = "") {
  const cacheKey = `yt-caption-potoken-${videoId}`;
  const tokenCache = new Map();

  try {
    // 查找字幕按钮（YouTube有两种布局）
    const CC_BUTTON_SELECTORS = [
      "#movie_player > div.ytp-chrome-bottom > div.ytp-chrome-controls > " +
        "div.ytp-right-controls > button.ytp-subtitles-button.ytp-button",
      "#movie_player > div.ytp-chrome-bottom > div.ytp-chrome-controls > " +
        "div.ytp-right-controls > div.ytp-right-controls-left > " +
        "button.ytp-subtitles-button.ytp-button"
    ];

    const ccButton = CC_BUTTON_SELECTORS
      .map(s => document.querySelector(s))
      .find(btn => btn !== null);

    if (!ccButton) {
      console.warn("CC button not found");
      return "";
    }

    // 1. 清空性能计时器，准备捕获新请求
    performance.clearResourceTimings();

    // 2. 设置一次性点击监听器
    ccButton.addEventListener("click", async () => {
      // 3. 轮询等待 timedtext 请求出现
      for (let i = 0; i <= 500; i += 50) {
        await new Promise(resolve => setTimeout(resolve, 50));

        // 4. 从 Performance API 获取所有资源请求
        const entries = performance.getEntriesByType("resource")
          .filter(entry => entry.name.includes("/api/timedtext?"));

        if (entries.length > 0) {
          // 5. 从最新的请求URL中提取 pot 参数
          const url = new URL(entries.pop().name);
          const pot = url.searchParams.get("pot");
          if (pot) {
            tokenCache.set(cacheKey, pot);
            return;
          }
        }
      }
    }, { once: true });

    // 6. 触发点击（双击确保状态一致：开→关 或 关→开→关）
    ccButton.click();
    ccButton.click();

    // 7. 等待token获取
    await new Promise(resolve => setTimeout(resolve, 350));

    return tokenCache.get(cacheKey) || "";

  } catch (error) {
    console.error("Error getting POT:", error);
    return "";
  }
}
```

#### 3.2.4 步骤4：请求字幕数据

```javascript
/**
 * 使用 Timedtext API 获取字幕
 * @param {string} baseUrl - 从 ytInitialPlayerResponse 获取的基础URL
 * @param {string} videoId - 视频ID
 * @returns {Promise<Array>} 字幕事件数组
 */
async function fetchTimedText(baseUrl, videoId) {
  // 获取 POT token
  const pot = await getPOToken(videoId);

  // 构建完整URL
  // fmt=json3 返回结构化的JSON数据
  // c=WEB 表示Web客户端
  const url = pot
    ? `${baseUrl}&fmt=json3&pot=${pot}&c=WEB`
    : `${baseUrl}&fmt=json3`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Timedtext API failed: ${response.status}`);
  }

  const data = await response.json();

  // 返回字幕事件数组
  return data.events || [];
}
```

**返回数据结构 (json3格式)**：

```javascript
{
  "wireMagic": "pb3",
  "events": [
    {
      "tStartMs": 1000,       // 开始时间（毫秒）
      "dDurationMs": 3000,    // 持续时间（毫秒）
      "segs": [               // 文本片段数组
        { "utf8": "Hello " },
        { "utf8": "world" }
      ]
    },
    {
      "tStartMs": 4000,
      "dDurationMs": 2500,
      "segs": [
        { "utf8": "This is " },
        { "utf8": "a test" }
      ]
    },
    // ... 更多字幕事件
  ]
}
```

### 3.3 方法二：DOM Transcript 面板解析（备用方案）

当 API 方法失败时，尝试从页面的转录面板DOM中提取：

```javascript
/**
 * 从页面 DOM 提取字幕
 * 通过模拟点击"显示转录"按钮，然后解析转录面板
 * @returns {Promise<Array|null>} 字幕数组或null
 */
async function extractFromDOM() {
  // 1. 查找"显示转录"按钮（多种可能的选择器）
  const TRANSCRIPT_BUTTON_SELECTORS = [
    'button[aria-label="Show transcript"]',
    '#button[aria-label="Show transcript"]',
    'ytd-video-description-transcript-section-renderer #primary-button button',
    '#primary-button > ytd-button-renderer > yt-button-shape > button'
  ];

  let transcriptBtn = null;
  for (const selector of TRANSCRIPT_BUTTON_SELECTORS) {
    transcriptBtn = document.querySelector(selector);
    if (transcriptBtn) break;
  }

  if (!transcriptBtn) {
    return null;
  }

  // 2. 点击按钮打开转录面板
  transcriptBtn.click();

  // 3. 等待转录面板加载
  const SEGMENTS_SELECTOR = "#segments-container > ytd-transcript-segment-renderer";

  const loaded = await waitForElement(SEGMENTS_SELECTOR, 3000);
  if (!loaded) {
    return null;
  }

  // 额外等待确保内容完全渲染
  await new Promise(resolve => setTimeout(resolve, 300));

  // 4. 提取所有字幕片段
  const segments = document.querySelectorAll(SEGMENTS_SELECTOR);

  if (!segments.length) {
    return null;
  }

  const transcript = [];

  segments.forEach(segment => {
    // 提取时间戳
    const timestamp = segment
      .querySelector("div.segment-timestamp")
      ?.textContent
      ?.trim();

    // 提取文本内容
    const text = segment
      .querySelector("yt-formatted-string")
      ?.textContent
      ?.trim();

    if (timestamp && text) {
      transcript.push({
        tStartMs: parseTimestamp(timestamp),
        segs: [{ utf8: text }]
      });
    }
  });

  return transcript.length > 0 ? transcript : null;
}

/**
 * 等待元素出现
 * @param {string} selector - CSS选择器
 * @param {number} timeout - 超时时间（毫秒）
 * @returns {Promise<boolean>} 是否成功找到元素
 */
function waitForElement(selector, timeout = 3000) {
  return new Promise(resolve => {
    // 元素已存在
    if (document.querySelector(selector)) {
      return resolve(true);
    }

    // 使用 MutationObserver 监听DOM变化
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

    // 超时处理
    setTimeout(() => {
      observer.disconnect();
      resolve(false);
    }, timeout);
  });
}

/**
 * 解析时间戳字符串为毫秒
 * @param {string} str - 时间戳字符串，如 "1:23" 或 "1:23:45"
 * @returns {number} 毫秒数
 */
function parseTimestamp(str) {
  const parts = str.split(':').map(Number);

  if (parts.length === 2) {
    // MM:SS 格式
    return (parts[0] * 60 + parts[1]) * 1000;
  } else if (parts.length === 3) {
    // HH:MM:SS 格式
    return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
  }

  return 0;
}
```

### 3.4 方法三：YouTubei Internal API（最后手段）

使用 YouTube 的内部 API 端点获取字幕：

```javascript
/**
 * 通过 YouTube 内部 API 获取字幕
 * @param {Object} ytData - ytInitialData 对象
 * @returns {Promise<Array>} 字幕片段数组
 */
async function fetchViaInternalAPI(ytData) {
  // 1. 从 engagementPanels 中查找 transcript 参数
  const transcriptPanel = ytData.engagementPanels?.find(panel =>
    panel.engagementPanelSectionListRenderer
      ?.content
      ?.continuationItemRenderer
      ?.continuationEndpoint
      ?.getTranscriptEndpoint
  );

  const params = transcriptPanel
    ?.engagementPanelSectionListRenderer
    ?.content
    ?.continuationItemRenderer
    ?.continuationEndpoint
    ?.getTranscriptEndpoint
    ?.params;

  if (!params) {
    throw new Error("No transcript params found in ytInitialData");
  }

  // 2. 获取请求所需的上下文信息
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

  // 3. 生成客户端版本号（模拟真实客户端）
  const clientVersion = generateClientVersion();

  // 4. 构建请求体
  const payload = {
    context: {
      client: {
        hl: hl,
        visitorData: visitorData,
        clientName: "WEB",
        clientVersion: clientVersion
      },
      request: {
        useSsl: true
      }
    },
    params: params
  };

  // 5. 发送请求
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
    throw new Error(`Internal API failed: ${response.status}`);
  }

  const data = await response.json();

  // 6. 提取字幕片段
  const segments = data.actions?.[0]
    ?.updateEngagementPanelAction
    ?.content
    ?.transcriptRenderer
    ?.content
    ?.transcriptSearchPanelRenderer
    ?.body
    ?.transcriptSegmentListRenderer
    ?.initialSegments || [];

  return segments;
}

/**
 * 生成模拟的客户端版本号
 * 格式: 2.YYYYMMDD.00.00
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
```

**Internal API 返回数据结构**：

```javascript
{
  "actions": [{
    "updateEngagementPanelAction": {
      "content": {
        "transcriptRenderer": {
          "content": {
            "transcriptSearchPanelRenderer": {
              "body": {
                "transcriptSegmentListRenderer": {
                  "initialSegments": [
                    {
                      "transcriptSegmentRenderer": {
                        "startMs": "1000",
                        "endMs": "4000",
                        "startTimeText": { "simpleText": "0:01" },
                        "snippet": {
                          "runs": [
                            { "text": "Hello world" }
                          ]
                        }
                      }
                    }
                    // ... 更多片段
                  ]
                }
              }
            }
          }
        }
      }
    }
  }]
}
```

### 3.5 字幕数据规范化

由于不同方法返回的数据格式不同，需要统一处理：

```javascript
/**
 * 规范化字幕数据
 * 将不同来源的数据统一为 [timestamp, text] 格式
 * @param {Array} events - 原始字幕事件数组
 * @param {string} resolvedType - 数据来源类型 ("regular" | "shorts")
 * @returns {Array} 规范化后的字幕数组 [[timestamp, text], ...]
 */
function normalizeTranscript(events, resolvedType) {
  if (!events || events.length === 0) {
    return [];
  }

  const firstEvent = events[0];

  // 判断数据来源并相应处理

  // 来源1: Internal API (transcriptSegmentRenderer 格式)
  if (firstEvent.transcriptSegmentRenderer) {
    return events.map(event => {
      const renderer = event.transcriptSegmentRenderer;
      const timestamp = renderer.startTimeText?.simpleText || "";
      const text = renderer.snippet?.runs
        ?.map(run => run.text)
        .join(" ") || "";
      return [timestamp, text];
    });
  }

  // 来源2: Timedtext API (segs 格式)
  if (firstEvent.segs || firstEvent.tStartMs !== undefined) {
    return events
      .filter(event => event.segs) // 过滤无效事件
      .map(event => {
        const timestamp = formatMilliseconds(event.tStartMs);
        const text = event.segs
          .map(seg => seg.utf8)
          .join(" ")
          .replace(/\n/g, " "); // 移除换行
        return [timestamp, text];
      });
  }

  // 默认处理（根据类型判断）
  if (resolvedType === "regular") {
    return events.map(event => {
      const renderer = event.transcriptSegmentRenderer;
      if (!renderer) return ["", ""];
      return [
        renderer.startTimeText?.simpleText || "",
        renderer.snippet?.runs?.map(r => r.text).join(" ") || ""
      ];
    });
  }

  // shorts 或其他类型
  return events
    .filter(event => event.segs)
    .map(event => [
      formatMilliseconds(event.tStartMs),
      event.segs.map(seg => seg.utf8).join(" ").replace(/\n/g, " ")
    ]);
}

/**
 * 将毫秒转换为时间戳字符串
 * @param {number} ms - 毫秒数
 * @returns {string} 格式化的时间戳 "M:SS" 或 "H:MM:SS"
 */
function formatMilliseconds(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
```

### 3.6 完整的字幕提取流程

```javascript
/**
 * 主函数：获取视频字幕
 * @param {string} url - 视频URL
 * @returns {Promise<{title: string, transcript: Array}>}
 */
async function getTranscript(url) {
  // 判断是否为 Shorts 视频
  const isShorts = /youtube\.com\/shorts\//.test(url);

  // 提取视频ID
  const videoId = isShorts
    ? url.split("/shorts/")[1].split(/[/?#&]/)[0]
    : new URLSearchParams(new URL(url).search).get("v");

  if (!videoId) {
    throw new Error("Could not extract video ID");
  }

  // ============ 普通视频处理流程 ============
  if (!isShorts) {
    // 步骤1: 获取页面数据
    const { title, ytData, dataKey, resolvedType } = await fetchVideoPageData(url);

    // 步骤2: 尝试获取字幕
    const events = await fetchTranscriptEvents(ytData, dataKey, videoId);

    if (!events.length) {
      return { title, transcript: [] };
    }

    // 步骤3: 规范化数据
    return {
      title,
      transcript: normalizeTranscript(events, resolvedType)
    };
  }

  // ============ Shorts 视频处理流程 ============
  // Shorts 需要特殊处理：转换为普通视频URL再获取
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;

  try {
    // 通过 background script 获取HTML（避免CORS）
    const response = await chrome.runtime.sendMessage({
      action: "fetchTransformedUrl",
      url: watchUrl
    });

    if (!response.success) {
      throw new Error("Failed to fetch transformed URL");
    }

    const { title, ytData, dataKey, resolvedType } = extractDataFromHtml(response.html);
    const events = await fetchTranscriptEvents(ytData, dataKey, videoId);

    if (!events.length) {
      return { title, transcript: [] };
    }

    return {
      title,
      transcript: normalizeTranscript(events, resolvedType)
    };

  } catch (error) {
    throw new Error("This Short doesn't have captions available.");
  }
}

/**
 * 获取字幕事件（带降级机制）
 */
async function fetchTranscriptEvents(ytData, dataKey, videoId) {
  // 方法1: 尝试 Timedtext API
  try {
    // 先尝试从页面脚本获取 baseUrl
    let baseUrl = extractCaptionUrlFromPage();

    if (!baseUrl) {
      // 从 ytInitialPlayerResponse 获取
      const playerResponse = dataKey === "ytInitialPlayerResponse"
        ? ytData
        : await fetchPlayerResponse();

      baseUrl = playerResponse?.captions
        ?.playerCaptionsTracklistRenderer
        ?.captionTracks?.[0]
        ?.baseUrl;
    }

    if (baseUrl) {
      const pot = await getPOToken(videoId);
      const url = pot
        ? `${baseUrl}&fmt=json3&pot=${pot}&c=WEB`
        : `${baseUrl}&fmt=json3`;

      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        if (data.events?.length > 0) {
          return data.events;
        }
      }
    }
  } catch (e) {
    console.warn("Timedtext API failed:", e);
  }

  // 方法2: 尝试 DOM 解析
  try {
    const domTranscript = await extractFromDOM();
    if (domTranscript?.length > 0) {
      return domTranscript;
    }
  } catch (e) {
    console.warn("DOM extraction failed:", e);
  }

  // 方法3: 尝试 Internal API
  if (ytData.engagementPanels) {
    try {
      const segments = await fetchViaInternalAPI(ytData);
      if (segments.length > 0) {
        return segments;
      }
    } catch (e) {
      console.warn("Internal API failed:", e);
    }
  }

  throw new Error("No captions found. This video may not have subtitles.");
}
```

---

## 四、Chrome Extension 架构详解

### 4.1 Manifest V3 配置

```json
{
  "manifest_version": 3,
  "name": "YouTube Transcript Copier",
  "version": "1.5.0",
  "description": "Copy YouTube video transcripts with one click",

  "permissions": [
    "activeTab",      // 访问当前活动标签页
    "storage",        // 使用 chrome.storage API
    "scripting",      // 动态注入脚本
    "sidePanel"       // 侧边栏功能
  ],

  "host_permissions": [
    "*://*.youtube.com/*"  // 访问 YouTube 域名
  ],

  "background": {
    "service_worker": "background.js",
    "type": "module"
  },

  "content_scripts": [{
    "matches": ["*://*.youtube.com/*"],
    "js": ["shared/formatting.js", "content.js"],
    "run_at": "document_idle"  // DOM完成后注入
  }],

  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "images/icon16.png",
      "48": "images/icon48.png",
      "128": "images/icon128.png"
    }
  },

  "side_panel": {
    "default_path": "sidepanel/sidepanel.html"
  },

  "icons": {
    "16": "images/icon16.png",
    "48": "images/icon48.png",
    "128": "images/icon128.png"
  }
}
```

### 4.2 Background Service Worker (background.js)

```javascript
// ============ 常量定义 ============
const BACKEND_URL = "https://cyt.hamzaw.com";
const GRACE_PERIOD_MS = 259200000;  // 3天宽限期
const DEFAULT_AI_LIMITS = {
  burst_limit: 10,
  burst_window_hours: 48,
  daily_limit: 3
};

// ============ 状态管理 ============
const sidePanelState = new Map();  // 追踪各标签页的侧边栏状态
const tabVideoIds = new Map();     // 追踪各标签页的当前视频ID

// ============ 消息处理中心 ============
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action } = message;

  switch (action) {
    // 获取字幕（供侧边栏使用）
    case "getTranscriptForSidePanel":
      handleGetTranscript(sender, sendResponse);
      return true;  // 表示异步响应

    // AI 聊天请求
    case "chatWithAI":
      handleAIChat(message, sendResponse);
      return true;

    // 打开侧边栏
    case "openSidePanel":
      if (sender.tab?.id) {
        chrome.sidePanel.open({ tabId: sender.tab.id });
        sidePanelState.set(sender.tab.id, true);
        sendResponse({ success: true });
      }
      return true;

    // 切换侧边栏
    case "toggleSidePanel":
      if (sender.tab?.id) {
        const isOpen = sidePanelState.get(sender.tab.id);
        if (isOpen) {
          chrome.runtime.sendMessage({
            action: "closeSidePanel",
            tabId: sender.tab.id
          });
          sidePanelState.set(sender.tab.id, false);
        } else {
          chrome.sidePanel.open({ tabId: sender.tab.id });
          sidePanelState.set(sender.tab.id, true);
        }
        sendResponse({ success: true });
      }
      return true;

    // 获取转换后的URL（用于Shorts）
    case "fetchTransformedUrl":
      fetch(message.url)
        .then(r => r.text())
        .then(html => sendResponse({ success: true, html }))
        .catch(e => sendResponse({ success: false, error: e.message }));
      return true;

    // AI 使用量检查
    case "checkAiLimit":
      checkAiUsageAllowed().then(sendResponse);
      return true;

    // 记录 AI 使用
    case "recordAiUsage":
      recordAiUsage().then(sendResponse);
      return true;

    // 保存对话历史
    case "saveSummaryToHistory":
      saveSummaryToHistory(message).then(sendResponse);
      return true;
  }
});

// ============ 标签页状态追踪 ============
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url?.includes("youtube.com/watch")) {
    const videoId = getVideoIdFromUrl(changeInfo.url);
    const previousId = tabVideoIds.get(tabId);

    // 视频切换时通知侧边栏
    if (videoId && videoId !== previousId) {
      tabVideoIds.set(tabId, videoId);
      chrome.runtime.sendMessage({
        action: "videoChanged",
        videoId,
        tabId
      }).catch(() => {});  // 忽略无接收者的错误
    }
  }
});

// 清理已关闭标签的状态
chrome.tabs.onRemoved.addListener(tabId => {
  tabVideoIds.delete(tabId);
  sidePanelState.delete(tabId);
});

// ============ 辅助函数 ============
function getVideoIdFromUrl(url) {
  if (!url) return null;
  const match = url.match(/[?&]v=([^&]+)/);
  return match ? match[1] : null;
}

async function handleGetTranscript(sender, sendResponse) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.id || !tab.url?.includes("youtube.com")) {
      sendResponse({ success: false, error: "No YouTube video detected" });
      return;
    }

    // 尝试向内容脚本发送消息
    try {
      const result = await chrome.tabs.sendMessage(tab.id, {
        action: "getTranscript"
      });
      sendResponse(result);
    } catch (error) {
      // 内容脚本可能未加载，尝试注入
      if (error.message.includes("Receiving end does not exist")) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["shared/formatting.js", "content.js"]
        });

        await new Promise(r => setTimeout(r, 500));

        const result = await chrome.tabs.sendMessage(tab.id, {
          action: "getTranscript"
        });
        sendResponse(result);
      } else {
        sendResponse({ success: false, error: error.message });
      }
    }
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function handleAIChat(message, sendResponse) {
  const { transcript, prompt, history } = message;

  try {
    const response = await fetch(`${BACKEND_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript, prompt, history: history || [] })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      sendResponse({
        success: false,
        error: error.error || `Request failed: ${response.status}`
      });
      return;
    }

    const data = await response.json();
    sendResponse({ success: true, response: data.response });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}
```

### 4.3 Content Script (content.js) 主结构

```javascript
// 使用 IIFE 避免污染全局命名空间
(function() {
  // 防止重复注入
  if (window.hasTranscriptScript && window.transcriptListenerActive) {
    return;
  }

  window.hasTranscriptScript = true;
  window.transcriptListenerActive = true;

  // ============ 状态变量 ============
  let currentUrl = "";
  let copyButtonInjected = false;
  let aiButtonInjected = false;
  let observer = null;

  // ============ 消息监听 ============
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
      case "copyTranscript":
        handleCopyTranscript().then(sendResponse);
        return true;

      case "getTranscript":
        handleGetTranscript().then(sendResponse);
        return true;

      case "updateInPageButton":
        initializeInPageButton();
        sendResponse({ status: "updated" });
        return true;

      case "seekVideo":
        const video = document.querySelector("video");
        if (video) {
          video.currentTime = message.time;
          video.play().catch(() => {});
        }
        sendResponse({ success: true });
        return true;
    }
  });

  // ============ 键盘快捷键 ============
  document.addEventListener("keydown", (e) => {
    // Alt+A: 切换侧边栏
    if (e.altKey && e.code === "KeyA") {
      e.preventDefault();
      chrome.runtime.sendMessage({ action: "toggleSidePanel" });
    }

    // Alt+C: 复制字幕
    if (e.altKey && e.code === "KeyC") {
      e.preventDefault();
      handleCopyTranscript();
    }
  });

  // ============ 初始化 ============
  function initialize() {
    initializeInPageButton();
    setupNavigationObserver();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize);
  } else {
    initialize();
  }
})();
```

---

## 五、数据存储架构

### 5.1 存储类型对比

| API | 用途 | 同步范围 | 容量限制 |
|-----|------|---------|---------|
| `chrome.storage.sync` | 用户设置、偏好 | 跨设备同步 | 100KB |
| `chrome.storage.local` | 历史记录、缓存 | 仅本地 | 5MB |

### 5.2 数据结构定义

```javascript
// ============ chrome.storage.sync 数据结构 ============

// 格式化设置
const formatSettings = {
  showTimestamps: true,    // 显示时间戳
  showTitle: true,         // 显示视频标题
  showUrl: false,          // 显示视频URL
  addSpacing: true,        // 行间添加空行
  paragraphStyle: false,   // 段落模式（所有文本连成一段）
  addPrompt: false         // 添加自定义提示词
};

// 提示词设置
const promptSettings = {
  prompt: "Please summarize this transcript:"
};

// UI 设置
const uiSettings = {
  showInPageButton: true,           // 页面内显示复制按钮
  showInPageAISummaryButton: false, // 页面内显示AI摘要按钮
  showDownloadButton: true,         // 显示下载按钮
  showLivePreview: false,           // 显示实时预览
  trackHistory: true                // 记录历史
};

// LLM 集成设置
const llmSettings = {
  enabled: false,
  provider: "chatgpt",  // chatgpt | claude | gemini | perplexity | custom
  customUrl: ""         // 自定义URL模板
};

// 自定义侧边栏命令
const customSidepanelCommand = {
  label: "My Custom Command",
  prompt: "Do something with this transcript..."
};

// ============ chrome.storage.local 数据结构 ============

// 历史记录
const transcriptHistory = [
  {
    id: "history_1704067200000_abc123",
    url: "https://youtube.com/watch?v=dQw4w9WgXcQ",
    title: "Video Title",
    timestamp: 1704067200000,
    action: "copy",  // copy | download | ai-summary
    wordCount: 1500,
    transcriptPreview: "First 200 characters of transcript...",
    // AI 相关字段（可选）
    aiSummary: "AI generated summary...",
    aiConversation: [
      { role: "user", content: "Summarize this" },
      { role: "assistant", content: "This video discusses..." }
    ],
    aiSummaryTimestamp: 1704067500000
  }
];

// AI 使用量追踪
const aiUsage = {
  firstUseTimestamp: 1704067200000,  // 首次使用时间（用于试用期判断）
  usageLog: [                         // 使用记录（时间戳数组）
    1704067200000,
    1704070800000,
    1704074400000
  ]
};

// AI 限制缓存
const aiLimitsCache = {
  burst_limit: 10,
  burst_window_hours: 48,
  daily_limit: 3,
  fetchedAt: 1704067200000
};

// 设备ID（用于许可证验证）
const deviceId = "550e8400-e29b-41d4-a716-446655440000";
```

### 5.3 存储操作封装

```javascript
// ============ 设置管理 ============

async function loadSettings() {
  const defaults = {
    formatSettings: {
      showTimestamps: true,
      showTitle: true,
      showUrl: false,
      addSpacing: true,
      paragraphStyle: false,
      addPrompt: false
    },
    promptSettings: { prompt: "" },
    uiSettings: {
      showInPageButton: false,
      showDownloadButton: true,
      showLivePreview: false
    },
    llmSettings: {
      enabled: false,
      provider: "chatgpt",
      customUrl: ""
    }
  };

  const stored = await chrome.storage.sync.get(Object.keys(defaults));

  return {
    formatSettings: { ...defaults.formatSettings, ...stored.formatSettings },
    promptSettings: { ...defaults.promptSettings, ...stored.promptSettings },
    uiSettings: { ...defaults.uiSettings, ...stored.uiSettings },
    llmSettings: { ...defaults.llmSettings, ...stored.llmSettings }
  };
}

async function saveSettings(settings) {
  await chrome.storage.sync.set(settings);
}

// ============ 历史记录管理 ============

async function addHistoryEntry(transcriptData, action) {
  const { transcriptHistory = [] } = await chrome.storage.local.get("transcriptHistory");

  const entry = {
    id: `history_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    url: transcriptData.url,
    title: transcriptData.title || "Untitled Video",
    timestamp: Date.now(),
    action: action,
    wordCount: countWords(transcriptData.transcript),
    transcriptPreview: getPreview(transcriptData.transcript, 200)
  };

  // 检查是否已存在相同URL的记录
  const existingIndex = transcriptHistory.findIndex(h => h.url === entry.url);
  if (existingIndex !== -1) {
    // 更新现有记录
    transcriptHistory[existingIndex] = {
      ...transcriptHistory[existingIndex],
      ...entry,
      id: transcriptHistory[existingIndex].id  // 保留原ID
    };
  } else {
    // 添加新记录
    transcriptHistory.unshift(entry);
  }

  // 限制历史记录数量
  const MAX_HISTORY = 500;
  if (transcriptHistory.length > MAX_HISTORY) {
    transcriptHistory.splice(MAX_HISTORY);
  }

  await chrome.storage.local.set({ transcriptHistory });
  return entry;
}

async function getHistory(limit = 50) {
  const { transcriptHistory = [] } = await chrome.storage.local.get("transcriptHistory");
  return transcriptHistory.slice(0, limit);
}

async function clearHistory() {
  await chrome.storage.local.remove("transcriptHistory");
}

// ============ AI 使用量管理 ============

async function checkAiUsageAllowed() {
  // Pro用户检查
  const { licenseStatus } = await chrome.storage.local.get("licenseStatus");
  if (licenseStatus === "active") {
    return { allowed: true, remaining: -1, isUnlimited: true };
  }

  const limits = await getAiLimits();
  const { aiUsage = { firstUseTimestamp: null, usageLog: [] } } =
    await chrome.storage.local.get("aiUsage");

  const now = Date.now();
  const burstWindow = limits.burst_window_hours * 60 * 60 * 1000;
  const dayWindow = 24 * 60 * 60 * 1000;

  // 是否在试用期
  const isOnboarding = !aiUsage.firstUseTimestamp ||
    (now - aiUsage.firstUseTimestamp < burstWindow);

  // 过滤有效的使用记录
  const recentUsage = aiUsage.usageLog.filter(t => t > now - burstWindow);
  const todayUsage = recentUsage.filter(t => t > now - dayWindow);

  if (isOnboarding) {
    const bonusRemaining = Math.max(0, limits.burst_limit - recentUsage.length);
    const dailyRemaining = Math.max(0, limits.daily_limit - todayUsage.length);
    return {
      allowed: bonusRemaining + dailyRemaining > 0,
      remaining: bonusRemaining + dailyRemaining,
      isOnboarding: true,
      bonusRemaining,
      dailyRemaining
    };
  }

  return {
    allowed: todayUsage.length < limits.daily_limit,
    remaining: Math.max(0, limits.daily_limit - todayUsage.length),
    isOnboarding: false,
    usedToday: todayUsage.length
  };
}

async function recordAiUsage() {
  const { aiUsage = { firstUseTimestamp: null, usageLog: [] } } =
    await chrome.storage.local.get("aiUsage");

  const now = Date.now();

  if (!aiUsage.firstUseTimestamp) {
    aiUsage.firstUseTimestamp = now;
  }

  aiUsage.usageLog.push(now);

  // 清理过期记录（保留7天内的）
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  aiUsage.usageLog = aiUsage.usageLog.filter(t => t > weekAgo);

  await chrome.storage.local.set({ aiUsage });

  return checkAiUsageAllowed();
}
```

---

## 六、字幕格式化与导出

### 6.1 格式化模块 (formatting.js)

```javascript
(function() {
  "use strict";

  /**
   * 规范化字幕数据结构
   * @param {Array} transcript - 原始字幕数据
   * @returns {Array} 规范化后的 [{timestamp, text}] 数组
   */
  function normalizeTranscript(transcript) {
    if (!transcript || !Array.isArray(transcript)) {
      return [];
    }

    return transcript.map(item => {
      // 处理数组格式 [timestamp, text]
      if (Array.isArray(item)) {
        return {
          timestamp: item[0] || "",
          text: item[1] || ""
        };
      }
      // 处理对象格式 {timestamp, text}
      return {
        timestamp: item.timestamp || "",
        text: item.text || ""
      };
    });
  }

  /**
   * 格式化字幕为文本
   * @param {Object} options - 格式化选项
   * @returns {string} 格式化后的文本
   */
  function formatTranscript(options) {
    const {
      transcript,
      title,
      url,
      formatSettings: {
        showTimestamps = true,
        showTitle = true,
        showUrl = false,
        addSpacing = true,
        paragraphStyle = false,
        addPrompt = false
      } = {},
      promptSettings: {
        prompt = ""
      } = {}
    } = options;

    let output = "";

    // 添加提示词
    if (addPrompt && prompt) {
      output = prompt + "\n\n";
    }

    // 添加标题
    if (showTitle && title) {
      output += `Title: ${title}\n`;
    }

    // 添加URL
    if (showUrl && url) {
      output += `URL: ${url}\n`;
    }

    // 添加分隔
    if ((showTitle || showUrl) && output) {
      output += "\n";
    }

    // 格式化字幕内容
    const normalized = normalizeTranscript(transcript);

    if (paragraphStyle) {
      // 段落模式：所有文本连成一段
      output += normalized.map(item => item.text.trim()).join(" ");
    } else {
      // 列表模式
      const separator = addSpacing ? "\n\n" : "\n";
      output += normalized.map(item => {
        if (showTimestamps && item.timestamp) {
          return `(${item.timestamp}) ${item.text}`;
        }
        return item.text;
      }).join(separator);
    }

    return output.trim();
  }

  // 导出到全局
  if (typeof window !== "undefined") {
    window.TranscriptFormatting = {
      formatTranscript,
      normalizeTranscript
    };
  }
})();
```

### 6.2 导出功能 (export.js)

```javascript
window.TranscriptCopier = window.TranscriptCopier || {};

window.TranscriptCopier.export = (function() {
  "use strict";

  const utils = window.TranscriptCopier.utils;
  let jspdfLoaded = false;
  let jspdfLoading = false;

  /**
   * 格式化字幕（使用共享模块）
   */
  function formatTranscript(transcript, title, url, settings) {
    return window.TranscriptFormatting.formatTranscript({
      transcript,
      title,
      url,
      formatSettings: {
        showTimestamps: settings.showTimestamps,
        showTitle: settings.showTitle,
        showUrl: settings.showUrl,
        addSpacing: settings.addSpacing,
        paragraphStyle: settings.paragraphStyle ?? settings.isParagraphStyle,
        addPrompt: settings.addPrompt
      },
      promptSettings: {
        prompt: settings.prompt
      }
    });
  }

  /**
   * 清理文件名
   */
  function sanitizeFilename(name) {
    return (name || "transcript")
      .replace(/[<>:"/\\|?*]/g, "")
      .substring(0, 100);
  }

  /**
   * 下载为文本文件
   */
  async function downloadAsText(transcript, title, url, settings) {
    if (!transcript) return;

    const content = formatTranscript(transcript, title, url, settings);
    const filename = sanitizeFilename(title);

    const blob = new Blob([content], { type: "text/plain" });
    const downloadUrl = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = `${filename}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(downloadUrl);
  }

  /**
   * 加载 jsPDF 库
   */
  async function loadJsPDF() {
    if (jspdfLoaded && window.jspdf) {
      return true;
    }

    if (jspdfLoading) {
      // 等待加载完成
      return new Promise(resolve => {
        const interval = setInterval(() => {
          if (jspdfLoaded && window.jspdf) {
            clearInterval(interval);
            resolve(true);
          }
        }, 50);
      });
    }

    jspdfLoading = true;

    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "jspdf.min.js";
      script.onload = () => {
        jspdfLoaded = true;
        jspdfLoading = false;
        resolve(true);
      };
      script.onerror = () => {
        jspdfLoading = false;
        reject(new Error("Failed to load PDF library"));
      };
      document.head.appendChild(script);
    });
  }

  /**
   * 导出为 PDF
   */
  async function exportAsPDF(transcript, title, url, settings) {
    try {
      await loadJsPDF();

      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4"
      });

      doc.setFont("helvetica");

      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 20;
      const contentWidth = pageWidth - margin * 2;
      let yPos = 20;

      // 标题
      if (settings.showTitle && title) {
        doc.setFontSize(16);
        doc.setFont("helvetica", "bold");
        const titleLines = doc.splitTextToSize(title, contentWidth);
        doc.text(titleLines, margin, yPos);
        yPos += titleLines.length * 8 + 5;
      }

      // URL
      if (settings.showUrl && url) {
        doc.setFontSize(10);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(100, 100, 100);
        const urlLines = doc.splitTextToSize(url, contentWidth);
        doc.text(urlLines, margin, yPos);
        yPos += 10;
      }

      // 提示词
      if (settings.addPrompt && settings.prompt) {
        doc.setFontSize(11);
        doc.setFont("helvetica", "italic");
        doc.setTextColor(80, 80, 80);
        const promptLines = doc.splitTextToSize(settings.prompt, contentWidth);
        doc.text(promptLines, margin, yPos);
        yPos += promptLines.length * 5 + 10;
      }

      // 重置文本样式
      doc.setFontSize(11);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(0, 0, 0);

      // 字幕内容
      const isParagraph = settings.isParagraphStyle ?? settings.paragraphStyle;

      if (isParagraph) {
        // 段落模式
        const text = transcript.map(t => t.text.trim()).join(" ");
        const lines = doc.splitTextToSize(text, contentWidth);

        for (const line of lines) {
          if (yPos > pageHeight - margin) {
            doc.addPage();
            yPos = margin;
          }
          doc.text(line, margin, yPos);
          yPos += 5;
        }
      } else {
        // 列表模式
        for (const segment of transcript) {
          let prefix = "";

          if (settings.showTimestamps && segment.timestamp) {
            doc.setFont("helvetica", "bold");
            prefix = `[${segment.timestamp}] `;
          }

          const lines = doc.splitTextToSize(
            segment.text,
            contentWidth - (prefix ? 20 : 0)
          );

          if (yPos + lines.length * 5 > pageHeight - margin) {
            doc.addPage();
            yPos = margin;
          }

          if (prefix) {
            doc.text(prefix, margin, yPos);
            doc.setFont("helvetica", "normal");
            doc.text(lines, margin + 20, yPos);
          } else {
            doc.text(lines, margin, yPos);
          }

          yPos += lines.length * 5;

          if (settings.addSpacing) {
            yPos += 3;
          }
        }
      }

      const filename = sanitizeFilename(title);
      doc.save(`${filename}.pdf`);

    } catch (error) {
      console.error("PDF export error:", error);
      throw error;
    }
  }

  /**
   * 导出为 Markdown
   */
  async function exportAsMarkdown(transcript, title, url, settings) {
    let content = "";

    // 提示词
    if (settings.addPrompt && settings.prompt) {
      content += `> ${settings.prompt}\n\n---\n\n`;
    }

    // 标题
    if (settings.showTitle && title) {
      content += `# ${title}\n\n`;
    }

    // URL
    if (settings.showUrl && url) {
      content += `**Source:** [${url}](${url})\n\n`;
    }

    // 分隔线
    if ((settings.showTitle || settings.showUrl) && transcript.length > 0) {
      content += "---\n\n";
    }

    // 字幕内容
    const isParagraph = settings.isParagraphStyle ?? settings.paragraphStyle;

    if (isParagraph) {
      content += transcript.map(t => t.text.trim()).join(" ");
    } else {
      transcript.forEach(segment => {
        if (settings.showTimestamps && segment.timestamp) {
          content += `**[${segment.timestamp}]** ${segment.text}`;
        } else {
          content += segment.text;
        }
        content += settings.addSpacing ? "\n\n" : "\n";
      });
    }

    const blob = new Blob([content], { type: "text/markdown" });
    const downloadUrl = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = `${sanitizeFilename(title)}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(downloadUrl);
  }

  return {
    formatTranscript,
    downloadAsText,
    exportAsPDF,
    exportAsMarkdown
  };
})();
```

---

## 七、AI 对话功能

### 7.1 侧边栏实现 (sidepanel.js)

```javascript
(function() {
  "use strict";

  // ============ 状态变量 ============
  let elements = {};
  let transcript = null;
  let currentUrl = null;
  let currentTitle = null;
  let chatHistory = [];      // 发送给API的历史
  let displayHistory = [];   // 显示用的历史
  let customCommand = null;
  let tabId = null;
  let usageInfo = null;
  let isPro = false;

  // ============ 初始化 ============
  async function initialize() {
    // 检查Pro状态
    await checkProStatus();

    // 获取DOM元素
    cacheElements();

    // 检查使用量
    await checkUsage();

    // 绑定事件
    bindEvents();

    // 加载自定义命令
    await loadCustomCommand();

    // 获取当前标签ID
    await getCurrentTabId();

    // 加载字幕
    await loadTranscript();
  }

  function cacheElements() {
    elements = {
      chatArea: document.getElementById("chatArea"),
      emptyState: document.getElementById("emptyState"),
      messageInput: document.getElementById("messageInput"),
      sendBtn: document.getElementById("sendBtn"),
      videoTitle: document.getElementById("videoTitle"),
      // ... 更多元素
    };
  }

  // ============ 核心功能 ============

  async function loadTranscript() {
    try {
      const response = await chrome.runtime.sendMessage({
        action: "getTranscriptForSidePanel",
        tabId: tabId
      });

      if (response?.success && response?.transcript) {
        transcript = response.transcript;
        currentTitle = response.title || "YouTube Video";
        currentUrl = response.url || null;

        elements.videoTitle.textContent = currentTitle;
        updateEmptyState("Ready! Ask anything about this video");
        updateButtonStates();
      } else {
        elements.videoTitle.textContent = response?.error || "No transcript available";
        showEmptyState();
      }
    } catch (error) {
      console.error("Failed to load transcript:", error);
      elements.videoTitle.textContent = "Could not load video";
      showEmptyState();
    }
  }

  async function sendMessage() {
    const message = elements.messageInput.value.trim();
    if (!message) return;

    // 检查使用量限制
    if (!isPro) {
      const usage = await checkUsage();
      if (!usage.allowed) {
        showUpgradeModal("Free Limit Reached",
          "You've used all your free chats. Upgrade to Pro for unlimited access.");
        return;
      }
    }

    // 隐藏空状态
    hideEmptyState();
    collapseSuggestedActions();

    // 添加用户消息
    addMessage("user", message);

    // 清空输入
    elements.messageInput.value = "";
    elements.sendBtn.disabled = true;

    // 显示加载状态
    const loadingEl = showLoading();

    // 确保有字幕
    if (!transcript) {
      await loadTranscript();
      if (!transcript) {
        removeElement(loadingEl);
        addMessage("ai", "No transcript available. Please open a YouTube video with captions.");
        return;
      }
    }

    try {
      // 发送请求
      const response = await chrome.runtime.sendMessage({
        action: "chatWithAI",
        transcript: transcript,
        prompt: message,
        history: chatHistory
      });

      removeElement(loadingEl);

      if (response.success) {
        // 添加AI回复
        addMessage("ai", response.response);

        // 更新历史
        chatHistory.push(
          { role: "user", content: message },
          { role: "assistant", content: response.response }
        );

        updateButtonStates();

        // 记录使用量
        if (!isPro) {
          usageInfo = await chrome.runtime.sendMessage({ action: "recordAiUsage" });
          updateUsageCounter();
        }

        // 保存到历史
        await saveConversationToHistory();

      } else {
        addMessage("ai", formatError(response.error));
      }

    } catch (error) {
      removeElement(loadingEl);
      addMessage("ai", formatError(error.message));
    }
  }

  function addMessage(type, content) {
    const messageEl = document.createElement("div");
    messageEl.className = `message ${type}`;

    if (type === "ai") {
      // 渲染Markdown和时间戳链接
      messageEl.innerHTML = renderMarkdown(content);
    } else {
      messageEl.textContent = content;
    }

    elements.chatArea.appendChild(messageEl);
    displayHistory.push({ type, text: content });

    // 滚动到底部
    elements.chatArea.scrollTop = elements.chatArea.scrollHeight;

    return messageEl;
  }

  /**
   * 渲染Markdown格式的AI回复
   */
  function renderMarkdown(text) {
    return text
      // 时间戳链接
      .replace(
        /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g,
        '<a class="timestamp-link" data-time="$1">[$1]</a>'
      )
      // 标题
      .replace(/^### (.+)\n?/gm, "<h4>$1</h4>")
      .replace(/^## (.+)\n?/gm, "<h3>$1</h3>")
      .replace(/^# (.+)\n?/gm, "<h2>$1</h2>")
      // 粗体和斜体
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      // 列表
      .replace(
        /(^[\-\*] .+$(\n|$))+/gm,
        match => `<ul>${match.trim().split("\n")
          .map(line => `<li>${line.replace(/^[\-\*] /, "")}</li>`)
          .join("")}</ul>`
      )
      // 段落
      .replace(/\n\n+/g, "</p><p>")
      .replace(/(?<!>)\n(?!<)/g, "<br>")
      .replace(/^(.+)$/s, "<p>$1</p>")
      // 清理
      .replace(/<p><\/p>/g, "")
      .replace(/<p>(<h[234]>)/g, "$1")
      .replace(/(<\/h[234]>)<\/p>/g, "$1");
  }

  /**
   * 处理时间戳点击
   */
  async function seekToTime(timeStr) {
    const parts = timeStr.split(":").map(Number);
    let seconds;

    if (parts.length === 3) {
      seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else {
      seconds = parts[0] * 60 + parts[1];
    }

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, {
          action: "seekVideo",
          time: seconds
        });
      }
    } catch (error) {
      console.error("Failed to seek video:", error);
    }
  }

  // ============ 事件绑定 ============

  function bindEvents() {
    // 发送按钮
    elements.sendBtn.addEventListener("click", sendMessage);

    // 回车发送
    elements.messageInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // 输入变化
    elements.messageInput.addEventListener("input", () => {
      elements.sendBtn.disabled = !elements.messageInput.value.trim();
    });

    // 时间戳点击
    elements.chatArea.addEventListener("click", (e) => {
      if (e.target.classList.contains("timestamp-link")) {
        e.preventDefault();
        seekToTime(e.target.dataset.time);
      }
    });

    // 监听视频切换
    chrome.runtime.onMessage.addListener((message) => {
      if (message.action === "videoChanged") {
        if (message.tabId && tabId && message.tabId !== tabId) {
          return;
        }
        resetChat();
        loadTranscript();
      }

      if (message.action === "closeSidePanel") {
        if (message.tabId && tabId && message.tabId !== tabId) {
          return;
        }
        window.close();
      }
    });

    // 快捷键关闭
    document.addEventListener("keydown", (e) => {
      if (e.altKey && e.code === "KeyA") {
        e.preventDefault();
        window.close();
      }
    });
  }

  // ============ 辅助函数 ============

  async function checkProStatus() {
    const result = await new Promise(resolve => {
      chrome.storage.local.get(["proAccessEnabled", "licenseStatus"], resolve);
    });
    isPro = result.proAccessEnabled || result.licenseStatus === "active";
  }

  async function checkUsage() {
    usageInfo = await chrome.runtime.sendMessage({ action: "checkAiLimit" });
    updateUsageCounter();
    return usageInfo;
  }

  function updateUsageCounter() {
    const counter = elements.aiUsageCounter;
    const text = elements.counterText;

    if (!counter || !text) return;

    if (usageInfo?.isUnlimited) {
      counter.style.display = "none";
      return;
    }

    counter.style.display = "flex";
    const remaining = usageInfo?.remaining ?? 0;

    if (remaining === 0) {
      text.textContent = "No free chats left. 3 more tomorrow";
      counter.className = "ai-usage-counter exhausted";
    } else if (remaining <= 2) {
      text.textContent = `${remaining} free chat${remaining === 1 ? "" : "s"} remaining`;
      counter.className = "ai-usage-counter low";
    } else {
      text.textContent = `${remaining} free chats remaining`;
      counter.className = "ai-usage-counter";
    }
  }

  function resetChat() {
    transcript = null;
    currentUrl = null;
    currentTitle = null;
    chatHistory = [];
    displayHistory = [];
    elements.chatArea.innerHTML = "";
    elements.messageInput.value = "";
    elements.sendBtn.disabled = true;
    showEmptyState();
    updateButtonStates();
  }

  // ============ 启动 ============

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize);
  } else {
    initialize();
  }
})();
```

---

## 八、页面注入与UI交互

### 8.1 页面按钮注入

```javascript
// ============ 按钮注入位置选择器 ============
const ACTION_CONTAINER_SELECTORS = [
  "#below #actions",
  "#secondary-metadata #actions",
  "#secondary-inner #actions",
  "#primary #bottom #actions",
  "#metadata-side #actions",
  "ytd-menu-renderer #top-level-buttons-computed",
  "#actions #actions-inner #menu #top-level-buttons-computed"
];

// ============ 注入样式 ============
function injectStyles() {
  if (document.getElementById("ytc-injected-styles")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "ytc-injected-styles";
  style.textContent = `
    #ext-copy-transcript-btn {
      display: flex !important;
      align-items: center;
      margin-right: 8px;
    }
    #ext-ai-summary-btn {
      display: flex !important;
      align-items: center;
      margin-right: 8px;
    }
    #ext-copy-transcript-btn button,
    #ext-ai-summary-btn button {
      transition: background 0.2s, opacity 0.2s;
    }
    #ext-copy-transcript-btn button:hover,
    #ext-ai-summary-btn button:hover {
      opacity: 0.9;
    }
  `;
  document.head.appendChild(style);
}

// ============ 创建复制按钮 ============
function createCopyButton() {
  const wrapper = document.createElement("div");
  wrapper.id = "ext-copy-transcript-btn";
  wrapper.className = "style-scope ytd-menu-renderer";
  wrapper.style.cssText = "margin-right: 8px;";

  const button = document.createElement("button");
  button.className = [
    "yt-spec-button-shape-next",
    "yt-spec-button-shape-next--tonal",
    "yt-spec-button-shape-next--mono",
    "yt-spec-button-shape-next--size-m",
    "yt-spec-button-shape-next--enable-backdrop-filter-experiment"
  ].join(" ");
  button.setAttribute("aria-label", "Copy transcript");
  button.style.cssText = "position: relative;";

  const textWrapper = document.createElement("div");
  textWrapper.className = "yt-spec-button-shape-next__button-text-content";
  textWrapper.innerHTML = '<span class="ext-button-text">Copy Transcript</span>';

  button.appendChild(textWrapper);
  wrapper.appendChild(button);

  button.addEventListener("click", handleCopyClick);

  return wrapper;
}

// ============ 注入按钮 ============
async function injectCopyButton(retryCount = 0) {
  // 重试限制
  if (retryCount >= 30) return;

  // 避免重复注入
  if (document.getElementById("ext-copy-transcript-btn")) return;

  // 检查用户设置
  try {
    const { uiSettings } = await chrome.storage.sync.get("uiSettings");
    if (!uiSettings?.showInPageButton) return;
  } catch (e) {
    return;
  }

  // 检查是否在视频页面
  if (!window.location.href.includes("/watch")) return;

  // 查找容器
  let container = null;
  for (const selector of ACTION_CONTAINER_SELECTORS) {
    container = document.querySelector(selector);
    if (container) break;
  }

  if (!container) {
    // 页面尚未加载完成，重试
    setTimeout(() => injectCopyButton(retryCount + 1), 500);
    return;
  }

  injectStyles();

  // 创建按钮
  const button = createCopyButton();

  // 查找最佳插入位置
  const buttonsContainer = findButtonsContainer(container);
  const shareButton = findShareButton(buttonsContainer);

  if (shareButton) {
    shareButton.before(button);
  } else {
    const likeButton = buttonsContainer.querySelector(
      "segmented-like-dislike-button-view-model"
    );
    if (likeButton) {
      likeButton.before(button);
    } else {
      buttonsContainer.insertBefore(button, buttonsContainer.firstChild);
    }
  }
}

function findButtonsContainer(container) {
  return container.querySelector("#top-level-buttons-computed") ||
         container.querySelector("ytd-menu-renderer #top-level-buttons-computed") ||
         container;
}

function findShareButton(container) {
  // 通过aria-label查找
  const byLabel = container.querySelector('button[aria-label="Share"]');
  if (byLabel) {
    return byLabel.closest("yt-button-view-model") || byLabel.parentElement;
  }

  // 通过图标路径查找
  const buttons = container.querySelectorAll("button");
  for (const btn of buttons) {
    if (btn.querySelector('svg path[d^="M15"]')) {
      return btn.closest("yt-button-view-model") || btn.parentElement;
    }
  }

  return null;
}

// ============ 点击处理 ============
async function handleCopyClick() {
  const button = document.getElementById("ext-copy-transcript-btn");
  if (!button) return;

  const textEl = button.querySelector(".ext-button-text");
  const originalText = textEl.textContent;

  try {
    // 更新UI状态
    textEl.textContent = "Copying...";
    button.style.opacity = "0.7";

    // 获取设置
    const settings = await chrome.storage.sync.get([
      "formatSettings",
      "promptSettings",
      "llmSettings"
    ]);

    const formatSettings = settings.formatSettings || {
      showTimestamps: true,
      showTitle: true,
      showUrl: false,
      addSpacing: true,
      paragraphStyle: false,
      addPrompt: false
    };

    const promptSettings = settings.promptSettings || { prompt: "" };
    const llmSettings = settings.llmSettings || { enabled: false };

    // 获取字幕
    const url = window.location.href;
    const transcriptData = await getTranscript(url);

    // 格式化
    const formatted = formatTranscript(transcriptData, url, formatSettings, promptSettings);

    // 复制到剪贴板
    await copyToClipboard(formatted);

    // 打开LLM（如果启用）
    let llmOpened = false;
    if (llmSettings.enabled) {
      llmOpened = await openLLM(formatted, llmSettings);
    }

    // 更新UI反馈
    if (llmOpened?.success) {
      textEl.textContent = `✓ Opened ${llmOpened.providerName}!`;
    } else {
      textEl.textContent = "✓ Copied!";
    }

    button.style.opacity = "1";
    button.style.background = "rgba(52, 168, 83, 0.1)";

    // 恢复原状
    setTimeout(() => {
      textEl.textContent = originalText;
      button.style.background = "";
    }, 3000);

  } catch (error) {
    console.error("Error copying transcript:", error);

    // 检查扩展是否已更新
    if (error.message?.includes("Extension context invalidated")) {
      textEl.textContent = "Refresh page";
      alert("Extension was updated. Please refresh the page.");
      return;
    }

    textEl.textContent = "✗ Error";
    button.style.opacity = "1";
    button.style.background = "rgba(234, 67, 53, 0.1)";

    setTimeout(() => {
      textEl.textContent = originalText;
      button.style.background = "";
    }, 2000);
  }
}

// ============ 剪贴板操作 ============
function copyToClipboard(text) {
  return navigator.clipboard.writeText(text).catch(() => {
    // 降级方案：使用 execCommand
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    try {
      document.execCommand("copy");
      document.body.removeChild(textarea);
    } catch (e) {
      document.body.removeChild(textarea);
      throw new Error("Clipboard copy failed");
    }
  });
}

// ============ 页面导航监听 ============
function setupNavigationObserver() {
  let copyButtonInjected = false;
  let currentUrl = "";

  const observer = new MutationObserver(() => {
    const url = window.location.href;

    // URL变化
    if (url !== currentUrl) {
      currentUrl = url;
      copyButtonInjected = false;

      if (url.includes("/watch")) {
        injectCopyButton();
      }
    }
    // 按钮被移除
    else if (url.includes("/watch") && copyButtonInjected) {
      if (!document.getElementById("ext-copy-transcript-btn")) {
        copyButtonInjected = false;
        setTimeout(() => {
          if (!document.getElementById("ext-copy-transcript-btn")) {
            injectCopyButton();
          }
        }, 300);
      }
    }
  });

  observer.observe(document, {
    subtree: true,
    childList: true
  });

  // 监听 YouTube SPA 导航事件
  ["yt-navigate", "yt-navigate-finish"].forEach(event => {
    window.addEventListener(event, () => {
      copyButtonInjected = false;
      if (window.location.href.includes("/watch")) {
        injectCopyButton();
      }
    });
  });

  // 定时检查（作为备用）
  setInterval(() => {
    if (!window.location.href.includes("/watch")) return;

    if (!document.getElementById("ext-copy-transcript-btn")) {
      copyButtonInjected = false;
      injectCopyButton();
    }
  }, 1500);
}
```

---

## 九、关键技术总结

### 9.1 字幕提取核心要点

| 技术点 | 实现方式 | 关键代码位置 | 难度 |
|--------|---------|-------------|------|
| 页面数据提取 | 正则匹配 `ytInitialPlayerResponse` | `extractYtData()` | 中 |
| POT Token | Performance API + 模拟点击 | `getPOToken()` | 高 |
| Timedtext API | fetch + json3 格式解析 | `fetchTimedText()` | 低 |
| DOM 解析 | MutationObserver + querySelector | `extractFromDOM()` | 中 |
| Internal API | POST youtubei/v1/get_transcript | `fetchViaInternalAPI()` | 中 |
| 数据规范化 | 多格式统一处理 | `normalizeTranscript()` | 中 |

### 9.2 扩展开发要点

| 要点 | 说明 |
|------|------|
| Manifest V3 | 使用 Service Worker 替代 Background Page |
| 权限声明 | activeTab, storage, scripting, sidePanel |
| 消息通信 | Content ↔ Background: chrome.runtime.sendMessage |
| 动态注入 | chrome.scripting.executeScript |
| 存储策略 | sync (设置) + local (大数据) |

### 9.3 YouTube 特殊处理

| 场景 | 处理方式 |
|------|---------|
| SPA 导航 | 监听 yt-navigate 事件 |
| 按钮被移除 | MutationObserver + 定时检查 |
| Shorts 视频 | URL 转换为普通视频格式 |
| 自动生成字幕 | 优先选择人工字幕 (kind !== "asr") |
| POT 验证 | 模拟点击字幕按钮截获 token |

---

## 十、复刻检查清单

### 10.1 核心文件

- [ ] `manifest.json` - Manifest V3 配置
- [ ] `background.js` - Service Worker
- [ ] `content.js` - 内容脚本（字幕提取核心）
- [ ] `shared/formatting.js` - 字幕格式化模块

### 10.2 字幕提取功能

- [ ] `ytInitialPlayerResponse` 数据提取
- [ ] `ytInitialData` 数据提取
- [ ] POT Token 获取机制
- [ ] Timedtext API 调用
- [ ] DOM Transcript 面板解析
- [ ] YouTubei Internal API 调用
- [ ] 多来源数据规范化
- [ ] Shorts 视频支持

### 10.3 UI 功能

- [ ] Popup 弹窗界面
- [ ] 页面内复制按钮注入
- [ ] 侧边栏 AI 对话界面
- [ ] 设置管理界面
- [ ] 历史记录界面

### 10.4 导出功能

- [ ] 纯文本导出 (.txt)
- [ ] PDF 导出 (jsPDF)
- [ ] Markdown 导出 (.md)
- [ ] 自定义格式化选项

### 10.5 数据存储

- [ ] chrome.storage.sync 设置存储
- [ ] chrome.storage.local 历史存储
- [ ] AI 使用量追踪

### 10.6 消息通信

- [ ] Popup ↔ Background 通信
- [ ] Content ↔ Background 通信
- [ ] SidePanel ↔ Background 通信
- [ ] 视频切换事件通知

---

## 十一、API 端点参考

### 11.1 YouTube Timedtext API

```
GET https://www.youtube.com/api/timedtext

参数:
  - v: 视频ID (必需)
  - lang: 语言代码 (如 en, zh-Hans)
  - fmt: 格式 (json3 返回结构化JSON)
  - pot: Proof of Origin Token (必需，2024年后)
  - c: 客户端标识 (WEB)
  - xorb: 未知参数 (可选)
  - xobt: 未知参数 (可选)

示例:
https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&lang=en&fmt=json3&pot=xxx&c=WEB
```

### 11.2 YouTube Internal API

```
POST https://www.youtube.com/youtubei/v1/get_transcript

Headers:
  Content-Type: application/json

Body:
{
  "context": {
    "client": {
      "hl": "en",
      "visitorData": "xxx",
      "clientName": "WEB",
      "clientVersion": "2.20240101.00.00"
    },
    "request": {
      "useSsl": true
    }
  },
  "params": "<base64编码的参数，从ytInitialData获取>"
}
```

### 11.3 AI 后端 API (参考)

```
POST https://cyt.hamzaw.com/api/chat

Headers:
  Content-Type: application/json

Body:
{
  "transcript": "字幕文本",
  "prompt": "用户问题",
  "history": [
    { "role": "user", "content": "之前的问题" },
    { "role": "assistant", "content": "之前的回答" }
  ]
}

Response:
{
  "response": "AI回复内容"
}
```

---

*文档生成时间: 2026-01-31*
*基于参考项目版本: 1.5.0*
*适用于项目复刻和技术学习*

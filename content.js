/**
 * YouTube 字幕提取器 - 内容脚本
 *
 * 实现三层降级策略：
 * 1. Timedtext API + POT Token（最快、成功率~90%）
 * 2. DOM Transcript 面板解析（备用方案）
 * 3. YouTubei Internal API（最后手段）
 */

(function() {
  "use strict";

  // 防止重复注入
  if (window.__ytSubtitleExtractorLoaded) {
    return;
  }
  window.__ytSubtitleExtractorLoaded = true;

  // ==================== 常量定义 ====================

  // 字幕按钮选择器
  const CC_BUTTON_SELECTORS = [
    "#movie_player .ytp-subtitles-button",
    "button.ytp-subtitles-button.ytp-button"
  ];

  // 转录按钮选择器
  const TRANSCRIPT_BUTTON_SELECTORS = [
    'button[aria-label="Show transcript"]',
    'button[aria-label="显示转录稿"]',
    'button[aria-label="显示文字記錄"]',
    '#primary-button > ytd-button-renderer button',
    'ytd-video-description-transcript-section-renderer button'
  ];

  // 字幕片段容器选择器
  const TRANSCRIPT_SEGMENTS_SELECTOR =
    "#segments-container ytd-transcript-segment-renderer";

  // POT Token 缓存
  const potTokenCache = new Map();

  // ==================== 工具函数 ====================

  /**
   * 延时函数
   */
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 从 URL 提取视频 ID
   */
  function getVideoId(url = window.location.href) {
    const urlObj = new URL(url);

    // 普通视频: youtube.com/watch?v=xxx
    if (urlObj.searchParams.has("v")) {
      return urlObj.searchParams.get("v");
    }

    // Shorts: youtube.com/shorts/xxx
    const shortsMatch = url.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
    if (shortsMatch) {
      return shortsMatch[1];
    }

    return null;
  }

  /**
   * 判断是否为 Shorts 视频
   */
  function isShorts(url = window.location.href) {
    return /youtube\.com\/shorts\//.test(url);
  }

  /**
   * 从页面 HTML 提取 YouTube 数据对象
   */
  function extractYtData(html, key) {
    const patterns = [
      new RegExp(`window\\["${key}"\\]\\s*=\\s*`),
      new RegExp(`var ${key}\\s*=\\s*`),
      new RegExp(`${key}\\s*=\\s*`)
    ];

    for (const regex of patterns) {
      const startMatch = html.match(regex);
      if (!startMatch) continue;

      const startIndex = startMatch.index + startMatch[0].length;
      let braceCount = 0;
      let endIndex = startIndex;
      let inString = false;
      let escapeNext = false;

      for (let i = startIndex; i < html.length; i++) {
        const char = html[i];

        if (escapeNext) {
          escapeNext = false;
          continue;
        }

        if (char === "\\") {
          escapeNext = true;
          continue;
        }

        if (char === '"' && !escapeNext) {
          inString = !inString;
          continue;
        }

        if (!inString) {
          if (char === "{") braceCount++;
          if (char === "}") {
            braceCount--;
            if (braceCount === 0) {
              endIndex = i + 1;
              break;
            }
          }
        }
      }

      if (endIndex > startIndex) {
        try {
          const jsonStr = html.substring(startIndex, endIndex);
          return JSON.parse(jsonStr);
        } catch (e) {
          continue;
        }
      }
    }

    throw new Error(`页面中未找到 ${key} 数据`);
  }

  /**
   * 从页面脚本中提取字幕 URL
   */
  function extractCaptionUrlFromPageScripts() {
    try {
      const scripts = document.querySelectorAll("script");

      for (const script of scripts) {
        const content = script.textContent || "";

        if (content.includes('"baseUrl"') && content.includes("timedtext")) {
          const match = content.match(
            /"baseUrl"\s*:\s*"(https:\/\/www\.youtube\.com\/api\/timedtext[^"]+)"/
          );
          if (match) {
            return match[1].replace(/\\u0026/g, "&");
          }
        }
      }
    } catch (error) {
      console.warn("从页面脚本提取字幕URL失败:", error);
    }

    return null;
  }

  /**
   * 获取字幕轨道 URL
   */
  function getCaptionTrackUrl(ytData, preferredLang = null) {
    const tracks = ytData?.captions
      ?.playerCaptionsTracklistRenderer
      ?.captionTracks;

    if (!tracks || tracks.length === 0) {
      return null;
    }

    let selectedTrack = null;

    if (preferredLang) {
      selectedTrack = tracks.find(
        t => t.languageCode === preferredLang && !t.kind
      );
      if (!selectedTrack) {
        selectedTrack = tracks.find(t => t.languageCode === preferredLang);
      }
    }

    if (!selectedTrack) {
      selectedTrack = tracks.find(t => !t.kind);
    }

    if (!selectedTrack) {
      selectedTrack = tracks[0];
    }

    return selectedTrack?.baseUrl || null;
  }

  // ==================== 方法1: Timedtext API ====================

  /**
   * 查找字幕按钮
   */
  function findCCButton() {
    for (const selector of CC_BUTTON_SELECTORS) {
      const button = document.querySelector(selector);
      if (button) return button;
    }
    return null;
  }

  /**
   * 获取 POT Token
   */
  async function getPOToken(videoId = "") {
    const cacheKey = `pot-${videoId}`;

    if (potTokenCache.has(cacheKey)) {
      return potTokenCache.get(cacheKey);
    }

    try {
      const ccButton = findCCButton();
      if (!ccButton) {
        console.warn("未找到字幕按钮");
        return "";
      }

      performance.clearResourceTimings();

      const wasPressed = ccButton.getAttribute("aria-pressed") === "true";

      // 触发字幕请求
      ccButton.click();

      // 等待请求发出
      await sleep(300);

      // 恢复原状态
      if (!wasPressed) {
        ccButton.click();
      }

      // 检查 timedtext 请求
      const entries = performance.getEntriesByType("resource");
      const timedtextEntries = entries.filter(
        entry => entry.name.includes("/api/timedtext?")
      );

      if (timedtextEntries.length > 0) {
        const latestEntry = timedtextEntries[timedtextEntries.length - 1];
        const url = new URL(latestEntry.name);
        const pot = url.searchParams.get("pot");

        if (pot) {
          potTokenCache.set(cacheKey, pot);
          return pot;
        }
      }
    } catch (error) {
      console.error("获取 POT token 失败:", error);
    }

    return "";
  }

  /**
   * 使用 Timedtext API 获取字幕
   */
  async function fetchTimedtextAPI(baseUrl, videoId) {
    const pot = await getPOToken(videoId);

    const separator = baseUrl.includes("?") ? "&" : "?";
    const url = pot
      ? `${baseUrl}${separator}fmt=json3&pot=${pot}`
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

  // ==================== 方法2: DOM 解析 ====================

  /**
   * 等待元素出现
   */
  function waitForElement(selector, timeout = 3000) {
    return new Promise((resolve) => {
      const existing = document.querySelector(selector);
      if (existing) {
        return resolve(true);
      }

      const observer = new MutationObserver((mutations, obs) => {
        const element = document.querySelector(selector);
        if (element) {
          obs.disconnect();
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
   * 解析时间戳字符串
   */
  function parseTimestamp(timeStr) {
    if (!timeStr) return 0;

    const parts = timeStr.trim().split(":").map(Number);

    if (parts.length === 2) {
      const [minutes, seconds] = parts;
      return (minutes * 60 + seconds) * 1000;
    }

    if (parts.length === 3) {
      const [hours, minutes, seconds] = parts;
      return (hours * 3600 + minutes * 60 + seconds) * 1000;
    }

    return 0;
  }

  /**
   * 从 DOM 提取字幕
   */
  async function extractFromDOM() {
    let transcriptButton = null;

    for (const selector of TRANSCRIPT_BUTTON_SELECTORS) {
      transcriptButton = document.querySelector(selector);
      if (transcriptButton) {
        console.log("找到转录按钮:", selector);
        break;
      }
    }

    if (!transcriptButton) {
      // 尝试展开描述区域
      const expandButton = document.querySelector("#expand");
      if (expandButton) {
        expandButton.click();
        await sleep(500);

        for (const selector of TRANSCRIPT_BUTTON_SELECTORS) {
          transcriptButton = document.querySelector(selector);
          if (transcriptButton) break;
        }
      }
    }

    if (!transcriptButton) {
      console.warn("未找到转录按钮");
      return null;
    }

    transcriptButton.click();

    const loaded = await waitForElement(TRANSCRIPT_SEGMENTS_SELECTOR, 5000);

    if (!loaded) {
      console.warn("转录面板加载超时");
      return null;
    }

    await sleep(500);

    const segments = document.querySelectorAll(TRANSCRIPT_SEGMENTS_SELECTOR);

    if (!segments.length) {
      console.warn("未找到字幕片段");
      return null;
    }

    console.log(`找到 ${segments.length} 个字幕片段`);

    const transcript = [];

    segments.forEach((segment) => {
      const timestampEl = segment.querySelector(".segment-timestamp");
      const timestamp = timestampEl?.textContent?.trim() || "";

      const textEl = segment.querySelector("yt-formatted-string.segment-text");
      const text = textEl?.textContent?.trim() || "";

      if (!text) return;

      transcript.push({
        tStartMs: parseTimestamp(timestamp),
        segs: [{ utf8: text }]
      });
    });

    // 关闭转录面板
    const closeButton = document.querySelector(
      "#panels ytd-engagement-panel-section-list-renderer button[aria-label='Close']"
    );
    if (closeButton) {
      closeButton.click();
    }

    if (transcript.length === 0) {
      return null;
    }

    console.log(`成功提取 ${transcript.length} 条字幕`);
    return transcript;
  }

  // ==================== 方法3: Internal API ====================

  /**
   * 生成客户端版本号
   */
  function generateClientVersion() {
    const today = new Date();
    const randomOffset = Math.floor(Math.random() * 30);
    const date = new Date(today);
    date.setDate(date.getDate() - randomOffset);
    const formatted = date.toISOString().split("T")[0].replace(/-/g, "");
    return `2.${formatted}.00.00`;
  }

  /**
   * 提取转录参数
   */
  function extractTranscriptParams(ytData) {
    const panels = ytData?.engagementPanels || [];

    for (const panel of panels) {
      const params = panel
        ?.engagementPanelSectionListRenderer
        ?.content
        ?.continuationItemRenderer
        ?.continuationEndpoint
        ?.getTranscriptEndpoint
        ?.params;

      if (params) return params;
    }

    return null;
  }

  /**
   * 通过 Internal API 获取字幕
   */
  async function fetchViaInternalAPI(ytData) {
    const params = extractTranscriptParams(ytData);

    if (!params) {
      throw new Error("无法提取转录参数");
    }

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

    return segments;
  }

  // ==================== 数据规范化 ====================

  /**
   * 毫秒转时间戳
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
   * 毫秒转 SRT 时间格式
   */
  function formatSRTTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const milliseconds = ms % 1000;

    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")},${milliseconds.toString().padStart(3, "0")}`;
  }

  /**
   * 规范化字幕数据
   */
  function normalizeTranscript(data) {
    if (!data || data.length === 0) {
      return [];
    }

    const firstItem = data[0];

    // Timedtext API 格式
    if (firstItem.tStartMs !== undefined && firstItem.segs) {
      return data
        .filter(event => event.segs && event.segs.length > 0)
        .map(event => ({
          startMs: event.tStartMs || 0,
          durationMs: event.dDurationMs || 3000,
          text: event.segs
            .map(seg => seg.utf8 || "")
            .join("")
            .replace(/\n/g, " ")
            .trim()
        }))
        .filter(item => item.text.length > 0);
    }

    // Internal API 格式
    if (firstItem.transcriptSegmentRenderer) {
      return data
        .filter(segment => segment.transcriptSegmentRenderer)
        .map(segment => {
          const renderer = segment.transcriptSegmentRenderer;
          return {
            startMs: parseInt(renderer.startMs, 10) || 0,
            durationMs: (parseInt(renderer.endMs, 10) || 0) - (parseInt(renderer.startMs, 10) || 0) || 3000,
            text: (renderer.snippet?.runs || [])
              .map(run => run.text || "")
              .join("")
              .trim()
          };
        })
        .filter(item => item.text.length > 0);
    }

    // DOM 解析格式
    if (firstItem.tStartMs !== undefined) {
      return data.map(item => ({
        startMs: item.tStartMs || 0,
        durationMs: 3000,
        text: (item.segs || [])
          .map(seg => seg.utf8 || "")
          .join("")
          .trim()
      })).filter(item => item.text.length > 0);
    }

    return [];
  }

  /**
   * 生成 SRT 格式字幕
   */
  function generateSRT(transcript) {
    return transcript.map((item, index) => {
      const startTime = formatSRTTime(item.startMs);
      const endTime = formatSRTTime(item.startMs + item.durationMs);
      return `${index + 1}\n${startTime} --> ${endTime}\n${item.text}\n`;
    }).join("\n");
  }

  /**
   * 生成带时间戳的文本格式（用于剪切板）
   * 如果时间戳无效，降级为纯文本
   */
  function generateTextWithTimestamp(transcript) {
    try {
      // 检查是否有有效的时间戳数据
      const hasValidTimestamp = transcript.some(item =>
        item.startMs !== undefined && item.startMs !== null && !isNaN(item.startMs)
      );

      if (hasValidTimestamp) {
        return transcript.map(item => {
          const timestamp = formatMilliseconds(item.startMs || 0);
          return `[${timestamp}] ${item.text}`;
        }).join("\n");
      }
    } catch (error) {
      console.warn("生成带时间戳文本失败，降级为纯文本:", error);
    }

    // 降级：返回纯文本
    return transcript.map(item => item.text).join("\n");
  }

  /**
   * 下载文件 - 优先使用 Chrome Downloads API
   */
  async function downloadFile(content, filename, mimeType = "text/plain") {
    const sanitizedFilename = filename.replace(/[<>:"/\\|?*]/g, "_");

    // 方法1: 通过 background script 使用 Chrome Downloads API（最可靠）
    try {
      await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          {
            action: "downloadSRT",
            content: content,
            filename: sanitizedFilename
          },
          (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else if (response && response.success) {
              resolve(response);
            } else {
              reject(new Error(response?.error || "下载失败"));
            }
          }
        );
      });
      console.log("通过 Chrome Downloads API 下载成功");
      return true;
    } catch (error) {
      console.warn("Chrome Downloads API 失败，尝试备用方法:", error.message);
    }

    // 方法2: 使用 <a> 标签下载（备用方案）
    try {
      const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = sanitizedFilename;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();

      // 清理
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);

      console.log("通过 <a> 标签下载");
      return true;
    } catch (error) {
      console.error("所有下载方法都失败:", error);
      throw error;
    }
  }

  // ==================== 主提取流程 ====================

  /**
   * 获取视频标题
   */
  function getVideoTitle() {
    // 尝试多种选择器以适配 YouTube 不同版本的页面结构
    const selectors = [
      // 新版 YouTube 布局
      "h1.ytd-watch-metadata yt-formatted-string",
      "ytd-watch-metadata h1 yt-formatted-string",
      "#above-the-fold h1 yt-formatted-string",
      // 旧版布局
      "h1.ytd-video-primary-info-renderer yt-formatted-string",
      "#title h1 yt-formatted-string",
      "h1.title",
      // Shorts
      "ytd-reel-video-renderer h2 span",
      "#shorts-container h2"
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el?.textContent?.trim()) {
        return el.textContent.trim();
      }
    }

    // 备用：从 document.title 提取
    const docTitle = document.title;
    if (docTitle && docTitle !== "YouTube") {
      // 移除 " - YouTube" 后缀
      return docTitle.replace(/\s*-\s*YouTube\s*$/i, "").trim() || "YouTube_Video";
    }

    return "YouTube_Video";
  }

  /**
   * 带降级的字幕获取
   */
  async function fetchTranscriptWithFallback(videoId) {
    const errors = [];

    // 方法1: Timedtext API
    console.log("尝试方法1: Timedtext API");
    try {
      let baseUrl = extractCaptionUrlFromPageScripts();

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
          console.log("方法1成功:", events.length, "条字幕");
          return events;
        }
      }
    } catch (error) {
      console.warn("方法1失败:", error.message);
      errors.push(`Timedtext API: ${error.message}`);
    }

    // 方法2: DOM 解析
    console.log("尝试方法2: DOM 解析");
    try {
      const domTranscript = await extractFromDOM();
      if (domTranscript && domTranscript.length > 0) {
        console.log("方法2成功:", domTranscript.length, "条字幕");
        return domTranscript;
      }
    } catch (error) {
      console.warn("方法2失败:", error.message);
      errors.push(`DOM 解析: ${error.message}`);
    }

    // 方法3: Internal API
    console.log("尝试方法3: Internal API");
    try {
      const html = await fetch(window.location.href).then(r => r.text());
      const ytInitialData = extractYtData(html, "ytInitialData");

      if (ytInitialData?.engagementPanels) {
        const segments = await fetchViaInternalAPI(ytInitialData);
        if (segments && segments.length > 0) {
          console.log("方法3成功:", segments.length, "条字幕");
          return segments;
        }
      }
    } catch (error) {
      console.warn("方法3失败:", error.message);
      errors.push(`Internal API: ${error.message}`);
    }

    throw new Error("所有方法都失败:\n" + errors.join("\n"));
  }

  /**
   * 主提取函数
   */
  async function extractSubtitle() {
    console.log("开始提取字幕...");

    const videoId = getVideoId();
    if (!videoId) {
      throw new Error("无法获取视频 ID，请确保在 YouTube 视频页面");
    }

    console.log("视频 ID:", videoId);

    // Shorts 视频需要特殊处理
    if (isShorts()) {
      console.log("检测到 Shorts 视频，尝试获取字幕...");
    }

    // 获取原始字幕数据
    const rawTranscript = await fetchTranscriptWithFallback(videoId);

    // 规范化数据
    const transcript = normalizeTranscript(rawTranscript);

    if (transcript.length === 0) {
      throw new Error("该视频没有可用字幕");
    }

    // 获取视频标题
    const title = getVideoTitle();

    // 生成 SRT 内容
    const srtContent = generateSRT(transcript);

    // 生成带时间戳的文本（用于剪切板）
    const textWithTimestamp = generateTextWithTimestamp(transcript);

    return {
      title,
      transcript,
      srtContent,
      textWithTimestamp,
      count: transcript.length
    };
  }

  /**
   * 复制到剪切板
   */
  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      // 降级方案：使用 execCommand
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const success = document.execCommand("copy");
      document.body.removeChild(textarea);
      return success;
    }
  }

  /**
   * 显示提示消息
   */
  function showToast(message, type = "success") {
    const existingToast = document.querySelector("#yt-subtitle-toast");
    if (existingToast) {
      existingToast.remove();
    }

    const toast = document.createElement("div");
    toast.id = "yt-subtitle-toast";
    toast.innerHTML = message;
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 16px 24px;
      background: ${type === "success" ? "#4CAF50" : "#f44336"};
      color: white;
      border-radius: 8px;
      font-size: 14px;
      font-family: Arial, sans-serif;
      z-index: 999999;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      animation: slideIn 0.3s ease;
    `;

    const style = document.createElement("style");
    style.textContent = `
      @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
    `;
    document.head.appendChild(style);

    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = "slideIn 0.3s ease reverse";
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  /**
   * 执行提取并处理结果
   * 采用降级策略保证健壮性
   */
  async function performExtraction(source = "unknown") {
    try {
      showToast("正在提取字幕...", "success");

      const result = await extractSubtitle();

      // 复制到剪切板（带时间戳，失败则降级为纯文本）
      let clipboardText = result.textWithTimestamp;
      let hasTimestamp = clipboardText.includes("[");

      try {
        await copyToClipboard(clipboardText);
      } catch (clipError) {
        console.warn("复制失败，尝试降级:", clipError);
        // 降级为纯文本
        clipboardText = result.transcript.map(item => item.text).join("\n");
        hasTimestamp = false;
        await copyToClipboard(clipboardText);
      }

      // 下载 SRT 文件（失败则降级为 TXT）
      let downloadSuccess = false;
      let downloadFormat = "SRT";

      try {
        const srtFilename = `${result.title}.srt`;
        await downloadFile(result.srtContent, srtFilename, "text/srt");
        downloadSuccess = true;
      } catch (srtError) {
        console.warn("SRT 下载失败，尝试 TXT:", srtError);
        try {
          // 降级为纯文本文件
          const txtFilename = `${result.title}.txt`;
          const txtContent = result.transcript.map(item => item.text).join("\n");
          await downloadFile(txtContent, txtFilename, "text/plain");
          downloadSuccess = true;
          downloadFormat = "TXT";
        } catch (txtError) {
          console.error("下载完全失败:", txtError);
        }
      }

      // 构建提示信息
      const messages = [`✓ 成功提取 ${result.count} 条字幕`];
      messages.push(hasTimestamp ? "✓ 已复制到剪切板（含时间戳）" : "✓ 已复制到剪切板");
      if (downloadSuccess) {
        messages.push(`✓ ${downloadFormat} 文件已下载`);
      }

      showToast(messages.join("<br>"), "success");

      return result;

    } catch (error) {
      console.error("字幕提取失败:", error);
      showToast(`✗ 提取失败: ${error.message}`, "error");
      throw error;
    }
  }

  // ==================== 消息监听 ====================

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "extractSubtitle") {
      performExtraction(request.source)
        .then(result => sendResponse({ success: true, result }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true; // 保持消息通道开放
    }

    if (request.action === "checkPage") {
      const videoId = getVideoId();
      sendResponse({
        isYouTube: true,
        hasVideo: !!videoId,
        videoId: videoId,
        isShorts: isShorts()
      });
      return false;
    }
  });

  // ==================== 初始化 ====================

  console.log("YouTube 字幕提取器已加载");

  // 导出供 popup 直接调用
  window.__ytSubtitleExtractor = {
    extractSubtitle,
    performExtraction,
    getVideoId,
    isShorts
  };

})();

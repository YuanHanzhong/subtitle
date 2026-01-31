/**
 * YouTube 字幕提取器 - 后台脚本
 * 功能：
 * 1. 创建右键菜单"一键提取字幕"
 * 2. 处理来自 content script 的消息
 * 3. 代理 fetch 请求（用于 Shorts 视频）
 */

// ==================== 右键菜单 ====================

// 插件安装时创建右键菜单
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "extractSubtitle",
    title: "一键提取字幕",
    contexts: ["page", "video"],
    documentUrlPatterns: [
      "https://www.youtube.com/*",
      "https://youtube.com/*"
    ]
  });
  console.log("YouTube 字幕提取器已安装，右键菜单已创建");
});

// 右键菜单点击事件
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "extractSubtitle") {
    triggerExtraction(tab, "contextMenu");
  }
});

// 插件图标点击事件（直接提取，无需 popup）
chrome.action.onClicked.addListener((tab) => {
  triggerExtraction(tab, "iconClick");
});

/**
 * 触发字幕提取
 * @param {chrome.tabs.Tab} tab - 当前标签页
 * @param {string} source - 触发来源
 */
function triggerExtraction(tab, source) {
  // 检查是否为 YouTube 页面
  if (!tab.url || (!tab.url.includes("youtube.com/watch") && !tab.url.includes("youtube.com/shorts"))) {
    console.warn("不是 YouTube 视频页面");
    // 显示提示信息
    showPageToast(tab.id, "请在 YouTube 视频页面使用此插件", "error");
    return;
  }

  // 向 content script 发送提取命令
  chrome.tabs.sendMessage(tab.id, {
    action: "extractSubtitle",
    source: source
  }).catch(error => {
    console.error("发送消息失败:", error);
    // 可能 content script 未加载，尝试注入
    injectContentScript(tab.id, source);
  });
}

/**
 * 在页面上显示 Toast 提示
 * @param {number} tabId - 标签页 ID
 * @param {string} message - 提示信息
 * @param {string} type - 类型 (success/error)
 */
async function showPageToast(tabId, message, type = "error") {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: (msg, msgType) => {
        // 移除已有的 toast
        const existingToast = document.querySelector("#yt-subtitle-toast");
        if (existingToast) {
          existingToast.remove();
        }

        const isError = msgType === "error";
        const bgColor = isError ? "#d32f2f" : "#4CAF50";
        const icon = isError ? "✗" : "✓";
        const title = isError ? "提示" : "成功";

        const toast = document.createElement("div");
        toast.id = "yt-subtitle-toast";
        toast.innerHTML = `
          <div style="display: flex; align-items: flex-start; gap: 12px;">
            <span style="font-size: 20px; line-height: 1;">${icon}</span>
            <div>
              <div style="font-weight: bold; margin-bottom: 4px;">${title}</div>
              <div style="opacity: 0.95;">${msg}</div>
            </div>
          </div>
        `;
        toast.style.cssText = `
          position: fixed;
          top: 20px;
          right: 20px;
          padding: 16px 20px;
          background: ${bgColor};
          color: white;
          border-radius: 8px;
          font-size: 14px;
          font-family: Arial, sans-serif;
          z-index: 999999;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          animation: ytSubtitleSlideIn 0.3s ease;
          max-width: 350px;
          line-height: 1.4;
        `;

        // 添加动画样式
        if (!document.querySelector("#yt-subtitle-toast-style")) {
          const style = document.createElement("style");
          style.id = "yt-subtitle-toast-style";
          style.textContent = `
            @keyframes ytSubtitleSlideIn {
              from { transform: translateX(100%); opacity: 0; }
              to { transform: translateX(0); opacity: 1; }
            }
          `;
          document.head.appendChild(style);
        }

        document.body.appendChild(toast);

        setTimeout(() => {
          toast.style.animation = "ytSubtitleSlideIn 0.3s ease reverse";
          setTimeout(() => toast.remove(), 300);
        }, 4000);
      },
      args: [message, type]
    });
  } catch (error) {
    console.error("显示提示失败:", error);
  }
}

// ==================== 消息处理 ====================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 代理 fetch 请求（用于绕过 CORS）
  if (request.action === "fetchTransformedUrl") {
    fetchWithCORS(request.url)
      .then(html => sendResponse({ success: true, html }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // 保持消息通道开放
  }

  // 下载 SRT 文件
  if (request.action === "downloadSRT") {
    downloadSRTFile(request.content, request.filename)
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // 显示通知
  if (request.action === "showNotification") {
    showNotification(request.title, request.message);
    sendResponse({ success: true });
    return false;
  }
});

// ==================== 辅助函数 ====================

/**
 * 带 CORS 绕过的 fetch
 * @param {string} url - 目标 URL
 * @returns {Promise<string>} HTML 内容
 */
async function fetchWithCORS(url) {
  const response = await fetch(url, {
    credentials: "include",
    headers: {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5"
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return await response.text();
}

/**
 * 下载 SRT 文件
 * @param {string} content - SRT 内容
 * @param {string} filename - 文件名
 */
async function downloadSRTFile(content, filename) {
  // 创建 Blob URL
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  try {
    // 使用 Chrome 下载 API
    await chrome.downloads.download({
      url: url,
      filename: sanitizeFilename(filename),
      saveAs: false // 直接下载，不弹出保存对话框
    });
  } finally {
    // 清理 Blob URL
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/**
 * 清理文件名中的非法字符
 * @param {string} filename - 原始文件名
 * @returns {string} 清理后的文件名
 */
function sanitizeFilename(filename) {
  // 移除 Windows/Mac/Linux 文件名中的非法字符
  return filename
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200); // 限制长度
}

/**
 * 显示浏览器通知
 * @param {string} title - 通知标题
 * @param {string} message - 通知内容
 */
function showNotification(title, message) {
  // 使用 chrome.notifications API（需要额外权限，这里用 console 替代）
  console.log(`[通知] ${title}: ${message}`);
}

/**
 * 注入 content script（用于页面刷新后重新注入）
 * @param {number} tabId - 标签页 ID
 * @param {string} source - 触发来源
 */
async function injectContentScript(tabId, source = "unknown") {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ["content.js"]
    });
    console.log("Content script 已注入");

    // 等待注入完成后重新发送消息
    setTimeout(() => {
      chrome.tabs.sendMessage(tabId, {
        action: "extractSubtitle",
        source: source
      });
    }, 100);
  } catch (error) {
    console.error("注入 content script 失败:", error);
  }
}

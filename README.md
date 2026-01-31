# YouTube 字幕提取器

一键提取 YouTube 视频字幕的 Chrome 浏览器插件。

## 功能特点

- **稳定提取**：采用三层降级策略，确保高成功率
  - Timedtext API + POT Token（主要方法，成功率 ~90%）
  - DOM Transcript 面板解析（备用方案）
  - YouTubei Internal API（最后手段）
- **两种触发方式**：
  - 点击插件图标
  - 右键菜单"一键提取字幕"
- **自动处理**：
  - 自动复制字幕文本到剪切板
  - 自动下载 SRT 格式字幕文件

## 安装步骤

### 方法一：开发者模式加载

1. 打开 Chrome 浏览器，进入 `chrome://extensions/`
2. 开启右上角的"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择本项目文件夹

### 方法二：打包安装

1. 在 `chrome://extensions/` 页面点击"打包扩展程序"
2. 选择本项目文件夹
3. 生成 `.crx` 文件后拖入 Chrome 安装

## 使用方法

### 方式一：点击插件图标

1. 打开任意 YouTube 视频页面
2. 点击浏览器工具栏中的插件图标
3. 在弹出窗口中点击"提取字幕"按钮
4. 等待提取完成，字幕将自动：
   - 复制到剪切板
   - 下载为 SRT 文件

### 方式二：右键菜单

1. 在 YouTube 视频页面任意位置右键
2. 选择"一键提取字幕"
3. 等待提取完成

## 文件结构

```
chromeSubtitle/
├── manifest.json      # 插件配置文件
├── background.js      # 后台脚本（右键菜单、下载处理）
├── content.js         # 内容脚本（字幕提取核心逻辑）
├── popup.html         # 弹出窗口界面
├── popup.js           # 弹出窗口逻辑
├── icons/             # 插件图标
│   ├── icon16.png
│   ├── icon48.png
│   ├── icon128.png
│   └── generate-icons.html  # 图标生成工具
└── scripts/
    └── generate-icons.js    # 图标生成脚本
```

## 自定义图标

默认提供了占位图标。如需更美观的图标：

1. 使用浏览器打开 `icons/generate-icons.html`
2. 点击"下载所有图标"按钮
3. 将下载的 PNG 文件保存到 `icons` 文件夹

## 支持的视频类型

- YouTube 普通视频 (`youtube.com/watch?v=...`)
- YouTube Shorts (`youtube.com/shorts/...`)

## 技术原理

本插件基于对 YouTube 字幕系统的逆向分析实现，详见 [SUBTITLE_EXTRACTION_TECH.md](./SUBTITLE_EXTRACTION_TECH.md)。

## 注意事项

1. 部分视频可能没有字幕（创作者未提供、自动生成失败等）
2. 私密视频或年龄限制视频可能无法提取
3. YouTube 界面更新可能导致部分方法失效，但降级策略会保证整体可用性

## 许可证

MIT License

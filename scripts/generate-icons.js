/**
 * 图标生成脚本
 * 使用方法: node scripts/generate-icons.js
 *
 * 如果没有 canvas 库，请先安装：npm install canvas
 */

const fs = require('fs');
const path = require('path');

// 检查是否有 canvas 库
let createCanvas;
try {
  createCanvas = require('canvas').createCanvas;
} catch (e) {
  console.log('需要安装 canvas 库。请运行: npm install canvas');
  console.log('或者使用浏览器打开 icons/generate-icons.html 来生成图标');

  // 创建简单的占位 PNG（1x1 像素的紫色图片）
  // PNG 文件头 + IHDR + IDAT + IEND
  createPlaceholderIcons();
  process.exit(0);
}

const sizes = [16, 48, 128];
const iconsDir = path.join(__dirname, '..', 'icons');

// 确保 icons 目录存在
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

function drawIcon(ctx, size) {
  // 背景渐变
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, '#667eea');
  gradient.addColorStop(1, '#764ba2');

  // 圆角矩形背景
  const radius = size * 0.15;
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.lineTo(size - radius, 0);
  ctx.quadraticCurveTo(size, 0, size, radius);
  ctx.lineTo(size, size - radius);
  ctx.quadraticCurveTo(size, size, size - radius, size);
  ctx.lineTo(radius, size);
  ctx.quadraticCurveTo(0, size, 0, size - radius);
  ctx.lineTo(0, radius);
  ctx.quadraticCurveTo(0, 0, radius, 0);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  // CC 文字
  ctx.fillStyle = 'white';
  ctx.font = `bold ${size * 0.35}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('CC', size / 2, size / 2);

  // 下划线
  const lineY = size * 0.72;
  const lineWidth = size * 0.5;
  const lineHeight = Math.max(1, size * 0.06);
  ctx.fillRect((size - lineWidth) / 2, lineY, lineWidth, lineHeight);
}

// 使用 canvas 库生成图标
sizes.forEach(size => {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  drawIcon(ctx, size);

  const buffer = canvas.toBuffer('image/png');
  const filePath = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(filePath, buffer);
  console.log(`生成: ${filePath}`);
});

console.log('图标生成完成！');

// 创建简单的占位图标（不依赖 canvas 库）
function createPlaceholderIcons() {
  console.log('正在创建占位图标...');

  // 简单的紫色 PNG（使用预定义的 base64 数据）
  // 这些是简单的纯色方块图标
  const icons = {
    16: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAP0lEQVQ4T2NkGBDASEYLGBgYGP7//88AkwGJMTIyMqJLgsRhcoxwFQg1+IwYaC+Q7gVyLUY2Y6BdMNKCEp9LAABQ3g0RLjxCswAAAABJRU5ErkJggg==', 'base64'),
    48: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAXklEQVRoQ+3OMQHAIBAFULgKGIYDBhCBClRABSrwM0zAwVzyl+SycCIiLiLidCJi0z3dj4hY7m7qnr6wQHLJcneT9+w/g+nXBBCoAAQqAIEKQKACEKgABCoAgQpUoAAzITCAZxFV+gAAAABJRU5ErkJggg==', 'base64'),
    128: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAAbklEQVR42u3BMQEAAADCIPuntsUuYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAICXAR8yAAG/TLokAAAAAElFTkSuQmCC', 'base64')
  };

  const iconsDir = path.join(__dirname, '..', 'icons');
  if (!fs.existsSync(iconsDir)) {
    fs.mkdirSync(iconsDir, { recursive: true });
  }

  Object.entries(icons).forEach(([size, buffer]) => {
    const filePath = path.join(iconsDir, `icon${size}.png`);
    fs.writeFileSync(filePath, buffer);
    console.log(`创建占位图标: ${filePath}`);
  });

  console.log('\n占位图标已创建。');
  console.log('如需更好看的图标，请使用浏览器打开 icons/generate-icons.html');
}

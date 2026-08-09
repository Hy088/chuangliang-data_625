// 即梦(Jimeng) 浏览器自动化 —— 吃 App 免费额度（每天 66 积分），真·零算力成本
// 用途：在 jimeng.jianying.com 自动填提示词→生成→下载 mp4，可选导入看板。
// 依赖：playwright-core（已装到受管 workspace），并复用本机已缓存的 Chromium。
//
// 用法：
//   1) 登录并保存 Cookie（首次）：  node jimeng-auto.mjs login
//       脚本会打开即梦网页，你手动扫码/登录一次，登录成功后自动把 Cookie 存到 jimeng-cookie.json。
//       Cookie 过期后重跑此步即可。
//   2) 生成视频：                    node jimeng-auto.mjs "你的提示词"
//       默认文生视频（即梦3.0 720P）。生成完成后视频下载到 ./jimeng-output/<时间戳>.mp4。
//
// 注意：即梦网页 DOM 可能随版本变化；若某步找不到元素，脚本会打印当前页面 HTML 片段便于你反馈修正。

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
// playwright-core 装在受管 workspace（非本目录 node_modules），用绝对路径 require 以保证任意 cwd 都可运行
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/EDY/.workbuddy/binaries/node/workspace/node_modules/playwright-core');

// 本机已缓存的 Chromium 可执行文件（由 ms-playwright 管理）
const CHROME_EXE = 'C:/Users/EDY/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe';
const COOKIE_FILE = path.join(process.cwd(), 'jimeng-cookie.json');
const OUT_DIR = path.join(process.cwd(), 'jimeng-output');
const JIMENG_URL = 'https://jimeng.jianying.com/';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function launch() {
  const browser = await chromium.launch({
    executablePath: CHROME_EXE,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // 注入已保存的 Cookie（若有）
  if (fs.existsSync(COOKIE_FILE)) {
    try {
      const cookies = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf-8'));
      if (Array.isArray(cookies) && cookies.length) await context.addCookies(cookies);
      console.log('[ok] 已注入 ' + cookies.length + ' 条 Cookie');
    } catch (e) { console.log('[warn] Cookie 读取失败：' + e.message); }
  }
  return { browser, context };
}

// 登录模式：打开网页等用户登录，登录后保存 Cookie
async function doLogin() {
  const { browser, context } = await launch();
  const page = await context.newPage();
  await page.goto(JIMENG_URL, { waitUntil: 'domcontentloaded' });
  console.log('[login] 请在打开的浏览器中完成即梦登录（扫码/手机号）。登录成功后回到这里按回车继续…');
  // 等待用户在终端按回车
  await new Promise(res => {
    if (process.stdin.isTTY) process.stdin.once('data', () => res());
    else setTimeout(res, 120000); // 非交互环境最多等 2 分钟
  });
  const cookies = await context.cookies();
  fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2));
  console.log('[ok] Cookie 已保存到 ' + COOKIE_FILE + '（共 ' + cookies.length + ' 条）');
  await browser.close();
}

// 生成模式：填提示词→生成→下载
async function doGenerate(prompt) {
  if (!fs.existsSync(COOKIE_FILE)) {
    console.log('[error] 未找到 jimeng-cookie.json，请先运行：node jimeng-auto.mjs login');
    process.exit(1);
  }
  const { browser, context } = await launch();
  const page = await context.newPage();
  await page.goto(JIMENG_URL, { waitUntil: 'domcontentloaded' });
  await sleep(2000);

  // 1) 定位提示词输入框（即梦可能用 textarea 或 contenteditable div）
  let box = null;
  const selectors = ['textarea', 'div[contenteditable="true"]', '[placeholder*="描述"]', '[placeholder*="输入"]'];
  for (const s of selectors) {
    try { box = await page.$(s); if (box) { console.log('[ok] 找到输入框：' + s); break; } } catch (e) {}
  }
  if (!box) {
    console.log('[error] 未找到提示词输入框。当前页面 HTML 片段：');
    console.log((await page.content()).slice(0, 1500));
    await browser.close(); process.exit(1);
  }
  // 清空并填入提示词
  const tag = await box.evaluate(el => el.tagName.toLowerCase());
  if (tag === 'textarea') await box.fill(prompt);
  else { await box.click(); await page.keyboard.press('Control+A'); await page.keyboard.press('Delete'); await box.type(prompt, { delay: 20 }); }

  // 2) 点击「生成」按钮（文本包含 生成/立即生成）
  const clicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button, [role="button"]'));
    const gen = btns.find(b => /生成|立即生成|开始/.test(b.textContent || ''));
    if (gen) { gen.click(); return true; }
    return false;
  });
  if (!clicked) {
    console.log('[error] 未找到生成按钮。页面 HTML 片段：');
    console.log((await page.content()).slice(0, 1500));
    await browser.close(); process.exit(1);
  }
  console.log('[ok] 已点击生成，等待即梦出片（免费额度，通常 1–5 分钟）…');

  // 3) 轮询等待 <video> 出现（最多 6 分钟）
  let videoUrl = null;
  const deadline = Date.now() + 6 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(8000);
    videoUrl = await page.evaluate(() => {
      const v = document.querySelector('video');
      if (v && (v.src || v.currentSrc)) return v.src || v.currentSrc;
      // 有时视频以 blob/源链接形式存在
      const src = document.querySelector('video source');
      return src ? (src.src) : null;
    });
    if (videoUrl) break;
    // 检查是否提示登录失效
    if (await page.$('text=登录') || await page.$('text=扫码')) {
      console.log('[warn] 检测到页面要求登录，Cookie 可能已失效，请重跑 login。');
      break;
    }
  }
  if (!videoUrl) {
    console.log('[error] 超时未拿到视频。页面 HTML 片段：');
    console.log((await page.content()).slice(0, 1500));
    await browser.close(); process.exit(1);
  }
  console.log('[ok] 拿到视频地址：' + videoUrl.slice(0, 80) + '…');

  // 4) 下载视频
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const fname = path.join(OUT_DIR, 'jimeng_' + Date.now() + '.mp4');
  try {
    const r = await fetch(videoUrl);
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(fname, buf);
    console.log('[ok] 视频已下载：' + fname + '（' + (buf.length / 1048576).toFixed(1) + ' MB）');
  } catch (e) {
    console.log('[warn] 直接下载失败（' + e.message + '），尝试用页面下载事件…');
    // 兜底：点击页面上的下载按钮触发浏览器下载
    const dl = page.waitForEvent('download', { timeout: 60000 }).catch(() => null);
    await page.evaluate(() => {
      const a = Array.from(document.querySelectorAll('a,button')).find(el => /下载/.test(el.textContent || ''));
      if (a) a.click();
    });
    const download = await dl;
    if (download) { await download.saveAs(fname); console.log('[ok] 视频已下载：' + fname); }
    else console.log('[error] 下载失败，请手动从网页保存。');
  }

  // 5) 保存刷新后的 Cookie（防止过期）
  try { fs.writeFileSync(COOKIE_FILE, JSON.stringify(await context.cookies(), null, 2)); } catch (e) {}

  // 6) 可选：导入看板（把文件放到看板可读取目录）—— 此处仅打印路径，由用户在看板「导入本地视频」按钮选择
  console.log('[done] 你可在看板「生成模式 → 导入本地视频」中选择：' + fname);
  await browser.close();
}

// ---------------- 入口 ----------------
const mode = process.argv[2];
const promptArg = process.argv.slice(3).join(' ').trim() || (process.argv[2] && !['login'].includes(process.argv[2]) ? process.argv.slice(2).join(' ') : '');

if (mode === 'login') {
  doLogin().catch(e => { console.error(e); process.exit(1); });
} else if (promptArg) {
  doGenerate(promptArg).catch(e => { console.error(e); process.exit(1); });
} else {
  console.log('用法：');
  console.log('  登录保存 Cookie： node jimeng-auto.mjs login');
  console.log('  生成视频：       node jimeng-auto.mjs "你的提示词"');
  process.exit(0);
}

// 验证日汇总下面板数据都更新
const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true,
    args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']
  });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PE: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push('CE: ' + m.text()); });

  await page.goto('http://127.0.0.1:9879/index.html?t=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000);

  // 切到日汇总
  await page.click('.pp-tabs .tab-btn[data-mode="day"]');
  await page.waitForTimeout(1500);
  // 选 8/21（数据完整日）
  await page.click('#periodInput');
  await page.waitForTimeout(500);
  await page.click('.ppd-week-btn[data-day="2026-08-21"]');
  await page.waitForTimeout(2500);

  // 提取关键面板数据
  const panels = await page.evaluate(() => {
    const get = (sel) => { const e=document.querySelector(sel); return e ? e.innerText.replace(/\s+/g,' ').slice(0, 150) : '缺'+sel; };
    const proj = (document.getElementById('proj')||{innerText:''}).innerText.replace(/\s+/g,' ');
    return {
      ovPeriod: (document.getElementById('ov-period-filter')||{}).textContent||'',
      projFull: proj,
      hasVideoImage: proj.includes('视频/图片'),
      hasCategoryDirection: proj.includes('品类方向'),
      hasTagFilter: proj.includes('标签筛选') || proj.includes('AIGC'),
      matSection: ((document.getElementById('mat')||{innerText:''}).innerText.replace(/\s+/g,' ')).slice(0, 500)
    };
  });
  console.log('=== 日汇总 8/21 面板状态 ===');
  console.log(JSON.stringify(panels, null, 2));
  console.log('\n=== 错误 ===');
  errs.forEach(e => console.log(' ', e));
  console.log('\n总错误数:', errs.length);
  await browser.close();
  process.exit(errs.length ? 1 : 0);
})();

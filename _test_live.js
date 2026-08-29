// 线上实测：切日汇总 → 选 8/21 → 检查素材排行/AIGC/标签是否更新
const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true,
    args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']
  });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [], failed = [];
  page.on('pageerror', e => errs.push('PE: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errs.push('CE: ' + m.text()); });
  page.on('requestfailed', r => failed.push('FAIL ' + r.url().split('?')[0]));

  await page.goto('https://hy088.github.io/chuangliang-data_625/index.html?t=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 90000 });
  console.log('--- 等首屏数据加载 ---');
  await page.waitForTimeout(15000);

  // 切日汇总
  await page.click('.pp-tabs .tab-btn[data-mode="day"]');
  await page.waitForTimeout(1500);
  await page.click('#periodInput');
  await page.waitForTimeout(800);
  const dayBtns = await page.$$eval('#ppdWeeksList .ppd-week-btn', els => els.map(e => e.dataset.day).filter(Boolean));
  console.log('日按钮数:', dayBtns.length, '最后:', dayBtns[dayBtns.length-1]);
  // 选 8/21
  await page.click('.ppd-week-btn[data-day="2026-08-21"]');
  console.log('--- 已选 8/21，等懒加载 ---');
  await page.waitForTimeout(6000);

  const st = await page.evaluate(() => {
    const proj = (document.getElementById('proj')||{innerText:''}).innerText.replace(/\s+/g,' ');
    const mat = (document.getElementById('mat')||{innerText:''}).innerText.replace(/\s+/g,' ');
    return {
      kpi: proj.slice(0, 130),
      matRank: mat.slice(0, 180),
      matHasRows: mat.includes('¥') && !mat.includes('无数据'),
      aigc: proj.includes('AIGC') ? (proj.match(/AIGC.{0,150}/g)||['(无)'])[0] : '(无AIGC文字)',
      tagCount: (proj.match(/共\s*\d+\s*个标签/g)||[])[0]||'(无标签数)',
      err: (() => { try { return 'mats=' + (DATA.materials.rows||[]).length; } catch(e){ return 'ERR '+e.message; } })()
    };
  });
  console.log('=== 线上 日汇总 8/21 ===');
  console.log(JSON.stringify(st, null, 2));
  console.log('=== 错误 ('+errs.length+') / 失败 ('+failed.length+') ===');
  errs.forEach(e=>console.log(' ', e));
  failed.slice(0,8).forEach(f=>console.log(' ', f));
  await browser.close();
})();

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = 'C:/Users/EDY/chuangliang_data';
const PORT = 8788;
const ARK_BASE = 'https://ark.cn-beijing.volces.com/api/v3';
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.ico': 'image/x-icon'
};

// ---------- Seedance / Seedream 代理：读取 ARK_API_KEY ----------
// 实时读取：环境变量每次取最新；.env 按 mtime 缓存，自动化改了 .env 无需重启代理
let _keyCache = { mtime: 0, value: null };
function readArkKey() {
  // 1) 环境变量优先（每次都读最新，便于无重启切换）
  if (process.env.ARK_API_KEY) return process.env.ARK_API_KEY.trim();
  // 2) 同目录 .env 文件：ARK_API_KEY=volc-sk-xxx
  try {
    const p = path.join(ROOT, '.env');
    if (fs.existsSync(p)) {
      const st = fs.statSync(p);
      if (st.mtimeMs !== _keyCache.mtime || _keyCache.value === null) {
        const txt = fs.readFileSync(p, 'utf-8');
        const m = txt.match(/^\s*ARK_API_KEY\s*=\s*(.+?)\s*$/m);
        _keyCache = { mtime: st.mtimeMs, value: m && m[1] ? m[1].trim() : '' };
      }
      return _keyCache.value || '';
    }
  } catch (e) { /* ignore */ }
  return '';
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 60 * 1024 * 1024) req.destroy(); });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(new Error('请求体不是合法 JSON')); }
    });
    req.on('error', reject);
  });
}

// 代理转发到火山方舟，原样透传状态码与响应体
async function proxyArk(res, method, targetPath, bodyObj) {
  const key = readArkKey();
  if (!key) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      error: '未配置 ARK_API_KEY。请在 chuangliang_data/.env 写入 ARK_API_KEY=volc-sk-xxx，或设置系统环境变量 ARK_API_KEY 后重启本服务。'
    }));
    return;
  }
  try {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }
    };
    if (bodyObj) opts.body = JSON.stringify(bodyObj);
    const r = await fetch(ARK_BASE + targetPath, opts);
    const txt = await r.text();
    res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(txt);
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '代理转发失败：' + String(e && e.message || e) }));
  }
}

async function handleApi(req, res, urlPath) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  try {
    // 创建视频生成任务（异步）
    if (urlPath === '/api/seedance' && req.method === 'POST') {
      const body = await readJsonBody(req);
      return proxyArk(res, 'POST', '/contents/generations/tasks', body);
    }
    // 轮询视频任务状态：GET /api/seedance/status/:id
    let m = urlPath.match(/^\/api\/seedance\/status\/(.+)$/);
    if (m && req.method === 'GET') {
      const id = decodeURIComponent(m[1]);
      return proxyArk(res, 'GET', '/contents/generations/tasks/' + id, null);
    }
    // 图片生成（同步）
    if (urlPath === '/api/seedream' && req.method === 'POST') {
      const body = await readJsonBody(req);
      return proxyArk(res, 'POST', '/images/generations', body);
    }
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '未知接口：' + urlPath }));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: String(e && e.message || e) }));
  }
}

const server = http.createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);

    // API 代理优先处理（带 CORS，供 GitHub Pages 看板跨域调用）
    if (urlPath.startsWith('/api/')) { await handleApi(req, res, urlPath); return; }

    if (urlPath === '/') urlPath = '/index.html';
    // 防目录穿越
    const safe = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
    const filePath = path.join(ROOT, safe);
    if (!path.resolve(filePath).startsWith(path.resolve(ROOT))) {
      res.writeHead(403); res.end('forbidden'); return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found: ' + urlPath);
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': TYPES[ext] || 'application/octet-stream',
        'Content-Length': data.length,
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(data);
    });
  } catch (e) {
    res.writeHead(500); res.end('server error');
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log('Port ' + PORT + ' already in use — another instance is running. Exiting duplicate.');
    process.exit(0);
  } else {
    console.error('Server error:', e);
    process.exit(1);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Dashboard local server running at http://localhost:' + PORT + '/');
  console.log('Seedance 2.0 proxy ready: /api/seedance  /api/seedance/status/:id  /api/seedream');
});

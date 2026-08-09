const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

// ---------- 代理密钥读取：支持 ARK_API_KEY 与 SILICONFLOW_API_KEY ----------
// 实时读取：环境变量每次取最新；.env 按 mtime 缓存，自动化改了 .env 无需重启代理
let _envCache = { mtime: 0, map: null };
function readEnvKeys() {
  try {
    const p = path.join(ROOT, '.env');
    if (fs.existsSync(p)) {
      const st = fs.statSync(p);
      if (st.mtimeMs !== _envCache.mtime || _envCache.map === null) {
        const txt = fs.readFileSync(p, 'utf-8');
        const map = {};
        txt.split(/\r?\n/).forEach(line => {
          const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.+?)\s*$/);
          if (m) map[m[1]] = m[2];
        });
        _envCache = { mtime: st.mtimeMs, map };
      }
      return _envCache.map || {};
    }
  } catch (e) { /* ignore */ }
  return {};
}
function readKey(name) {
  // 1) 环境变量优先（每次都读最新，便于无重启切换）
  if (process.env[name]) return process.env[name].trim();
  // 2) 同目录 .env 文件
  return (readEnvKeys()[name] || '').trim();
}
const readArkKey = () => readKey('ARK_API_KEY');
const readSfKey = () => readKey('SILICONFLOW_API_KEY');
const readPiapiKey = () => readKey('PIAPI_API_KEY');
const readVolcAk = () => readKey('VOLC_ACCESS_KEY');
const readVolcSk = () => readKey('VOLC_SECRET_KEY');

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
      error: '未配置 ARK_API_KEY。请在 chuangliang_data/.env 写入 ARK_API_KEY=ark-xxx（方舟 Key 以 ark- 开头），或设置系统环境变量 ARK_API_KEY 后重启本服务。'
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

// 代理转发到硅基流动 SiliconFlow（免费/低成本通道）：图片 / 视频
const SF_BASE = 'https://api.siliconflow.cn/v1';
async function proxySf(res, method, targetPath, bodyObj) {
  const key = readSfKey();
  if (!key) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      error: '未配置 SILICONFLOW_API_KEY。请在 chuangliang_data/.env 写入 SILICONFLOW_API_KEY=sk-xxx（硅基流动控制台获取），本服务将自动读取。'
    }));
    return;
  }
  try {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }
    };
    if (bodyObj) opts.body = JSON.stringify(bodyObj);
    const r = await fetch(SF_BASE + targetPath, opts);
    const txt = await r.text();
    res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(txt);
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '硅基流动代理转发失败：' + String(e && e.message || e) }));
  }
}

// 代理转发到 PiAPI（Seedance 2.0 真模型：注册送免费额度，可进看板）
const PIAPI_BASE = 'https://api.piapi.ai/api/v1';
async function proxyPiapi(res, method, targetPath, bodyObj) {
  const key = readPiapiKey();
  if (!key) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      error: '未配置 PIAPI_API_KEY。请在 chuangliang_data/.env 写入 PIAPI_API_KEY=你的PiAPI密钥（从 piapi.ai 控制台「API Key」页复制 X-API-Key），保存后本服务会自动读取（无需重启）。'
    }));
    return;
  }
  try {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json', 'X-API-Key': key }
    };
    if (bodyObj) opts.body = JSON.stringify(bodyObj);
    const r = await fetch(PIAPI_BASE + targetPath, opts);
    const txt = await r.text();
    res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(txt);
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'PiAPI 代理转发失败：' + String(e && e.message || e) }));
  }
}

// ============ 即梦AI 官方 API（火山引擎·智能视觉，HMAC-SHA256 签名） ============
const JIMENG_BASE = 'https://visual.volcengineapi.com';
const JIMENG_HOST = 'visual.volcengineapi.com';

function _hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}
function _sha256Hex(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

// 火山引擎 V4 风格签名：返回 { xDate, hashedPayload, authorization }
function signVolcengine({ method, path = '/', query = {}, body = '', ak, sk, region = 'cn-north-1', service = 'cv' }) {
  const now = new Date();
  const iso = now.toISOString(); // e.g. 2024-08-28T09:24:45.678Z
  const xDate = iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'); // 20240828T092445Z
  const date = xDate.slice(0, 8); // 20240828
  const hashedPayload = _sha256Hex(body || '');

  const canonicalHeaders =
    'host:' + JIMENG_HOST + '\n' +
    'x-content-sha256:' + hashedPayload + '\n' +
    'x-date:' + xDate + '\n';
  const signedHeaders = 'host;x-content-sha256;x-date';

  const canonicalQuery = Object.keys(query).sort().map(k =>
    encodeURIComponent(k) + '=' + encodeURIComponent(query[k])
  ).join('&');

  const canonicalRequest = [
    method.toUpperCase(),
    path,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    hashedPayload
  ].join('\n');

  const scope = date + '/' + region + '/' + service + '/request';
  const stringToSign = [
    'HMAC-SHA256',
    xDate,
    scope,
    _sha256Hex(canonicalRequest)
  ].join('\n');

  let kDate = _hmac(sk, date);
  let kRegion = _hmac(kDate, region);
  let kService = _hmac(kRegion, service);
  let kSigning = _hmac(kService, 'request');
  const signature = _hmac(kSigning, stringToSign).toString('hex');

  const authorization =
    'HMAC-SHA256 Credential=' + ak + '/' + scope +
    ', SignedHeaders=' + signedHeaders +
    ', Signature=' + signature;

  return { xDate, hashedPayload, authorization };
}

async function proxyJimeng(res, method, queryObj, bodyObj) {
  const ak = readVolcAk();
  const sk = readVolcSk();
  if (!ak || !sk) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      error: '未配置火山引擎 AccessKey/SecretKey。请在 chuangliang_data/.env 写入 VOLC_ACCESS_KEY=你的AK 与 VOLC_SECRET_KEY=你的SK（火山引擎控制台「访问控制→密钥管理」创建；账号需实名认证并开通「即梦AI-视频生成3.0」服务，选免费试用）。保存后本服务会自动读取（无需重启）。'
    }));
    return;
  }
  try {
    const body = bodyObj ? JSON.stringify(bodyObj) : '';
    const q = queryObj || {};
    const sign = signVolcengine({ method, path: '/', query: q, body, ak, sk });
    const queryStr = Object.keys(q).sort().map(k =>
      encodeURIComponent(k) + '=' + encodeURIComponent(q[k])
    ).join('&');
    const url = JIMENG_BASE + '/?' + queryStr;
    const r = await fetch(url, {
      method,
      headers: {
        'Host': JIMENG_HOST,
        'X-Date': sign.xDate,
        'X-Content-Sha256': sign.hashedPayload,
        'Authorization': sign.authorization,
        'Content-Type': 'application/json'
      },
      body: body || undefined
    });
    const txt = await r.text();
    res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(txt);
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '即梦AI代理转发失败：' + String(e && e.message || e) }));
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
    // ---------- 硅基流动 SiliconFlow 免费/低成本通道 ----------
    // 图片生成（同步）：POST /api/sf/image -> /v1/images/generations
    if (urlPath === '/api/sf/image' && req.method === 'POST') {
      const body = await readJsonBody(req);
      return proxySf(res, 'POST', '/images/generations', body);
    }
    // 视频提交（异步）：POST /api/sf/video -> /v1/video/submit
    if (urlPath === '/api/sf/video' && req.method === 'POST') {
      const body = await readJsonBody(req);
      return proxySf(res, 'POST', '/video/submit', body);
    }
    // 视频状态轮询：POST /api/sf/video/status/:id -> /v1/video/status (body: {"requestId": id})
    let sm = urlPath.match(/^\/api\/sf\/video\/status\/(.+)$/);
    if (sm && req.method === 'POST') {
      const id = decodeURIComponent(sm[1]);
      return proxySf(res, 'POST', '/video/status', { requestId: id });
    }
    // ---------- PiAPI（Seedance 2.0 真模型：注册送免费额度，可进看板） ----------
    // 提交视频任务：POST /api/piapi/video -> /api/v1/task
    if (urlPath === '/api/piapi/video' && req.method === 'POST') {
      const body = await readJsonBody(req);
      return proxyPiapi(res, 'POST', '/task', body);
    }
    // 轮询状态：GET /api/piapi/video/status/:id -> /api/v1/task/:id
    let pm = urlPath.match(/^\/api\/piapi\/video\/status\/(.+)$/);
    if (pm && req.method === 'GET') {
      const id = decodeURIComponent(pm[1]);
      return proxyPiapi(res, 'GET', '/task/' + id, null);
    }
    // ---------- 即梦AI 官方 API（火山引擎智能视觉，HMAC 签名） ----------
    // 提交视频任务：POST /api/jimeng/video -> Action=CVSync2AsyncSubmitTask
    if (urlPath === '/api/jimeng/video' && req.method === 'POST') {
      const body = await readJsonBody(req);
      return proxyJimeng(res, 'POST', { Action: 'CVSync2AsyncSubmitTask', Version: '2022-08-31' }, body);
    }
    // 轮询状态：POST /api/jimeng/video/status/:id -> Action=CVSync2AsyncGetResult（body 含 req_key+task_id）
    let jm = urlPath.match(/^\/api\/jimeng\/video\/status\/(.+)$/);
    if (jm && req.method === 'POST') {
      const body = await readJsonBody(req);
      return proxyJimeng(res, 'POST', { Action: 'CVSync2AsyncGetResult', Version: '2022-08-31' }, body);
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
  console.log('SiliconFlow proxy ready: /api/sf/image  /api/sf/video  /api/sf/video/status/:id');
  console.log('PiAPI proxy ready: /api/piapi/video  /api/piapi/video/status/:id');
  console.log('Jimeng(即梦) proxy ready: /api/jimeng/video  /api/jimeng/video/status/:id');
});

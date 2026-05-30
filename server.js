import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProxyAgent, setGlobalDispatcher } from 'undici';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const publicDir = join(__dirname, 'public');
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '0.0.0.0';
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY || '';

if (proxyUrl) {
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    if (req.method === 'POST' && url.pathname === '/api/check') {
      const body = await readJsonBody(req);
      const result = await checkTrial(body);
      sendOfficialResponse(res, result);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/accounts') {
      const body = await readJsonBody(req);
      const result = await checkAccounts(body);
      sendOfficialResponse(res, result);
      return;
    }

    if (req.method === 'GET') {
      await serveStatic(url.pathname, res);
      return;
    }

    sendJson(res, 405, { ok: false, error: 'Method not allowed' });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: formatError(error),
    });
  }
});

server.listen(port, host, () => {
  console.log(`ChatGPT Plus Trial Checker running at http://${host}:${port}`);
});

server.on('error', (error) => {
  if (error?.code === 'EADDRINUSE') {
    console.error(`${host}:${port} is already in use. Close the existing server or start with another port, for example: $env:PORT = "8788"; npm start`);
    process.exit(1);
  }
  throw error;
});

async function checkTrial(input) {
  const accessToken = String(input?.accessToken || '').trim();
  if (!accessToken) {
    return { status: 400, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ error: 'Missing accessToken' }) };
  }

  const response = await probeCoupon(accessToken);
  return await readOfficialResponse(response);
}

async function checkAccounts(input) {
  const accessToken = String(input?.accessToken || '').trim();
  if (!accessToken) {
    return { status: 400, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ error: 'Missing accessToken' }) };
  }

  const response = await probeAccounts(accessToken);
  return await readOfficialResponse(response);
}

async function readOfficialResponse(response) {
  const contentType = response.headers.get('content-type') || 'application/json; charset=utf-8';
  const body = await response.text();
  return { status: response.status, contentType, body };
}

function buildChatGptHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Origin: 'https://chatgpt.com',
    Referer: 'https://chatgpt.com/',
    'oai-language': 'zh-CN',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
  };
}

async function probeCoupon(accessToken) {
  const couponUrl = 'https://chatgpt.com/backend-api/promo_campaign/check_coupon?coupon=plus-1-month-free&is_coupon_from_query_param=true';
  return await fetch(couponUrl, {
    method: 'GET',
    headers: buildChatGptHeaders(accessToken),
  }).catch((error) => {
    throw new Error(`official request failed: ${formatError(error)}`);
  });
}

async function probeAccounts(accessToken) {
  const accountsUrl = 'https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27';
  return await fetch(accountsUrl, {
    method: 'GET',
    headers: buildChatGptHeaders(accessToken),
  }).catch((error) => {
    throw new Error(`official accounts request failed: ${formatError(error)}`);
  });
}

function formatError(error) {
  const cause = error?.cause;
  const parts = [error?.name, error?.message].filter(Boolean);
  if (cause?.code || cause?.message) {
    parts.push(`cause=${[cause.code, cause.message].filter(Boolean).join(' ')}`);
  }
  return parts.join(': ') || String(error);
}

async function readJsonBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1024 * 1024) {
      throw new Error('Request body too large');
    }
  }
  return body ? JSON.parse(body) : {};
}

async function serveStatic(pathname, res) {
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = normalize(join(publicDir, safePath));
  if (!filePath.startsWith(publicDir)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  try {
    const content = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': mimeTypes[extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(content);
  } catch {
    sendText(res, 404, 'Not found');
  }
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data, null, 2));
}

function sendOfficialResponse(res, result) {
  res.writeHead(result.status, {
    'Content-Type': result.contentType,
    'Cache-Control': 'no-store',
  });
  res.end(result.body);
}

function sendText(res, status, text) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

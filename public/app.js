const tokenInput = document.getElementById('tokenInput');
const checkButton = document.getElementById('checkButton');
const resultEl = document.getElementById('result');
const badgeEl = document.getElementById('badge');

const tokenParseStorageKey = 'trialChecker.tokenParseExpanded';
let currentTokenParse = null;
let currentOfficialResult = null;
let currentAccountResult = null;
let activeResultTab = 'check';
let checkRequestId = 0;

tokenInput.addEventListener('input', () => {
  const accessToken = extractAccessToken(tokenInput.value);
  if (!accessToken) {
    currentTokenParse = null;
    currentOfficialResult = null;
    currentAccountResult = null;
    resetResult();
    return;
  }

  const tokenParse = parseAccessToken(accessToken);
  if (tokenParse.ok) {
    currentTokenParse = tokenParse;
    currentOfficialResult = null;
    currentAccountResult = null;
    activeResultTab = 'check';
    renderResultTabs();
  }
});

checkButton.addEventListener('click', async () => {
  const accessToken = extractAccessToken(tokenInput.value);
  if (!accessToken) {
    render('no', '缺少 token', '请先粘贴 accessToken 或 session JSON。');
    return;
  }

  const tokenParse = parseAccessToken(accessToken);
  currentTokenParse = tokenParse;
  currentOfficialResult = null;
  currentAccountResult = null;
  activeResultTab = 'check';
  const requestId = ++checkRequestId;
  setBusy(true);

  try {
    const requestBody = JSON.stringify({ accessToken });
    loadAccountPlan(requestBody, requestId);
    const officialResult = await fetch('/api/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: requestBody,
    }).then(readOfficialResult);
    if (requestId !== checkRequestId) return;
    currentOfficialResult = officialResult;
    activeResultTab = 'check';
    renderResultTabs();
  } catch (error) {
    if (requestId !== checkRequestId) return;
    currentOfficialResult = buildClientErrorResult(error);
    currentAccountResult = null;
    activeResultTab = 'check';
    renderResultTabs();
  } finally {
    setBusy(false);
  }
});

async function loadAccountPlan(requestBody, requestId) {
  try {
    const accountResult = await fetch('/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: requestBody,
    }).then(readOfficialResult);
    if (requestId !== checkRequestId) return;
    currentAccountResult = accountResult;
    if (currentOfficialResult) {
      renderResultTabs();
    }
  } catch {
    if (requestId === checkRequestId) {
      currentAccountResult = null;
    }
  }
}

async function readOfficialResult(response) {
  const rawText = await response.text();
  let data = null;
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch {
    data = { raw: rawText };
  }
  return {
    ok: response.ok,
    status: response.status,
    data,
    rawText,
  };
}

function buildClientErrorResult(error) {
  const message = error?.message || String(error);
  return {
    ok: false,
    status: 0,
    data: { error: message },
    rawText: JSON.stringify({ error: message }, null, 2),
  };
}

function extractAccessToken(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';

  try {
    const parsed = JSON.parse(text);
    const token = parsed?.accessToken || parsed?.access_token || parsed?.tokens?.access_token;
    if (typeof token === 'string' && token.split('.').length === 3) {
      return token.trim();
    }
  } catch {
    // Continue with regex extraction.
  }

  const fieldMatch = text.match(/"accessToken"\s*:\s*"([^"]+)"/) || text.match(/"access_token"\s*:\s*"([^"]+)"/);
  if (fieldMatch?.[1]) return fieldMatch[1].trim();

  const jwtMatch = text.match(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/);
  return jwtMatch?.[0] || '';
}

function parseAccessToken(token) {
  try {
    const parts = String(token || '').trim().split('.');
    if (parts.length !== 3) {
      throw new Error('这不是标准 JWT：需要 header.payload.signature 三段。');
    }

    const header = parseJwtPart(parts[0], 'Header');
    const payload = parseJwtPart(parts[1], 'Payload');
    return {
      ok: true,
      summary: buildJwtSummary(header, payload),
      header,
      payload,
      headerJson: JSON.stringify(header, null, 2),
      payloadJson: JSON.stringify(payload, null, 2),
      signatureLength: parts[2].length,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Token 解析失败。',
    };
  }
}

function parseJwtPart(value, label) {
  try {
    const parsed = JSON.parse(decodeBase64Url(value));
    if (!isRecord(parsed)) {
      throw new Error(`${label} 不是 JSON 对象。`);
    }
    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`${label} JSON 解析失败。`);
    }
    throw error;
  }
}

function decodeBase64Url(value) {
  const base64 = String(value || '').replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function buildJwtSummary(header, payload) {
  const auth = toRecord(payload['https://api.openai.com/auth'] || payload.auth_data);
  const profile = toRecord(payload['https://api.openai.com/profile'] || payload.profile);
  const scopes = Array.isArray(payload.scp) ? payload.scp.map(String).join(', ') : valueText(payload.scp || payload.scope);

  return [
    { label: '类型', value: valueText(header.typ) },
    { label: '算法', value: valueText(header.alg) },
    { label: 'Key ID', value: valueText(header.kid) },
    { label: '邮箱', value: valueText(profile.email || payload.email) },
    { label: '邮箱验证', value: valueText(profile.email_verified ?? payload.email_verified) },
    { label: '计划', value: valueText(auth.chatgpt_plan_type || auth.plan_type) },
    { label: 'ChatGPT 账号 ID', value: valueText(auth.chatgpt_account_id || auth.account_id || payload.account_id) },
    { label: 'ChatGPT 用户 ID', value: valueText(auth.chatgpt_user_id || auth.user_id || payload.user_id) },
    { label: 'Client ID', value: valueText(payload.client_id) },
    { label: '签发方', value: valueText(payload.iss) },
    { label: '受众', value: Array.isArray(payload.aud) ? payload.aud.map(String).join(', ') : valueText(payload.aud) },
    { label: '签发时间', value: formatJwtTime(payload.iat) },
    { label: '生效时间', value: formatJwtTime(payload.nbf) },
    { label: '过期时间', value: formatJwtTime(payload.exp) },
    { label: '权限范围', value: scopes },
  ].filter((item) => item.value !== '-');
}

function formatJwtTime(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '-';
  const milliseconds = numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('zh-CN', { hour12: false });
}

function valueText(value) {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function toRecord(value) {
  return isRecord(value) ? value : {};
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function renderResultTabs() {
  if (!currentTokenParse && !currentOfficialResult) {
    resetResult();
    return;
  }

  const status = currentOfficialResult ? getOfficialStatus(currentOfficialResult, currentTokenParse) : null;
  if (status) {
    setBadge(status.kind, status.badge);
  } else {
    setBadge('idle', '待检测');
  }

  resultEl.hidden = false;
  resultEl.className = `result ${status ? status.kind : 'empty'}`;
  resultEl.innerHTML = `
    <div class="result-tabs" role="tablist" aria-label="结果">
      <button class="result-tab ${activeResultTab === 'check' ? 'active' : ''}" type="button" role="tab" aria-selected="${activeResultTab === 'check'}" data-tab="check">检测结果</button>
      <button class="result-tab ${activeResultTab === 'parse' ? 'active' : ''}" type="button" role="tab" aria-selected="${activeResultTab === 'parse'}" data-tab="parse">Token 解析</button>
    </div>
    <div class="result-pane">
      ${activeResultTab === 'check' ? renderCheckTab() : renderTokenParse(currentTokenParse)}
    </div>
  `;

  bindResultTabs();
  bindTokenParseToggle();
}

function renderCheckTab() {
  return currentOfficialResult ? renderOfficialResult(currentOfficialResult, currentTokenParse) : renderPendingResult();
}

function renderPendingResult() {
  return `
    <div class="result-hero">
      <div class="status-mark" aria-hidden="true">?</div>
      <div>
        <div class="result-kicker">检测结果</div>
        <strong>待检测</strong>
        <p>点击检测账号后显示官方接口返回结果。</p>
      </div>
    </div>
  `;
}

function getOfficialStatus(result, tokenParse) {
  const raw = result.data;
  const redemption = raw?.redemption || {};
  const accountUsable = result.ok;
  const couponState = raw?.state || raw?.status || '';
  const trialEligible = couponState === 'eligible';
  const trialRedeemed = Boolean(redemption.redeemed);
  const kind = !accountUsable ? 'no' : trialEligible ? 'ok' : trialRedeemed ? 'warn' : 'no';
  return {
    kind,
    badge: buildBadge(accountUsable, trialEligible, trialRedeemed),
    accountUsable,
    trialEligible,
    trialRedeemed,
    redemption,
    raw,
    title: buildTitle(accountUsable, trialEligible, trialRedeemed),
    email: getTokenEmail(tokenParse),
    accountPlan: currentAccountResult ? (getOfficialPlan(currentAccountResult.data) || '未知') : '获取中...',
    accountId: getTokenAccountId(tokenParse),
  };
}

function renderOfficialResult(result, tokenParse) {
  const status = getOfficialStatus(result, tokenParse);
  const {
    accountUsable,
    trialEligible,
    trialRedeemed,
    redemption,
    raw,
    title,
    email,
    accountPlan,
    accountId,
  } = status;
  const startedAt = redemption.user_redeemed_at
    || redemption.redeemed_at
    || redemption.workspace_redeemed_at
    || '';
  const expiresAt = redemption.expires_at || '';
  const formattedStartedAt = formatDateValue(startedAt);
  const formattedExpiresAt = formatDateValue(expiresAt);
  const message = buildMessage(
    accountUsable,
    trialEligible,
    trialRedeemed,
    formattedStartedAt,
    formattedExpiresAt,
    getOfficialError(raw) || (!result.ok ? `官方接口返回 HTTP ${result.status}。` : '')
  );
  const redeemedRows = trialRedeemed
    ? `
      ${renderResultRow('兑换时间', formattedStartedAt, 'neutral')}
      ${renderResultRow('到期时间', formattedExpiresAt, 'neutral')}
    `
    : '';

  return `
    <div class="result-hero">
      <div class="status-mark" aria-hidden="true">${escapeHtml(buildStatusMark(status.kind))}</div>
      <div>
        <div class="result-kicker">检测结果</div>
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(message)}</p>
      </div>
    </div>

    <dl class="result-list">
      ${renderResultRow('邮箱', email, 'neutral', false, accountPlan)}
      ${renderResultRow('试用资格', formatTrialStatus(accountUsable, trialEligible, trialRedeemed), trialEligible ? 'ok' : trialRedeemed ? 'warn' : 'neutral', trialEligible)}
      ${renderResultRow('已兑换', accountUsable ? (trialRedeemed ? '是' : '否') : '-', trialRedeemed ? 'warn' : 'neutral', accountUsable && trialRedeemed)}
      ${redeemedRows}
      ${renderResultRow('账号 ID', accountId || '-', 'neutral')}
    </dl>

    ${renderTrialHint(accountUsable, trialEligible, trialRedeemed)}
    ${renderRawJson(raw, result.rawText)}
  `;
}

function renderResultRow(label, value, tone, successIcon = false, tagText = '') {
  return `
    <div class="result-row ${escapeHtml(tone)}">
      <dt>${escapeHtml(label)}</dt>
      <dd>
        <span>${escapeHtml(value || '-')}</span>
        ${tagText ? `<span class="value-tag">${escapeHtml(tagText)}</span>` : ''}
        ${successIcon ? '<span class="success-icon" title="可以成功" aria-label="可以成功">✓</span>' : ''}
      </dd>
    </div>
  `;
}

function getTokenEmail(tokenParse) {
  const payload = tokenParse?.payload || {};
  const profile = payload['https://api.openai.com/profile'] || payload.profile || {};
  const summaryEmail = Array.isArray(tokenParse?.summary)
    ? tokenParse.summary.find((item) => item?.label === '邮箱')?.value
    : '';
  return profile.email || payload.email || summaryEmail || '-';
}

function getTokenPlan(tokenParse) {
  const payload = tokenParse?.payload || {};
  const auth = payload['https://api.openai.com/auth'] || payload.auth_data || {};
  const summaryPlan = Array.isArray(tokenParse?.summary)
    ? tokenParse.summary.find((item) => item?.label === '计划')?.value
    : '';
  const plan = String(auth.chatgpt_plan_type || auth.plan_type || payload.plan_type || summaryPlan || '').trim();
  return plan && plan !== '-' ? plan : '';
}

function getOfficialPlan(data) {
  return findFirstStringByKeys(data, ['plan_type']);
}

function findFirstStringByKeys(value, keys) {
  if (!value || typeof value !== 'object') return '';
  const keySet = new Set(keys);
  const queue = [value];
  const seen = new Set();

  while (queue.length) {
    const item = queue.shift();
    if (!item || typeof item !== 'object' || seen.has(item)) continue;
    seen.add(item);

    for (const [key, nestedValue] of Object.entries(item)) {
      if (keySet.has(key) && typeof nestedValue === 'string' && nestedValue.trim()) {
        return nestedValue.trim();
      }
      if (nestedValue && typeof nestedValue === 'object') {
        queue.push(nestedValue);
      }
    }
  }

  return '';
}

function getTokenAccountId(tokenParse) {
  const payload = tokenParse?.payload || {};
  const auth = payload['https://api.openai.com/auth'] || payload.auth_data || {};
  return String(auth.chatgpt_account_id || auth.account_id || payload.account_id || '').trim();
}

function getOfficialError(data) {
  if (!data || typeof data !== 'object') return '';
  return data.detail || data.message || data.error?.message || data.error || '';
}

function renderTrialHint(accountUsable, trialEligible, trialRedeemed) {
  if (!accountUsable || trialEligible || trialRedeemed) return '';
  return `
    <div class="result-advice">
      当前账号可用，但没有检测到试用资格。
    </div>
  `;
}

function renderRawJson(raw, rawText) {
  const text = rawText && typeof raw?.raw === 'string'
    ? raw.raw
    : JSON.stringify(raw, null, 2);
  return `
    <details class="fold-section">
      <summary>官方接口返回</summary>
      <pre>${escapeHtml(text || '')}</pre>
    </details>
  `;
}

function renderTokenParse(tokenParse) {
  if (!tokenParse) {
    return '';
  }

  const openAttr = isTokenParseExpanded() ? ' open' : '';

  if (!tokenParse.ok) {
    return `
      <details class="fold-section token-parse-section"${openAttr}>
        <summary>Access Token 解析</summary>
        <div class="parse-error">${escapeHtml(tokenParse.error || 'Token 解析失败。')}</div>
      </details>
    `;
  }

  const summary = Array.isArray(tokenParse.summary) ? tokenParse.summary : [];
  const summaryHtml = summary.map((item) => `
    <div>
      <span>${escapeHtml(item.label || '-')}</span>
      <strong>${escapeHtml(item.value || '-')}</strong>
    </div>
  `).join('');

  return `
    <details class="fold-section token-parse-section"${openAttr}>
      <summary>Access Token 解析</summary>
      <div class="token-summary">
        ${summaryHtml}
        <div>
          <span>签名长度</span>
          <strong>${escapeHtml(String(tokenParse.signatureLength ?? '-'))}</strong>
        </div>
      </div>
      <div class="token-json-grid">
        <section>
          <h3>Header</h3>
          <pre>${escapeHtml(tokenParse.headerJson || JSON.stringify(tokenParse.header || {}, null, 2))}</pre>
        </section>
        <section>
          <h3>Payload</h3>
          <pre>${escapeHtml(tokenParse.payloadJson || JSON.stringify(tokenParse.payload || {}, null, 2))}</pre>
        </section>
      </div>
    </details>
  `;
}

function bindTokenParseToggle() {
  const section = resultEl.querySelector('.token-parse-section');
  if (!section) return;
  section.addEventListener('toggle', () => {
    localStorage.setItem(tokenParseStorageKey, section.open ? '1' : '0');
  });
}

function bindResultTabs() {
  resultEl.querySelectorAll('.result-tab').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.disabled) return;
      activeResultTab = button.dataset.tab || 'parse';
      renderResultTabs();
    });
  });
}

function buildTitle(accountUsable, trialEligible, trialRedeemed) {
  if (!accountUsable) return '账号不可用或受限';
  if (trialEligible) return '账号可用，有 Plus 试用资格';
  if (trialRedeemed) return '账号可用，Plus 试用已兑换';
  return '账号可用，无 Plus 试用资格';
}

function buildBadge(accountUsable, trialEligible, trialRedeemed) {
  if (!accountUsable) return '账号不可用';
  if (trialEligible) return '有试用资格';
  if (trialRedeemed) return '已兑换';
  return '无试用资格';
}

function buildMessage(accountUsable, trialEligible, trialRedeemed, startedAt, expiresAt, fallback) {
  if (!accountUsable) return fallback || '账号不可用或受限。';
  if (trialEligible) return '账号可用，当前有 Plus 一个月试用资格。';
  if (trialRedeemed) return '账号可用，Plus 试用已经兑换过。';
  return fallback || '账号可用，但当前没有 Plus 一个月试用资格。';
}

function formatTrialStatus(accountUsable, trialEligible, trialRedeemed) {
  if (!accountUsable) return '-';
  if (trialEligible) return '是';
  if (trialRedeemed) return '已用';
  return '否';
}

function formatDateValue(value) {
  if (!value) return '-';

  const text = String(value).trim();
  const numeric = Number(text);
  const date = Number.isFinite(numeric) && text.length <= 13
    ? new Date(numeric < 1e12 ? numeric * 1000 : numeric)
    : new Date(text);

  if (Number.isNaN(date.getTime())) {
    return text;
  }

  const yyyy = String(date.getFullYear());
  const mm = pad2(date.getMonth() + 1);
  const dd = pad2(date.getDate());
  const hh = pad2(date.getHours());
  const mi = pad2(date.getMinutes());
  const ss = pad2(date.getSeconds());
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function render(kind, title, message) {
  setBadge(kind, kind === 'warn' ? '检测中' : kind === 'ok' ? '可用' : '异常');
  resultEl.hidden = false;
  resultEl.className = `result ${kind}`;
  resultEl.innerHTML = `
    <div class="result-hero">
      <div class="status-mark" aria-hidden="true">${escapeHtml(buildStatusMark(kind))}</div>
      <div>
        <div class="result-kicker">状态</div>
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(message)}</p>
      </div>
    </div>
  `;
}

function buildStatusMark(kind) {
  if (kind === 'ok') return '✓';
  if (kind === 'warn') return '...';
  return '!';
}

function setBusy(busy) {
  checkButton.disabled = busy;
  checkButton.textContent = busy ? '检测中...' : '检测账号';
}

function setBadge(kind, text) {
  badgeEl.className = `badge ${kind}`;
  badgeEl.textContent = text;
}

function resetResult() {
  setBadge('idle', '待检测');
  resultEl.hidden = true;
  resultEl.className = 'result empty';
  resultEl.innerHTML = '';
}

function isTokenParseExpanded() {
  return localStorage.getItem(tokenParseStorageKey) === '1';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

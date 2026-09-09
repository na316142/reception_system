/*
 * 会場受付 Webアプリ
 *
 * 必ず設定:
 *   GAS_ORIGIN = GAS Webアプリのorigin（通常 https://script.google.com）
 *
 * index.html の iframe src にはデプロイ済みGASの /exec URLを指定。
 */

const GAS_ORIGIN = 'https://script.google.com';

let scanner = null;
let scannerRunning = false;
let scannerLocked = false;
let lastDecodedText = '';
let lastDecodedAt = 0;
let deviceName = localStorage.getItem('receptionDeviceName') || '';

const pending = new Map();
let requestSeq = 0;

const els = {
  bridge: document.getElementById('gasBridge'),
  deviceModal: document.getElementById('deviceModal'),
  deviceNameInput: document.getElementById('deviceNameInput'),
  saveDeviceBtn: document.getElementById('saveDeviceBtn'),
  deviceBadge: document.getElementById('deviceBadge'),
  connectionStatus: document.getElementById('connectionStatus'),
  cameraStartBtn: document.getElementById('cameraStartBtn'),
  cameraStopBtn: document.getElementById('cameraStopBtn'),
  scannerMessage: document.getElementById('scannerMessage'),
  searchInput: document.getElementById('searchInput'),
  searchBtn: document.getElementById('searchBtn'),
  searchResults: document.getElementById('searchResults'),
  lastResult: document.getElementById('lastResult'),
  noteModal: document.getElementById('noteModal'),
  noteName: document.getElementById('noteName'),
  noteOrg: document.getElementById('noteOrg'),
  noteBody: document.getElementById('noteBody'),
  noteConfirmBtn: document.getElementById('noteConfirmBtn')
};

document.addEventListener('DOMContentLoaded', init);

function init() {
  if (deviceName) {
    els.deviceModal.classList.remove('show');
    els.deviceBadge.textContent = deviceName;
  } else {
    els.deviceModal.classList.add('show');
  }

  els.saveDeviceBtn.addEventListener('click', saveDeviceName);
  els.cameraStartBtn.addEventListener('click', startScanner);
  els.cameraStopBtn.addEventListener('click', stopScanner);
  els.searchBtn.addEventListener('click', doSearch);
  els.searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') doSearch();
  });
  els.noteConfirmBtn.addEventListener('click', closeNoteAndResume);

  window.addEventListener('message', onBridgeMessage);

  // iframe読込後に疎通確認
  els.bridge.addEventListener('load', async () => {
    try {
      const r = await callGas({ action: 'ping' }, 12000);
      if (r && r.ok) {
        setConnection(true);
      } else {
        setConnection(false);
      }
    } catch (e) {
      console.error(e);
      setConnection(false);
    }
  });
}

function saveDeviceName() {
  const v = (els.deviceNameInput.value || '').trim();
  if (!v) {
    alert('端末名を入力してください。');
    return;
  }
  deviceName = v;
  localStorage.setItem('receptionDeviceName', v);
  els.deviceBadge.textContent = v;
  els.deviceModal.classList.remove('show');
}

function setConnection(ok) {
  els.connectionStatus.textContent = ok ? 'GAS接続OK' : 'GAS未接続';
  els.connectionStatus.className = 'status ' + (ok ? 'status-ok' : 'status-warn');
}

function callGas(payload, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    if (!els.bridge.contentWindow) {
      reject(new Error('GAS Bridgeが読み込まれていません。'));
      return;
    }

    const requestId = 'r' + Date.now() + '_' + (++requestSeq);
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error('GAS通信がタイムアウトしました。'));
    }, timeoutMs);

    pending.set(requestId, { resolve, reject, timer });

    els.bridge.contentWindow.postMessage({
      type: 'reception-request',
      requestId,
      payload
    }, '*');
  });
}





function onBridgeMessage(event) {

  // GAS Bridgeとして埋め込んだiframeからの通信だけを受け付ける
  if (event.source !== els.bridge.contentWindow) return;

  const msg = event.data || {};

  if (
    msg.type !== 'reception-response' ||
    !msg.requestId
  ) {
    return;
  }

  const p = pending.get(msg.requestId);

  if (!p) return;

  clearTimeout(p.timer);
  pending.delete(msg.requestId);

  if (msg.error) {
    p.reject(new Error(msg.error));
  } else {
    p.resolve(msg.result);
  }
}















async function startScanner() {
  if (scannerRunning || scannerLocked) return;

  if (!deviceName) {
    els.deviceModal.classList.add('show');
    return;
  }

  try {
    scanner = scanner || new Html5Qrcode('reader');

    const config = {
      fps: 12,
      qrbox: (viewfinderWidth, viewfinderHeight) => {
        const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
        const size = Math.floor(minEdge * 0.72);
        return { width: size, height: size };
      },
      aspectRatio: 1.333333
    };

    await scanner.start(
      { facingMode: 'environment' },
      config,
      onScanSuccess,
      () => {}
    );

    scannerRunning = true;
    els.scannerMessage.textContent = 'QRコードをカメラにかざしてください';
  } catch (e) {
    console.error(e);
    els.scannerMessage.textContent =
      'カメラを開始できません。ブラウザのカメラ許可を確認してください。';
  }
}

async function stopScanner() {
  if (!scanner || !scannerRunning) return;
  try {
    await scanner.stop();
  } catch (e) {
    console.warn(e);
  }
  scannerRunning = false;
}

async function pauseScannerForProcessing() {
  scannerLocked = true;
  // カメラ映像は維持し、解析だけ停止する
  if (scanner && scannerRunning) {
    try {
      scanner.pause(true);
    } catch (e) {
      console.warn(e);
    }
  }
}

function resumeScanner() {
  scannerLocked = false;
  if (scanner && scannerRunning) {
    try {
      scanner.resume();
    } catch (e) {
      console.warn(e);
    }
  }
  els.scannerMessage.textContent = 'QRコードをカメラにかざしてください';
}

async function onScanSuccess(decodedText) {
  if (scannerLocked) return;

  const id = String(decodedText || '').trim();
  if (!id) return;

  // 同一QRをカメラにかざし続けた場合の連続発火を抑制
  const now = Date.now();
  if (id === lastDecodedText && now - lastDecodedAt < 2500) return;
  lastDecodedText = id;
  lastDecodedAt = now;

  await pauseScannerForProcessing();
  els.scannerMessage.textContent = '受付処理中…';

  try {
    const result = await callGas({
      action: 'checkIn',
      id,
      device: deviceName,
      method: 'qr'
    });

    await handleCheckInResult(result);
  } catch (e) {
    console.error(e);
    showResult('error', '通信エラー', '', e.message || '受付処理に失敗しました。');
    setConnection(false);
    setTimeout(resumeScanner, 1500);
  }
}

async function handleCheckInResult(result) {
  if (!result || !result.ok) {
    const msg = result && result.message ? result.message : '受付できませんでした。';
    showResult('error', '受付できません', '', msg);
    els.scannerMessage.textContent = msg;
    setTimeout(resumeScanner, 1400);
    return;
  }

  setConnection(true);

  if (result.status === 'duplicate') {
    const sub = `${result.org || ''}\n初回受付：${result.firstTime || '-'}`;
    showResult('duplicate', '⚠ 受付済みです', result.name, sub);

    // 重複でも連絡事項があるなら表示
    if (result.note) {
      showNote(result);
      return;
    }

    setTimeout(resumeScanner, 1800);
    return;
  }

  showResult(
    'success',
    '✓ 受付しました',
    result.name,
    `${result.org || ''}\n受付：${result.firstTime || ''}`
  );

  if (result.note) {
    showNote(result);
    return;
  }

  els.scannerMessage.textContent = `受付完了：${result.name}`;
  setTimeout(resumeScanner, 900);
}

function showNote(result) {
  // 連絡事項確認中は scannerLocked=true のまま。
  els.noteName.textContent = result.name || '';
  els.noteOrg.textContent = result.org || '';
  els.noteBody.textContent = result.note || '';
  els.noteModal.classList.add('show');

  // 2回振動。非対応端末では何も起きない。
  if ('vibrate' in navigator) {
    try {
      navigator.vibrate([250, 160, 250]);
    } catch (e) {}
  }

  // 短い警告音（Web Audio）。端末設定等で鳴らないこともある。
  beepTwice();
}

function closeNoteAndResume() {
  els.noteModal.classList.remove('show');
  resumeScanner();
}

function beepTwice() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    [0, 0.32].forEach(offset => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.08;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.14);
    });

    setTimeout(() => ctx.close(), 1000);
  } catch (e) {}
}

function showResult(kind, title, name, detail) {
  els.lastResult.className =
    `card last-result result-${kind}`;
  els.lastResult.innerHTML = `
    <div class="result-title">${escapeHtml(title)}</div>
    ${name ? `<div class="result-name">${escapeHtml(name)}</div>` : ''}
    ${detail ? `<div class="result-meta">${escapeHtml(detail).replace(/\n/g, '<br>')}</div>` : ''}
  `;
  els.lastResult.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function doSearch() {
  const keyword = (els.searchInput.value || '').trim();
  if (keyword.length < 2) {
    els.searchResults.innerHTML = '<div class="result-meta">2文字以上入力してください。</div>';
    return;
  }

  els.searchBtn.disabled = true;
  els.searchResults.innerHTML = '<div class="result-meta">検索中…</div>';

  try {
    const r = await callGas({
      action: 'search',
      keyword
    });

    if (!r || !r.ok) throw new Error((r && r.message) || '検索に失敗しました。');
    renderSearchResults(r.results || []);
  } catch (e) {
    els.searchResults.innerHTML =
      `<div class="result-meta">${escapeHtml(e.message)}</div>`;
  } finally {
    els.searchBtn.disabled = false;
  }
}

function renderSearchResults(results) {
  if (!results.length) {
    els.searchResults.innerHTML = '<div class="result-meta">該当者はいません。</div>';
    return;
  }

  els.searchResults.innerHTML = '';
  results.forEach(person => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'search-item';
    b.innerHTML = `
      <div class="search-item-name">${escapeHtml(person.name)}</div>
      <div class="search-item-meta">
        ${escapeHtml(person.kana || '')}<br>
        ${escapeHtml(person.org || '')}<br>
        ID: ${escapeHtml(person.id)}
      </div>
      ${person.attended
        ? `<span class="search-item-attended">受付済み ${escapeHtml(person.firstTime || '')}</span>`
        : ''}
    `;
    b.addEventListener('click', () => manualCheckIn(person));
    els.searchResults.appendChild(b);
  });
}

async function manualCheckIn(person) {
  const label = person.attended
    ? `${person.name}さんは受付済みです。再度受付情報を確認しますか？`
    : `${person.name}さんを受付しますか？`;

  if (!confirm(label)) return;

  scannerLocked = true;
  if (scanner && scannerRunning) {
    try { scanner.pause(true); } catch (e) {}
  }

  try {
    const result = await callGas({
      action: 'checkIn',
      id: person.id,
      device: deviceName,
      method: 'search'
    });
    await handleCheckInResult(result);
  } catch (e) {
    showResult('error', '通信エラー', person.name, e.message);
    setTimeout(resumeScanner, 1500);
  }
}

function escapeHtml(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

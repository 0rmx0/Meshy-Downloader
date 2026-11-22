let currentTabId = null;
let meta = null;
let texNames = [];
let language = localStorage.getItem('meshyDownloaderLanguage') === 'en' ? 'en' : 'fr';

const DB_NAME = 'meshy_dl';
const DB_VERSION = 3;

const api = (typeof browser !== 'undefined' && browser?.runtime) ? browser : chrome;

// ── Icônes SVG (Lucide) ─────────────────────────────────────────────────────
const SVG_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const ICONS = {
  box: `<svg ${SVG_ATTRS}><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>`,
  image: `<svg ${SVG_ATTRS}><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`,
  download: `<svg ${SVG_ATTRS}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>`,
  sparkles: `<svg ${SVG_ATTRS}><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>`,
  loader: `<svg ${SVG_ATTRS}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`,
  check: `<svg ${SVG_ATTRS}><path d="M20 6 9 17l-5-5"/></svg>`,
  x: `<svg ${SVG_ATTRS}><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`
};

function setBtn(btn, icon, label) {
  btn.innerHTML = (ICONS[icon] || '') + '<span class="btn-label"></span>';
  btn.querySelector('.btn-label').textContent = label;
}

// ── Langue (FR/EN) ──────────────────────────────────────────────────────────
const translations = {
  fr: {
    intro: 'Modèles 3D CC0 depuis la visionneuse',
    hint: 'Ouvre une page de modèle Meshy : la visionneuse 3D doit charger le modèle pour activer le téléchargement.',
    hintLive: 'Expérimental : tente de récupérer le modèle tel qu\'affiché à l\'écran (avec édition en cours), sans dépendre du worker de déchiffrement. Peut échouer selon la page — regarde la console pour le détail.',
    waiting: 'En attente...',
    notOnMeshy: 'Pas sur une page Meshy',
    ready: 'Modèle intercepté, prêt au téléchargement',
    waitingModel: 'En attente du modèle...',
    possiblyEdited: 'Modèle capturé, mais peut-être périmé',
    error: 'Erreur: ',
    readyHint: count => `${count} texture(s) interceptée(s).`,
    editedHint: 'Une interaction a été détectée depuis la dernière capture (ajout de base, changement de matériau...). Le téléchargement classique renverra la dernière version interceptée, pas forcément ce que tu vois à l\'écran. Essaie "Capturer la scène actuelle" ci-dessous.',
    waitingHint: 'Laisse la visionneuse 3D charger le modèle complètement.',
    download: 'Tout télécharger',
    downloading: 'Téléchargement...',
    downloaded: 'Téléchargé !',
    errorBtn: 'Erreur',
    live: 'Capturer la scène actuelle',
    liveBusy: 'Capture en cours...',
    liveOk: 'Scène capturée !',
    liveFail: 'Échec (voir console)',
    selectLabel: 'Langue'
  },
  en: {
    intro: 'CC0 3D models from the viewer',
    hint: 'Open a Meshy model page: the 3D viewer must load the model to enable downloads.',
    hintLive: 'Experimental: tries to grab the model as shown on screen (including ongoing edits), without relying on the decrypt worker. May fail depending on the page — check the console for details.',
    waiting: 'Waiting...',
    notOnMeshy: 'Not on a Meshy page',
    ready: 'Model captured, ready to download',
    waitingModel: 'Waiting for the model...',
    possiblyEdited: 'Model captured, but may be outdated',
    error: 'Error: ',
    readyHint: count => `${count} texture(s) captured.`,
    editedHint: 'An interaction was detected since the last capture (base added, material changed...). The regular download will return the last intercepted version, not necessarily what you see on screen. Try "Capture current scene" below.',
    waitingHint: 'Let the 3D viewer finish loading the model.',
    download: 'Download all',
    downloading: 'Downloading...',
    downloaded: 'Downloaded!',
    errorBtn: 'Error',
    live: 'Capture current scene',
    liveBusy: 'Capturing...',
    liveOk: 'Scene captured!',
    liveFail: 'Failed (see console)',
    selectLabel: 'Language'
  }
};

function t() { return translations[language]; }

function applyLanguage() {
  const tr = t();
  document.documentElement.lang = language;
  const sel = document.getElementById('languageSelect');
  if (sel) {
    sel.value = language;
    sel.setAttribute('aria-label', tr.selectLabel);
  }
  document.getElementById('intro').textContent = tr.intro;
  document.getElementById('hint').textContent = tr.hint;
  document.getElementById('hintLive').textContent = tr.hintLive;
  setBtn(document.getElementById('btnDl'), 'download', tr.download);
  setBtn(document.getElementById('btnLive'), 'sparkles', tr.live);
}

document.getElementById('languageSelect').addEventListener('change', event => {
  language = event.target.value === 'en' ? 'en' : 'fr';
  localStorage.setItem('meshyDownloaderLanguage', language);
  applyLanguage();
  syncLanguageToPage();
  refresh();
});

async function syncLanguageToPage() {
  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url || !isMeshyUrl(tab.url)) return;
    await api.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: selectedLanguage => {
        try { localStorage.setItem('__meshyDLLanguage', selectedLanguage); } catch (e) {}
        window.dispatchEvent(new CustomEvent('__meshyDLLanguageChanged', { detail: selectedLanguage }));
      },
      args: [language]
    });
  } catch (e) {}
}

// ── Validation ──────────────────────────────────────────────────────────────
// Tout ce qui vient de l'IndexedDB de la page est potentiellement écrivable par
// n'importe quel script de la page : on valide/assainit avant usage.
function isMeshyUrl(url) {
  try {
    const h = new URL(url).hostname;
    return h === 'meshy.ai' || h.endsWith('.meshy.ai');
  } catch {
    return false;
  }
}

function sanitizeFileName(name) {
  const clean = String(name ?? '').replace(/[^\w\-. ]/g, '_').trim().slice(0, 100);
  return clean || 'model';
}

function sanitizeMeta(m) {
  if (!m || typeof m !== 'object') return null;
  return {
    status: m.status === 'ready' ? 'ready' : 'other',
    glbSize: Number.isFinite(m.glbSize) && m.glbSize > 0 ? m.glbSize : 0,
    texCount: Number.isFinite(m.texCount) && m.texCount > 0 ? m.texCount : 0,
    possiblyEdited: !!m.possiblyEdited,
    modelName: sanitizeFileName(m.modelName),
    glbHash: typeof m.glbHash === 'string' && /^[0-9a-f]{64}$/.test(m.glbHash) ? m.glbHash : null,
    texHashes: m.texHashes && typeof m.texHashes === 'object' ? m.texHashes : {}
  };
}

function sanitizeTexNames(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(n => typeof n === 'string' && n.length <= 200)
    .map(sanitizeFileName)
    .slice(0, 200);
}

// ── Lecture de l'IDB de la page (world MAIN, seul moyen d'y accéder) ────────
async function readFromPageIDB(tabId) {
  const results = await api.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => new Promise(resolve => {
      const out = {};
      const r = indexedDB.open('meshy_dl', 3);
      r.onupgradeneeded = e => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains('files')) d.createObjectStore('files');
      };
      r.onsuccess = e => {
        const db = e.target.result;
        try {
          const tx = db.transaction('files', 'readonly');
          const s = tx.objectStore('files');
          s.get('meta').onsuccess = ev => { out.meta = ev.target.result; };
          s.get('texNames').onsuccess = ev => { out.texNames = ev.target.result; };
          tx.oncomplete = () => resolve(out);
          tx.onerror = () => resolve(out);
          tx.onabort = () => resolve(out);
        } catch {
          resolve(out);
        }
      };
      r.onerror = () => resolve(out);
      r.onblocked = () => resolve(out);
    })
  });
  return results?.[0]?.result || {};
}

// ── UI ──────────────────────────────────────────────────────────────────────
function setStatus(type, text) {
  document.getElementById('dot').className = 'dot dot-' + type;
  document.getElementById('statusText').textContent = text;
}

function fileRow(icon, name, badgeClass, badgeText, rightText) {
  const row = document.createElement('div');
  row.className = 'file-row';
  const left = document.createElement('span');
  left.className = 'row-left';
  const iconSpan = document.createElement('span');
  iconSpan.className = 'file-icon';
  iconSpan.innerHTML = ICONS[icon] || ICONS.box;
  const nameSpan = document.createElement('span');
  nameSpan.className = 'file-name';
  nameSpan.textContent = name;
  const badge = document.createElement('span');
  badge.className = `badge ${badgeClass}`;
  badge.textContent = badgeText;
  left.appendChild(iconSpan);
  left.appendChild(nameSpan);
  left.appendChild(badge);
  row.appendChild(left);
  if (rightText) {
    const right = document.createElement('span');
    right.className = 'file-size';
    right.textContent = rightText;
    row.appendChild(right);
  }
  return row;
}

function render(m, tNames) {
  const list = document.getElementById('fileList');
  const btn = document.getElementById('btnDl');
  list.replaceChildren();
  if (!m || !(m.glbSize > 0)) {
    btn.disabled = true;
    return;
  }
  list.appendChild(fileRow(
    'box', `${m.modelName || 'model'}.glb`, 'badge-glb', 'GLB',
    `${(m.glbSize / 1024 / 1024).toFixed(1)} MB`
  ));
  for (const name of tNames || []) {
    const ext = String(name).split('.').pop().toUpperCase();
    list.appendChild(fileRow('image', name, 'badge-tex', ext || 'IMG'));
  }
  btn.disabled = false;
}

async function refresh() {
  const tr = t();
  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || !isMeshyUrl(tab.url)) {
      currentTabId = null;
      meta = null;
      texNames = [];
      setStatus('idle', tr.notOnMeshy);
      render(null, []);
      return;
    }
    currentTabId = tab.id;

    const data = await readFromPageIDB(tab.id);
    meta = sanitizeMeta(data.meta);
    texNames = sanitizeTexNames(data.texNames);

    if (meta?.status === 'ready' && meta.glbSize > 0) {
      if (meta.possiblyEdited) {
        setStatus('waiting', tr.possiblyEdited);
        document.getElementById('hint').textContent = tr.editedHint;
      } else {
        setStatus('ready', tr.ready);
        document.getElementById('hint').textContent = tr.readyHint(texNames.length);
      }
      render(meta, texNames);
    } else {
      setStatus('waiting', tr.waitingModel);
      document.getElementById('hint').textContent = tr.waitingHint;
      render(null, []);
    }
  } catch (e) {
    setStatus('error', tr.error + String(e?.message || e).slice(0, 40));
  }
}

// ── Téléchargement : exécuté dans la page, mais avec validation ─────────────
// - magic 'glTF' obligatoire pour le modèle
// - hash SHA-256 vérifié contre celui calculé à la capture (intégrité)
// - noms de fichiers assainis, object URLs révoqués
// - __meshyDLSkipBlob : nos propres téléchargements ne doivent pas être
//   re-capturés comme textures par le patch URL.createObjectURL de content.js
async function downloadAll() {
  if (!currentTabId || !meta) return;
  const btn = document.getElementById('btnDl');
  btn.disabled = true;
  setBtn(btn, 'loader', t().downloading);
  try {
    await api.scripting.executeScript({
      target: { tabId: currentTabId },
      world: 'MAIN',
      func: async (modelName, tNames, glbHash, texHashes) => {
        async function sha256(buf) {
          const h = await crypto.subtle.digest('SHA-256', buf);
          return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
        }
        function safeName(n) {
          const c = String(n ?? '').replace(/[^\w\-. ]/g, '_').trim().slice(0, 100);
          return c || 'file';
        }
        function mimeOf(n) {
          const e = String(n).split('.').pop().toLowerCase();
          return { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif' }[e] || 'image/png';
        }
        function dl(buf, name, mime) {
          window.__meshyDLSkipBlob = true;
          const url = URL.createObjectURL(new Blob([buf], { type: mime }));
          const a = Object.assign(document.createElement('a'), { href: url, download: name });
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 5000);
        }
        const db = await new Promise((res, rej) => {
          const r = indexedDB.open('meshy_dl', 3);
          r.onupgradeneeded = e => {
            const d = e.target.result;
            if (!d.objectStoreNames.contains('files')) d.createObjectStore('files');
          };
          r.onsuccess = e => res(e.target.result);
          r.onerror = () => rej(r.error);
        });
        const tx = db.transaction('files', 'readonly');
        const s = tx.objectStore('files');
        const get = key => new Promise((res, rej) => {
          const req = s.get(key);
          req.onsuccess = e => res(e.target.result);
          req.onerror = () => rej(req.error);
        });

        const glb = await get('glb');
        if (glb instanceof ArrayBuffer && glb.byteLength >= 4 &&
            String.fromCharCode(...new Uint8Array(glb, 0, 4)) === 'glTF' &&
            (!glbHash || (await sha256(glb)) === glbHash)) {
          dl(glb, safeName(modelName) + '.glb', 'model/gltf-binary');
        }
        for (const name of tNames) {
          const buf = await get('tex_' + name);
          const expected = texHashes?.[name];
          if (buf instanceof ArrayBuffer && buf.byteLength > 0 &&
              (!expected || (await sha256(buf)) === expected)) {
            dl(buf, safeName(name), mimeOf(name));
          }
        }
      },
      args: [meta.modelName || 'model', texNames, meta.glbHash, meta.texHashes]
    });
    setBtn(btn, 'check', t().downloaded);
  } catch (e) {
    setBtn(btn, 'x', t().errorBtn);
  } finally {
    setTimeout(() => {
      btn.disabled = false;
      setBtn(btn, 'download', t().download);
    }, 2000);
  }
}

async function tryLiveCapture() {
  if (!currentTabId) return;
  const btn = document.getElementById('btnLive');
  btn.disabled = true;
  setBtn(btn, 'loader', t().liveBusy);
  try {
    const results = await api.scripting.executeScript({
      target: { tabId: currentTabId },
      world: 'MAIN',
      func: () => window.__meshyDLTryLiveCapture ? window.__meshyDLTryLiveCapture() : Promise.resolve(false)
    });
    const ok = results?.[0]?.result;
    setBtn(btn, ok ? 'check' : 'x', ok ? t().liveOk : t().liveFail);
  } catch (e) {
    setBtn(btn, 'x', t().errorBtn);
  }
  setTimeout(refresh, 800);
  setTimeout(() => { btn.disabled = false; setBtn(btn, 'sparkles', t().live); }, 2500);
}

document.getElementById('btnDl').addEventListener('click', downloadAll);
document.getElementById('btnLive').addEventListener('click', tryLiveCapture);

applyLanguage();
refresh();
setInterval(refresh, 2500);

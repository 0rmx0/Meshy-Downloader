let currentTabId = null;
let meta = null;
let texNames = [];

const DB_NAME = 'meshy_dl';
const DB_VERSION = 3;

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
  const results = await chrome.scripting.executeScript({
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
  const nameSpan = document.createElement('span');
  nameSpan.textContent = `${icon} ${name} `;
  const badge = document.createElement('span');
  badge.className = `badge ${badgeClass}`;
  badge.textContent = badgeText;
  left.appendChild(nameSpan);
  left.appendChild(badge);
  row.appendChild(left);
  if (rightText) {
    const right = document.createElement('span');
    right.style.color = '#8b949e';
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
    '📄', `${m.modelName || 'model'}.glb`, 'badge-glb', 'GLB',
    `${(m.glbSize / 1024 / 1024).toFixed(1)} MB`
  ));
  for (const name of tNames || []) {
    const ext = String(name).split('.').pop().toUpperCase();
    list.appendChild(fileRow('🖼️', name, 'badge-tex', ext || 'IMG'));
  }
  btn.disabled = false;
}

async function refresh() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || !isMeshyUrl(tab.url)) {
      currentTabId = null;
      meta = null;
      texNames = [];
      setStatus('idle', 'Pas sur une page Meshy');
      render(null, []);
      return;
    }
    currentTabId = tab.id;

    const data = await readFromPageIDB(tab.id);
    meta = sanitizeMeta(data.meta);
    texNames = sanitizeTexNames(data.texNames);

    if (meta?.status === 'ready' && meta.glbSize > 0) {
      if (meta.possiblyEdited) {
        setStatus('waiting', 'Modèle capturé, mais peut-être périmé ⚠️');
        document.getElementById('hint').textContent =
          '⚠️ Une interaction a été détectée depuis la dernière capture (ajout de base, changement de matériau...). Le téléchargement classique renverra la dernière version interceptée, pas forcément ce que tu vois à l\'écran. Essaie "Capturer la scène actuelle" ci-dessous.';
      } else {
        setStatus('ready', 'Modèle intercepté ✅');
        document.getElementById('hint').textContent = `${texNames.length} texture(s) interceptée(s).`;
      }
      render(meta, texNames);
    } else {
      setStatus('waiting', 'En attente du modèle...');
      document.getElementById('hint').textContent =
        '💡 Laisse la visionneuse 3D charger le modèle complètement.';
      render(null, []);
    }
  } catch (e) {
    setStatus('error', 'Erreur: ' + String(e?.message || e).slice(0, 40));
  }
}

// ── Téléchargement : exécuté dans la page, mais avec validation ─────────────
// - magic 'glTF' obligatoire pour le modèle
// - hash SHA-256 vérifié contre celui calculé à la capture (intégrité)
// - noms de fichiers assainis, object URLs révoqués
async function downloadAll() {
  if (!currentTabId || !meta) return;
  const btn = document.getElementById('btnDl');
  btn.disabled = true;
  btn.textContent = '⏳ ...';
  try {
    await chrome.scripting.executeScript({
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
          return { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }[e] || 'image/png';
        }
        function dl(buf, name, mime) {
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
    btn.textContent = '✅ Téléchargé !';
  } catch (e) {
    btn.textContent = '❌ Erreur';
  } finally {
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = '⬇️ Tout télécharger';
    }, 2000);
  }
}

async function tryLiveCapture() {
  if (!currentTabId) return;
  const btn = document.getElementById('btnLive');
  btn.disabled = true;
  btn.textContent = '⏳ Capture en cours...';
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: currentTabId },
      world: 'MAIN',
      func: () => window.__meshyDLTryLiveCapture ? window.__meshyDLTryLiveCapture() : Promise.resolve(false)
    });
    const ok = results?.[0]?.result;
    btn.textContent = ok ? '✅ Scène capturée !' : '❌ Échec (voir console)';
  } catch (e) {
    btn.textContent = '❌ Erreur';
  }
  setTimeout(refresh, 800);
  setTimeout(() => { btn.disabled = false; btn.textContent = '🧪 Capturer la scène actuelle'; }, 2500);
}

document.getElementById('btnDl').addEventListener('click', downloadAll);
document.getElementById('btnLive').addEventListener('click', tryLiveCapture);

refresh();
setInterval(refresh, 2500);

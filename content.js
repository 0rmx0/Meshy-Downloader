// WORLD: MAIN — s'exécute dans le contexte de la page, accès direct à window
// run_at: document_start — avant tout JS de la page
(function() {
  'use strict';

  const state = { glb: null, textures: [], modelName: '', status: 'idle' };
  const buttonText = {
    fr: { waiting: '⏳ Pas encore prêt...', download: 'Télécharger' },
    en: { waiting: '⏳ Not ready yet...', download: 'Download' }
  };
  let language = localStorage.getItem('__meshyDLLanguage') === 'en' ? 'en' : 'fr';

  // ── Patch Worker ────────────────────────────────────────────────────────────
  // On intercepte new Worker('/resource/decrypt/loader-worker.min.js')
  const _Worker = window.Worker;

  class PatchedWorker extends _Worker {
    constructor(url, opts) {
      super(url, opts);
      const urlStr = (typeof url === 'string') ? url : String(url);
      if (!urlStr.includes('loader-worker')) return;

      console.log('[Meshy DL] 🎯 Decrypt worker détecté :', urlStr);

      // Intercepte onmessage via defineProperty
      let _handler = null;
      const self = this;

      Object.defineProperty(this, 'onmessage', {
        get() { return _handler; },
        set(fn) {
          _handler = function(ev) {
            tryIntercept(ev.data);
            return fn.call(self, ev);
          };
          // Appelle le setter natif de Worker
          _Worker.prototype.__defineGetter__ && null;
          Object.getOwnPropertyDescriptor(_Worker.prototype, 'onmessage')?.set?.call(self, _handler);
        },
        configurable: true
      });

      // Intercepte aussi addEventListener
      const origAEL = this.addEventListener.bind(this);
      this.addEventListener = function(type, fn, opts) {
        if (type === 'message') {
          return origAEL(type, function(ev) {
            tryIntercept(ev.data);
            return fn.call(this, ev);
          }, opts);
        }
        return origAEL(type, fn, opts);
      };
    }
  }

  window.Worker = PatchedWorker;

  // ── Intercept message data ──────────────────────────────────────────────────
  function buffersAreEqual(a, b) {
    if (!a || !b || a.byteLength !== b.byteLength) return false;
    const u1 = new Uint8Array(a);
    const u2 = new Uint8Array(b);
    for (let i = 0; i < u1.length; i++) {
      if (u1[i] !== u2[i]) return false;
    }
    return true;
  }

  function tryIntercept(data) {
    if (!data || data.type !== 'process' || !data.success) return;
    const buf = data.data;
    if (!buf || buf.byteLength < 4) return;

    const magic = String.fromCharCode(...new Uint8Array(buf, 0, 4));
    if (magic !== 'glTF') {
      console.log('[Meshy DL] Message process reçu mais magic =', magic);
      return;
    }

    const newGlb = buf.slice(0);
    if (state.glb && buffersAreEqual(state.glb, newGlb)) return;

    if (state.glb) {
      console.log('[Meshy DL] 🔄 Nouveau modèle détecté, reset textures');
      state.textures = [];
    }

    state.glb = newGlb;
    state.modelName = getModelName();
    state.status = 'ready';
    console.log('[Meshy DL] ✅ GLB intercepté !', (buf.byteLength/1024/1024).toFixed(2), 'MB');

    saveToIDB().then(() => {
      updateBtn();
      window.dispatchEvent(new CustomEvent('__meshyDLReady'));
    });
  }

  function storeTexture(name, buf) {
    if (state.textures.some(t => t.name === name)) return;
    state.textures.push({ name, buf: buf.slice(0) });
    console.log('[Meshy DL] 🖼️ Texture:', name, (buf.byteLength/1024).toFixed(0), 'KB');
    saveToIDB();
  }

  // Capture PNG blobs before the viewer exposes them as blob: URLs.
  const _createObjectURL = URL.createObjectURL;
  URL.createObjectURL = function(object) {
    const url = _createObjectURL.call(this, object);
    if (object instanceof Blob && object.type.toLowerCase() === 'image/png') {
      object.arrayBuffer().then(buf => {
        let index = 1;
        let name = `texture_${index}.png`;
        while (state.textures.some(t => t.name === name)) {
          name = `texture_${++index}.png`;
        }
        storeTexture(name, buf);
      }).catch(() => {});
    }
    return url;
  };

  // ── Patch fetch pour les textures ──────────────────────────────────────────
  const _fetch = window.fetch;
  window.fetch = async function(...args) {
    const resp = await _fetch.apply(this, args);
    const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');

    if (url.includes('assets.meshy.ai') && url.includes('.png')) {
      resp.clone().arrayBuffer().then(buf => {
        const name = url.split('/').pop().split('?')[0];
        storeTexture(name, buf);
      }).catch(() => {});
    }
    return resp;
  };

  // ── Helpers ────────────────────────────────────────────────────────────────
  function getModelName() {
    const h1 = document.querySelector('h1');
    if (h1?.textContent) return h1.textContent.trim().replace(/[^\w\-. ]/g, '_').trim() || 'model';
    return document.title.split('|')[0].trim().replace(/[^\w\-. ]/g, '_') || 'model';
  }

  // ── IndexedDB ──────────────────────────────────────────────────────────────
  let _db = null;
  function openDB() {
    return new Promise((res, rej) => {
      if (_db) { res(_db); return; }
      const r = indexedDB.open('meshy_dl', 3);
      r.onupgradeneeded = e => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains('files')) d.createObjectStore('files');
      };
      r.onsuccess = e => { _db = e.target.result; res(_db); };
      r.onerror = rej;
    });
  }

  async function saveToIDB() {
    const db = await openDB();
    const tx = db.transaction('files', 'readwrite');
    const s = tx.objectStore('files');
    if (state.glb)       s.put(state.glb, 'glb');
    if (state.modelName) s.put(state.modelName, 'modelName');
    s.put(state.textures.map(t => t.name), 'texNames');
    for (const tex of state.textures) s.put(tex.buf, 'tex_' + tex.name);
    s.put({ status: state.status, glbSize: state.glb?.byteLength || 0, texCount: state.textures.length, modelName: state.modelName }, 'meta');
    return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
  }

  function loadButtonPosition() {
    try {
      const saved = localStorage.getItem('__meshyDLBtnPos');
      if (!saved) return null;
      const pos = JSON.parse(saved);
      if (typeof pos.left !== 'number' || typeof pos.top !== 'number') return null;
      return pos;
    } catch (e) {
      return null;
    }
  }

  function saveButtonPosition(pos) {
    try {
      localStorage.setItem('__meshyDLBtnPos', JSON.stringify(pos));
    } catch (e) {}
  }

  // ── Bouton flottant ────────────────────────────────────────────────────────
  function injectBtn() {
    if (document.getElementById('__meshyDLBtn')) return;
    const btn = document.createElement('div');
    btn.id = '__meshyDLBtn';
    btn.textContent = '⏳ Meshy DL';
    btn.style.cssText = `
      position:fixed;z-index:2147483647;
      background:#333;color:#fff;font:bold 13px monospace;
      padding:10px 16px;border-radius:8px;cursor:grab;
      box-shadow:0 4px 20px rgba(0,0,0,.5);transition:background .2s,border .2s;
      border:2px solid #555;user-select:none;touch-action:none;
    `;

    const savedPos = loadButtonPosition();
    if (savedPos) {
      btn.style.left = savedPos.left + 'px';
      btn.style.top = savedPos.top + 'px';
    } else {
      btn.style.right = '20px';
      btn.style.bottom = '20px';
    }

    let dragStart = null;
    let origin = null;

    btn.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      btn.setPointerCapture(event.pointerId);
      btn.style.cursor = 'grabbing';
      btn.style.transition = 'none';

      const rect = btn.getBoundingClientRect();
      origin = { x: rect.left, y: rect.top };
      dragStart = { x: event.clientX, y: event.clientY };
    });

    btn.addEventListener('pointermove', event => {
      if (!dragStart) return;
      event.preventDefault();
      const dx = event.clientX - dragStart.x;
      const dy = event.clientY - dragStart.y;
      const left = Math.max(0, Math.min(window.innerWidth - btn.offsetWidth, origin.x + dx));
      const top = Math.max(0, Math.min(window.innerHeight - btn.offsetHeight, origin.y + dy));
      btn.style.left = left + 'px';
      btn.style.top = top + 'px';
      btn.style.right = 'auto';
      btn.style.bottom = 'auto';
    });

    btn.addEventListener('pointerup', event => {
      if (!dragStart) return;
      event.preventDefault();
      btn.releasePointerCapture(event.pointerId);
      btn.style.cursor = 'grab';
      btn.style.transition = 'background .2s,border .2s';
      dragStart = null;
      origin = null;
      saveButtonPosition({ left: btn.offsetLeft, top: btn.offsetTop });
    });

    btn.addEventListener('pointercancel', () => {
      if (!dragStart) return;
      btn.style.cursor = 'grab';
      btn.style.transition = 'background .2s,border .2s';
      dragStart = null;
      origin = null;
      saveButtonPosition({ left: btn.offsetLeft, top: btn.offsetTop });
    });

    btn.onclick = event => {
      if (dragStart) return;
      if (state.status !== 'ready') {
        btn.textContent = buttonText[language].waiting;
        return;
      }
      downloadAll();
    };

    window.addEventListener('__meshyDLReady', () => {
      updateBtn();
    });

    document.body?.appendChild(btn);
  }

  function downloadAll() {
    if (state.glb) dl(state.glb, state.modelName + '.glb', 'model/gltf-binary');
    state.textures.forEach((t, i) =>
      setTimeout(() => dl(t.buf, t.name, 'image/png'), 300 * (i + 1))
    );
  }

  function dl(buf, name, mime) {
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([buf], { type: mime })),
      download: name
    });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  function updateBtn() {
    const btn = document.getElementById('__meshyDLBtn');
    if (btn) {
      const texInfo = state.textures.length > 0 ? ` + ${state.textures.length} tex` : '';
      btn.textContent = `⬇️ GLB${texInfo} — ${buttonText[language].download}`;
      btn.style.background = '#1f6feb';
      btn.style.border = '2px solid #58a6ff';
    }
  }

  window.addEventListener('__meshyDLLanguageChanged', event => {
    if (event.detail !== 'fr' && event.detail !== 'en') {
      return;
    } 
    language = event.detail;
    try {
      localStorage.setItem('__meshyDLLanguage', language);
    } catch (e) {}
    
    const btn = document.getElementById('__meshyDLBtn');
    if (state.status === 'ready') {
      updateBtn();
    } else if (btn) {
      btn.textContent = buttonText[language].waiting;
    }
  });

  // Attend que le body soit dispo
  if (document.body) injectBtn();
  else new MutationObserver((_, obs) => {
    if (document.body) { injectBtn(); obs.disconnect(); }
  }).observe(document.documentElement, { childList: true });

  console.log('[Meshy DL] ✅ Extension chargée (MAIN world, document_start)');
})();

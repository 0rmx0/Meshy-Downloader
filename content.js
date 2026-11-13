// WORLD: MAIN — s'exécute dans le contexte de la page, accès direct à window
// run_at: document_start — avant tout JS de la page
(function() {
  'use strict';

  const state = { glb: null, glbHash: null, textures: [], texHashes: {}, modelName: '', status: 'idle', possiblyEdited: false, lastCaptureAt: 0 };

  // ── Patch Worker ────────────────────────────────────────────────────────────
  // Historiquement on ne patchait que new Worker('/resource/decrypt/loader-worker.min.js').
  // Mais certains flux (ex: édition à la volée dans le workspace / ajout de base pour
  // l'impression) peuvent passer par un Worker différent, voire par aucun Worker du tout.
  // On élargit donc l'interception à TOUS les Workers créés par la page, et on ne filtre
  // plus que sur le contenu des messages (signature glTF), pas sur le nom du script.
  const _Worker = window.Worker;

  class PatchedWorker extends _Worker {
    constructor(url, opts) {
      super(url, opts);
      const urlStr = (typeof url === 'string') ? url : String(url);
      console.log('[Meshy DL] 👀 Worker créé, on le surveille :', urlStr);

      // Intercepte onmessage via defineProperty
      let _handler = null;
      const self = this;

      Object.defineProperty(this, 'onmessage', {
        get() { return _handler; },
        set(fn) {
          _handler = function(ev) {
            tryIntercept(ev.data, urlStr).catch(() => {});
            return fn.call(self, ev);
          };
          Object.getOwnPropertyDescriptor(_Worker.prototype, 'onmessage')?.set?.call(self, _handler);
        },
        configurable: true
      });

      // Intercepte aussi addEventListener
      const origAEL = this.addEventListener.bind(this);
      this.addEventListener = function(type, fn, opts) {
        if (type === 'message') {
          return origAEL(type, function(ev) {
            tryIntercept(ev.data, urlStr).catch(() => {});
            return fn.call(this, ev);
          }, opts);
        }
        return origAEL(type, fn, opts);
      };
    }
  }

  window.Worker = PatchedWorker;

  // ── Intercept message data ──────────────────────────────────────────────────
  async function sha256(buf) {
    const h = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function tryIntercept(data, workerUrl) {
    // On ne filtre plus sur data.type === 'process' : ce champ est spécifique au
    // worker de déchiffrement original, un autre worker (édition/print) pourrait
    // structurer son message différemment. On cherche directement un ArrayBuffer
    // avec la signature glTF, où qu'il se trouve dans le message.
    const buf = findGlbBuffer(data);
    if (!buf || buf.byteLength < 4) return;

    const newGlb = buf.slice(0);
    // Comparaison par hash (SHA-256) plutôt qu'octet par octet : O(n) en natif
    // au lieu d'une boucle JS de dizaines de millions d'itérations.
    const newHash = await sha256(newGlb);
    if (state.glbHash && state.glbHash === newHash) return;

    if (state.glb) {
      console.log('[Meshy DL] 🔄 Nouveau modèle détecté (worker:', workerUrl, '), reset textures');
      state.textures = [];
      state.texHashes = {};
    }

    state.glb = newGlb;
    state.glbHash = newHash;
    state.modelName = getModelName();
    state.status = 'ready';
    state.possiblyEdited = false;
    state.lastCaptureAt = Date.now();
    console.log('[Meshy DL] ✅ GLB intercepté ! (', workerUrl, ')', (buf.byteLength/1024/1024).toFixed(2), 'MB');

    saveToIDB().then(() => {
      updateBtn();
      window.dispatchEvent(new CustomEvent('__meshyDLReady'));
    }).catch(e => console.warn('[Meshy DL] ⚠️ saveToIDB a échoué :', e));
  }

  // Cherche un ArrayBuffer avec la signature 'glTF' dans un message worker,
  // qu'il soit directement le payload (data.data), le message lui-même (data),
  // ou niché dans un objet imbriqué à un niveau (ex: {result: {buffer}}).
  function hasGlbMagic(buf) {
    if (!(buf instanceof ArrayBuffer) || buf.byteLength < 4) return false;
    return String.fromCharCode(...new Uint8Array(buf, 0, 4)) === 'glTF';
  }

  function findGlbBuffer(data) {
    if (!data) return null;
    if (hasGlbMagic(data)) return data; // message = ArrayBuffer directement
    if (data instanceof ArrayBuffer) return null;
    if (typeof data !== 'object') return null;

    if (hasGlbMagic(data.data)) return data.data;
    if (hasGlbMagic(data.buffer)) return data.buffer;
    if (hasGlbMagic(data.result)) return data.result;

    for (const key of Object.keys(data)) {
      const v = data[key];
      if (hasGlbMagic(v)) return v;
      if (v && typeof v === 'object' && !(v instanceof ArrayBuffer)) {
        for (const k2 of Object.keys(v)) {
          if (hasGlbMagic(v[k2])) return v[k2];
        }
      }
    }
    return null;
  }

  // ── Détection "possiblement périmé" ─────────────────────────────────────────
  // Une fois un modèle capturé, toute interaction de l'utilisateur avec la page
  // (clic sur "ajouter une base", changement de matériau, etc.) peut modifier le
  // modèle affiché SANS repasser par le worker de déchiffrement (ex: manipulation
  // de géométrie 100% locale en WebGL). On ne peut pas savoir avec certitude que
  // l'utilisateur a édité le modèle, mais on peut au moins l'avertir que le fichier
  // qu'il s'apprête à télécharger correspond à la DERNIÈRE capture, pas forcément
  // à ce qu'il voit à l'écran.
  document.addEventListener('pointerdown', event => {
    if (state.status !== 'ready') return;
    if (event.target.closest && event.target.closest('#__meshyDLBtn')) return;
    if (!state.possiblyEdited) {
      state.possiblyEdited = true;
      console.log('[Meshy DL] ⚠️ Interaction détectée après capture — le modèle affiché a peut-être changé.');
      saveToIDB().catch(() => {});
      updateBtn();
    }
  }, true);

  // ── Fallback expérimental : capturer la scène 3D visible directement ───────
  // Ne dépend plus du worker de déchiffrement : tente de trouver un renderer
  // Three.js exposé par la page et d'exporter la scène TELLE QU'AFFICHÉE (donc
  // avec les éditions locales, base ajoutée, matériau changé, etc.) via
  // THREE.GLTFExporter. C'est spéculatif — ça dépend de ce que la page expose
  // sur `window` ou sur le canvas — donc ça échoue proprement si indisponible.
  function findThreeRenderer() {
    // Certaines apps exposent leur instance three.js pour les devtools
    if (window.__THREE_DEVTOOLS__?.renderers?.size) {
      for (const r of window.__THREE_DEVTOOLS__.renderers) return r;
    }
    // Sinon on fouille les canvas du DOM : certains frameworks accrochent
    // le renderer ou la scène directement sur l'élément canvas.
    for (const canvas of document.querySelectorAll('canvas')) {
      for (const key of Object.keys(canvas)) {
        if (key.startsWith('__') || key.startsWith('_three') || key.startsWith('_reactFiber')) {
          const v = canvas[key];
          if (v?.isWebGLRenderer) return v;
        }
      }
    }
    return null;
  }

  window.__meshyDLTryLiveCapture = async function() {
    try {
      const THREE = window.THREE;
      if (!THREE?.GLTFExporter) {
        console.warn('[Meshy DL] ❌ Capture live impossible : THREE.GLTFExporter non exposé sur window.');
        console.warn('[Meshy DL] 👉 Ouvre les DevTools sur cette page, inspecte les objets globaux/React DevTools pour trouver comment accéder à la scène, puis adapte findThreeRenderer().');
        return false;
      }
      const renderer = findThreeRenderer();
      const scene = renderer?.__meshyScene || window.__meshyDLScene || null;
      if (!scene) {
        console.warn('[Meshy DL] ❌ Renderer trouvé mais pas de scène exploitable. Il faut identifier manuellement la référence de la scène active.');
        return false;
      }
      const exporter = new THREE.GLTFExporter();
      const glb = await new Promise((resolve, reject) => {
        exporter.parse(scene, resolve, reject, { binary: true });
      });
      const buf = glb instanceof ArrayBuffer ? glb : new TextEncoder().encode(JSON.stringify(glb)).buffer;
      state.glb = buf;
      state.glbHash = await sha256(buf);
      state.modelName = getModelName() + '_edited';
      state.status = 'ready';
      state.possiblyEdited = false;
      state.lastCaptureAt = Date.now();
      await saveToIDB();
      updateBtn();
      window.dispatchEvent(new CustomEvent('__meshyDLReady'));
      console.log('[Meshy DL] ✅ Scène capturée en direct (expérimental).');
      return true;
    } catch (e) {
      console.warn('[Meshy DL] ❌ Échec capture live :', e);
      return false;
    }
  };

  // ── Patch fetch pour les textures ──────────────────────────────────────────
  const _fetch = window.fetch;
  const TEX_EXT = { png: true, jpg: true, jpeg: true, webp: true };
  window.fetch = async function(...args) {
    const resp = await _fetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
      const u = new URL(url, location.href);
      const ext = u.pathname.split('.').pop().toLowerCase();
      if ((u.hostname === 'meshy.ai' || u.hostname.endsWith('.meshy.ai')) && TEX_EXT[ext]) {
        resp.clone().arrayBuffer().then(async buf => {
          const name = sanitizeFileName(u.pathname.split('/').pop());
          if (!name || state.textures.find(t => t.name === name)) return;
          state.texHashes[name] = await sha256(buf);
          state.textures.push({ name, buf: buf.slice(0), mime: 'image/' + (ext === 'jpg' ? 'jpeg' : ext) });
          console.log('[Meshy DL] 🖼️ Texture:', name, (buf.byteLength/1024).toFixed(0), 'KB');
          saveToIDB().catch(() => {});
        }).catch(() => {});
      }
    } catch {}
    return resp;
  };

  // ── Helpers ────────────────────────────────────────────────────────────────
  function sanitizeFileName(name) {
    return String(name ?? '').replace(/[^\w\-. ]/g, '_').trim().slice(0, 100);
  }

  function getModelName() {
    const h1 = document.querySelector('h1');
    if (h1?.textContent) return sanitizeFileName(h1.textContent) || 'model';
    return sanitizeFileName(document.title.split('|')[0]) || 'model';
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
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error('Ouverture IndexedDB bloquée'));
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
    s.put({
      status: state.status,
      glbSize: state.glb?.byteLength || 0,
      texCount: state.textures.length,
      modelName: state.modelName,
      possiblyEdited: state.possiblyEdited,
      glbHash: state.glbHash,
      texHashes: state.texHashes
    }, 'meta');
    return new Promise((res, rej) => {
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error);
    });
  }

  function loadButtonPosition() {
    try {
      const saved = localStorage.getItem('__meshyDLBtnPos');
      if (!saved) return null;
      const pos = JSON.parse(saved);
      if (!pos || !Number.isFinite(pos.left) || !Number.isFinite(pos.top)) return null;
      // Bornes : on reste dans le viewport (marge 60x40px pour la taille du bouton)
      return {
        left: Math.max(0, Math.min(window.innerWidth - 60, pos.left)),
        top: Math.max(0, Math.min(window.innerHeight - 40, pos.top))
      };
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
    let dragged = false;

    btn.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      btn.setPointerCapture(event.pointerId);
      btn.style.cursor = 'grabbing';
      btn.style.transition = 'none';

      const rect = btn.getBoundingClientRect();
      origin = { x: rect.left, y: rect.top };
      dragStart = { x: event.clientX, y: event.clientY };
      dragged = false;
    });

    btn.addEventListener('pointermove', event => {
      if (!dragStart) return;
      event.preventDefault();
      const dx = event.clientX - dragStart.x;
      const dy = event.clientY - dragStart.y;
      if (Math.abs(dx) + Math.abs(dy) > 5) dragged = true; // seuil : vrai drag, pas un clic
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
      // Le click fire APRÈS pointerup : on garde `dragged` pour que onclick le consomme
    });

    btn.addEventListener('pointercancel', () => {
      if (!dragStart) return;
      btn.style.cursor = 'grab';
      btn.style.transition = 'background .2s,border .2s';
      dragStart = null;
      origin = null;
      dragged = false;
      saveButtonPosition({ left: btn.offsetLeft, top: btn.offsetTop });
    });

    btn.onclick = event => {
      if (dragged) { dragged = false; return; } // drag = déplacement, pas un clic
      if (state.status !== 'ready') {
        btn.textContent = '⏳ Pas encore prêt...';
        return;
      }
      downloadAll();
    };

    window.addEventListener('__meshyDLReady', updateBtn);

    document.body?.appendChild(btn);
  }

  function downloadAll() {
    if (state.glb) dl(state.glb, state.modelName + '.glb', 'model/gltf-binary');
    state.textures.forEach((t, i) =>
      setTimeout(() => dl(t.buf, t.name, t.mime || 'image/png'), 300 * (i + 1))
    );
  }

  function dl(buf, name, mime) {
    const url = URL.createObjectURL(new Blob([buf], { type: mime }));
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: sanitizeFileName(name)
    });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function updateBtn() {
    const btn = document.getElementById('__meshyDLBtn');
    if (!btn || state.status !== 'ready') return;
    const texInfo = state.textures.length > 0 ? ` + ${state.textures.length} tex` : '';
    if (state.possiblyEdited) {
      btn.textContent = `⚠️ GLB${texInfo} — peut être périmé`;
      btn.style.background = '#7d4e00';
      btn.style.border = '2px solid #d29922';
      btn.title = 'Le modèle a peut-être été modifié depuis cette capture (ajout de base, matériau...). Le fichier téléchargé correspondra à la dernière capture, pas forcément à ce que tu vois à l\'écran.';
    } else {
      btn.textContent = `⬇️ GLB${texInfo} — Télécharger`;
      btn.style.background = '#1f6feb';
      btn.style.border = '2px solid #58a6ff';
      btn.title = '';
    }
  }

  // Attend que le body soit dispo
  if (document.body) injectBtn();
  else new MutationObserver((_, obs) => {
    if (document.body) { injectBtn(); obs.disconnect(); }
  }).observe(document.documentElement, { childList: true });

  console.log('[Meshy DL] ✅ Extension chargée (MAIN world, document_start)');
})();

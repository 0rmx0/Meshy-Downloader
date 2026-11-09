let currentTabId = null;
let meta = null;
let texNames = [];

async function readFromPageIDB(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => new Promise(resolve => {
      const r = indexedDB.open('meshy_dl', 3);
      r.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
      };
      r.onsuccess = e => {
        const db = e.target.result;
        const tx = db.transaction('files', 'readonly');
        const s = tx.objectStore('files');
        const out = {};
        const gets = [
          s.get('meta').onsuccess = ev => out.meta = ev.target.result,
          s.get('texNames').onsuccess = ev => out.texNames = ev.target.result || [],
        ];
        tx.oncomplete = () => resolve(out);
        tx.onerror = () => resolve({});
      };
      r.onerror = () => resolve({});
    })
  });
  return results?.[0]?.result || {};
}

function setStatus(type, text) {
  document.getElementById('dot').className = 'dot dot-' + type;
  document.getElementById('statusText').textContent = text;
}

function render(m, tNames) {
  const list = document.getElementById('fileList');
  list.innerHTML = '';
  if (!m || m.glbSize === 0) return;

  list.innerHTML += `<div class="file-row">
    <span>📄 ${m.modelName || 'model'}.glb <span class="badge badge-glb">GLB</span></span>
    <span style="color:#8b949e">${(m.glbSize/1024/1024).toFixed(1)} MB</span>
  </div>`;

  (tNames || []).forEach(name => {
    list.innerHTML += `<div class="file-row">
      <span>🖼️ ${name} <span class="badge badge-tex">PNG</span></span>
    </div>`;
  });

  document.getElementById('btnDl').disabled = false;
}

async function refresh() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.includes('meshy.ai')) {
      setStatus('idle', 'Pas sur une page Meshy');
      return;
    }
    currentTabId = tab.id;

    const data = await readFromPageIDB(tab.id);
    meta = data.meta;
    texNames = data.texNames || [];

    if (meta?.status === 'ready' && meta.glbSize > 0) {
      setStatus('ready', 'Modèle intercepté ✅');
      render(meta, texNames);
      document.getElementById('hint').textContent = `${texNames.length} texture(s) interceptée(s).`;
    } else {
      setStatus('waiting', 'En attente du modèle...');
      document.getElementById('hint').textContent =
        '💡 Laisse la visionneuse 3D charger le modèle complètement.';
    }
  } catch(e) {
    setStatus('error', 'Erreur: ' + e.message.slice(0, 40));
  }
}

window.downloadAll = async function() {
  if (!currentTabId || !meta) return;
  document.getElementById('btnDl').disabled = true;
  document.getElementById('btnDl').textContent = '⏳ ...';

  await chrome.scripting.executeScript({
    target: { tabId: currentTabId },
    world: 'MAIN',
    func: async (modelName, tNames) => {
      function dl(buf, name, mime) {
        const a = Object.assign(document.createElement('a'), {
          href: URL.createObjectURL(new Blob([buf], { type: mime })),
          download: name
        });
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
      }
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open('meshy_dl', 3);
        r.onupgradeneeded = e => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
        };
        r.onsuccess = e => res(e.target.result);
        r.onerror = rej;
      });
      const tx = db.transaction('files', 'readonly');
      const s = tx.objectStore('files');
      s.get('glb').onsuccess = e => { if (e.target.result) dl(e.target.result, modelName + '.glb', 'model/gltf-binary'); };
      tNames.forEach((name, i) => {
        s.get('tex_' + name).onsuccess = e => {
          if (e.target.result) setTimeout(() => dl(e.target.result, name, 'image/png'), 400*(i+1));
        };
      });
    },
    args: [meta.modelName || 'model', texNames]
  });

  document.getElementById('btnDl').textContent = '✅ Téléchargé !';
  setTimeout(() => {
    document.getElementById('btnDl').disabled = false;
    document.getElementById('btnDl').textContent = '⬇️ Tout télécharger';
  }, 2000);
};

refresh();
setInterval(refresh, 2500);

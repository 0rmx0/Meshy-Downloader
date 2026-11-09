let currentTabId = null;
let meta = null;
let texNames = [];
let language = localStorage.getItem('meshyDownloaderLanguage') === 'en' ? 'en' : 'fr';

const translations = {
  fr: {
    intro: 'Ouvre une page de modèle Meshy pour activer le téléchargement.',
    waiting: 'En attente...',
    notOnMeshy: 'Pas sur une page Meshy',
    ready: 'Modèle intercepté ✅',
    waitingModel: 'En attente du modèle...',
    error: 'Erreur : ',
    readyHint: count => `${count} texture(s) interceptée(s).`,
    waitingHint: '💡 Laisse la visionneuse 3D charger le modèle complètement.',
    download: '⬇️ Tout télécharger',
    downloaded: '✅ Téléchargé !'
  },
  en: {
    intro: 'Open a Meshy model page to enable downloads.',
    waiting: 'Waiting...',
    notOnMeshy: 'Not on a Meshy page',
    ready: 'Model captured ✅',
    waitingModel: 'Waiting for the model...',
    error: 'Error: ',
    readyHint: count => `${count} texture(s) captured.`,
    waitingHint: '💡 Let the 3D viewer finish loading the model.',
    download: '⬇️ Download all',
    downloaded: '✅ Downloaded!'
  }
};

function applyLanguage() {
  const text = translations[language];
  document.documentElement.lang = language;
  document.getElementById('languageSelect').value = language;
  document.getElementById('languageSelect').setAttribute('aria-label', language === 'fr' ? 'Langue' : 'Language');
  document.getElementById('intro').textContent = text.intro;
  document.getElementById('hint').textContent = text.waitingHint;
  document.getElementById('btnDl').textContent = text.download;
  document.getElementById('statusText').textContent = text.waiting;
}

document.getElementById('languageSelect').addEventListener('change', event => {
  language = event.target.value;
  localStorage.setItem('meshyDownloaderLanguage', language);
  applyLanguage();
  syncLanguageToPage();
  refresh();
});

async function syncLanguageToPage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url?.includes('meshy.ai')) {
      return;
    }
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: selectedLanguage => {
        try {
          localStorage.setItem('__meshyDLLanguage', selectedLanguage);
        } catch (e) {}
        window.dispatchEvent(new CustomEvent('__meshyDLLanguageChanged', { detail: selectedLanguage }));
      },
      args: [language]
    });
  } catch (e) {}
}

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
      setStatus('idle', translations[language].notOnMeshy);
      return;
    }
    currentTabId = tab.id;

    const data = await readFromPageIDB(tab.id);
    meta = data.meta;
    texNames = data.texNames || [];

    if (meta?.status === 'ready' && meta.glbSize > 0) {
      setStatus('ready', translations[language].ready);
      render(meta, texNames);
      document.getElementById('hint').textContent = translations[language].readyHint(texNames.length);
    } else {
      setStatus('waiting', translations[language].waitingModel);
      document.getElementById('hint').textContent = translations[language].waitingHint;
    }
  } catch(e) {
    setStatus('error', translations[language].error + e.message.slice(0, 40));
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

  document.getElementById('btnDl').textContent = translations[language].downloaded;
  setTimeout(() => {
    document.getElementById('btnDl').disabled = false;
    document.getElementById('btnDl').textContent = translations[language].download;
  }, 2000);
};

applyLanguage();
syncLanguageToPage();
refresh();
setInterval(refresh, 2500);

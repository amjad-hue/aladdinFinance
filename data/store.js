const fs   = require('fs');
const path = require('path');

const USE_FIRESTORE = process.env.NODE_ENV === 'production' || process.env.USE_FIRESTORE === 'true';
const DATA_DIR      = path.join(__dirname, '..', 'store');

// ── Firestore setup (production only) ────────────────────────────────────────
let _db = null;
function _getDb() {
  if (!_db) {
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        // Service account key file path set as env var (local use / migrate script)
        const serviceAccount = require(process.env.GOOGLE_APPLICATION_CREDENTIALS);
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
      } else {
        // Firebase Functions environment — auto-credentials
        admin.initializeApp();
      }
    }
    _db = admin.firestore();
  }
  return _db;
}

// ── In-memory cache (Firestore mode) ─────────────────────────────────────────
const _cache  = new Map();
let _ready    = false;
let _readyP   = null;

// Call once on server startup — loads all Firestore documents into _cache
async function init() {
  if (!USE_FIRESTORE) { _ready = true; return; }
  if (_ready) return;
  if (_readyP) return _readyP;
  _readyP = (async () => {
    try {
      const snap = await _getDb().collection('store').get();
      snap.forEach(doc => _cache.set(doc.id, doc.data().data));
      console.log(`[store] Firestore cache warm — ${_cache.size} key(s) loaded`);
    } catch (e) {
      console.error('[store] Firestore init error:', e.message);
    }
    _ready = true;
  })();
  return _readyP;
}

// ── load ──────────────────────────────────────────────────────────────────────
function load(filename, defaultValue) {
  const key = filename.replace(/\.json$/, '');

  if (!USE_FIRESTORE) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const fp = path.join(DATA_DIR, filename);
    try {
      if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf-8'));
    } catch (e) {
      console.warn(`[store] load ${filename} failed:`, e.message);
    }
    save(filename, defaultValue);
    return defaultValue;
  }

  // Firestore mode — read from in-memory cache
  if (_cache.has(key)) return JSON.parse(JSON.stringify(_cache.get(key)));
  // Key not yet in cache — store default and queue async write
  const def = JSON.parse(JSON.stringify(defaultValue));
  _cache.set(key, def);
  _getDb().collection('store').doc(key).set({ data: def })
    .catch(e => console.warn(`[store] init-default ${key}:`, e.message));
  return def;
}

// ── save ──────────────────────────────────────────────────────────────────────
function save(filename, data) {
  const key = filename.replace(/\.json$/, '');

  if (!USE_FIRESTORE) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2));
    return;
  }

  // Firestore mode — update cache immediately, persist async
  _cache.set(key, data);
  _getDb().collection('store').doc(key).set({ data })
    .catch(e => console.error(`[store] save ${key} failed:`, e.message));
}

module.exports = { load, save, init };

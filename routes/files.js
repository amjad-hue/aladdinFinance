const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { load, save } = require('../data/store');
const { seed } = require('../data/seed');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename:    (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// ── Google Drive helpers ──────────────────────────────────────────────────────
function getDriveAuth() {
  const { google } = require('googleapis');
  const tokens = load('gcal_tokens.json', null);
  if (!tokens?.refresh_token) return null;
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return null;
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/events/gcal/callback'
  );
  oauth2.setCredentials(tokens);
  oauth2.on('tokens', updated => save('gcal_tokens.json', { ...tokens, ...updated }));
  return oauth2;
}

function getDrive() {
  const auth = getDriveAuth();
  if (!auth) return null;
  const { google } = require('googleapis');
  return google.drive({ version: 'v3', auth });
}

function isDriveReady() {
  const tokens = load('gcal_tokens.json', null);
  if (!tokens?.refresh_token) return false;
  if (!process.env.GOOGLE_DRIVE_FOLDER_ID) return false;
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return false;
  // Tokens must include drive scope (added after re-auth with Drive scope)
  const scope = tokens.scope || '';
  return scope.includes('drive');
}

const FOLDER_ID = () => process.env.GOOGLE_DRIVE_FOLDER_ID;

async function uploadToDrive(localPath, name, mime) {
  const drive = getDrive();
  if (!drive || !FOLDER_ID()) return null;
  const { data } = await drive.files.create({
    requestBody: { name, parents: [FOLDER_ID()] },
    media: { mimeType: mime || 'application/octet-stream', body: fs.createReadStream(localPath) },
    fields: 'id,name,webViewLink,webContentLink'
  });
  return data;
}

async function deleteFromDrive(driveId) {
  const drive = getDrive();
  if (!drive || !driveId) return;
  await drive.files.delete({ fileId: driveId });
}

// ── Drive status ──────────────────────────────────────────────────────────────
router.get('/drive/status', (req, res) => {
  const tokens   = load('gcal_tokens.json', null);
  const hasToken = !!tokens?.refresh_token;
  const hasDriveScope = hasToken && (tokens.scope || '').includes('drive');
  const hasFolderId   = !!process.env.GOOGLE_DRIVE_FOLDER_ID;
  res.json({
    connected:   hasDriveScope && hasFolderId,
    needsAuth:   !hasToken,
    needsReauth: hasToken && !hasDriveScope,   // has calendar token but missing drive scope
    folderId:    process.env.GOOGLE_DRIVE_FOLDER_ID || null,
    reAuthUrl:   '/api/events/gcal/auth'
  });
});

// ── Sync files from Drive folder into local list ──────────────────────────────
router.post('/drive/sync', async (req, res) => {
  if (!isDriveReady()) {
    return res.status(400).json({ error: 'Google Drive not connected. Connect Google Calendar first (same credentials).' });
  }
  const drive = getDrive();
  try {
    const result = await drive.files.list({
      q: `'${FOLDER_ID()}' in parents and trashed=false`,
      fields: 'files(id,name,mimeType,size,createdTime,webViewLink)',
      orderBy: 'createdTime desc',
      pageSize: 200
    });
    const driveFiles = result.data.files || [];
    const localFiles = load('files.json', seed().files);
    const existingDriveIds = new Set(localFiles.map(f => f.driveId).filter(Boolean));

    let imported = 0;
    for (const df of driveFiles) {
      if (existingDriveIds.has(df.id)) continue;
      const ext = (df.name.split('.').pop() || '').toLowerCase();
      const cat = ext === 'pdf' ? 'p' : ['xlsx', 'xls', 'csv'].includes(ext) ? 'x' : 'd';
      localFiles.unshift({
        id: Date.now() + Math.floor(Math.random() * 9999),
        name: df.name,
        type: 'report',
        cat,
        size: df.size ? (Number(df.size) / 1024).toFixed(1) + ' KB' : '—',
        date: new Date(df.createdTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        drive: true,
        driveId: df.id,
        webViewLink: df.webViewLink,
        storedAs: null
      });
      imported++;
    }
    save('files.json', localFiles);
    res.json({ ok: true, imported, total: driveFiles.length, message: `Synced ${imported} new file${imported !== 1 ? 's' : ''} from Google Drive` });
  } catch (e) {
    console.error('Drive sync error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── List all files ────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  res.json(load('files.json', seed().files));
});

// ── Upload (local + Drive if connected) ──────────────────────────────────────
router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const ext = (req.file.originalname.split('.').pop() || '').toLowerCase();
  const cat = ext === 'pdf' ? 'p' : ['xlsx', 'xls', 'csv'].includes(ext) ? 'x' : 'd';
  const file = {
    id: Date.now(),
    name: req.file.originalname,
    type: req.body.type || 'report',
    cat,
    size: (req.file.size / 1024).toFixed(1) + ' KB',
    date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    drive: false,
    storedAs: req.file.filename,
    driveId: null,
    webViewLink: null
  };

  if (isDriveReady()) {
    try {
      const driveData = await uploadToDrive(
        path.join(UPLOAD_DIR, req.file.filename),
        req.file.originalname,
        req.file.mimetype
      );
      if (driveData) {
        file.drive = true;
        file.driveId = driveData.id;
        file.webViewLink = driveData.webViewLink;
      }
    } catch (e) {
      console.warn('Drive upload failed (saved locally):', e.message);
    }
  }

  const files = load('files.json', seed().files);
  files.unshift(file);
  save('files.json', files);
  res.json({ success: true, file });
});

// ── Download (Drive stream if available, else local) ──────────────────────────
router.get('/:id/download', async (req, res) => {
  const id = Number(req.params.id);
  const files = load('files.json', seed().files);
  const file = files.find(f => f.id === id);
  if (!file) return res.status(404).json({ error: 'File not found' });

  if (file.driveId && isDriveReady()) {
    try {
      const drive = getDrive();
      const driveRes = await drive.files.get(
        { fileId: file.driveId, alt: 'media' },
        { responseType: 'stream' }
      );
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.name)}"`);
      res.setHeader('Content-Type', 'application/octet-stream');
      driveRes.data.pipe(res);
      return;
    } catch (e) {
      console.warn('Drive download failed, trying local:', e.message);
    }
  }

  if (!file.storedAs) return res.status(404).json({ error: 'File not stored locally' });
  const localPath = path.join(UPLOAD_DIR, file.storedAs);
  if (!fs.existsSync(localPath)) return res.status(404).json({ error: 'Local file missing' });
  res.download(localPath, file.name);
});

// ── Update metadata ───────────────────────────────────────────────────────────
router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const files = load('files.json', seed().files);
  const i = files.findIndex(f => f.id === id);
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  files[i] = { ...files[i], ...req.body, id: files[i].id };
  save('files.json', files);
  res.json({ file: files[i] });
});

// ── Delete (Drive + local) ────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  let files = load('files.json', seed().files);
  const file = files.find(f => f.id === id);

  if (file?.driveId && isDriveReady()) {
    try { await deleteFromDrive(file.driveId); } catch (e) { console.warn('Drive delete failed:', e.message); }
  }
  if (file?.storedAs) {
    const p = path.join(UPLOAD_DIR, file.storedAs);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  files = files.filter(f => f.id !== id);
  save('files.json', files);
  res.json({ success: true });
});

module.exports = router;

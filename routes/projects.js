const router  = require('express').Router();
const multer  = require('multer');
const fs      = require('fs');
const path    = require('path');
const { load, save } = require('../data/store');
const { seed } = require('../data/seed');
const crypto  = require('crypto');

const UPLOAD_DIR = process.env.NODE_ENV === 'production'
  ? '/tmp/uploads'
  : path.join(__dirname, '..', 'uploads');
try { if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (_) {}
const _upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ── Drive helper (reuses same OAuth tokens as calendar) ───────────────────────
function getDriveClient() {
  const { google } = require('googleapis');
  const tokens = load('gcal_tokens.json', null);
  if (!tokens?.refresh_token) return null;
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return null;
  const scope = tokens.scope || '';
  if (!scope.includes('drive')) return null;
  if (!process.env.GOOGLE_DRIVE_EXPENSES_FOLDER_ID && !process.env.GOOGLE_DRIVE_FOLDER_ID) return null;
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || (process.env.APP_URL ? `${process.env.APP_URL}/api/events/gcal/callback` : `http://localhost:${process.env.PORT || 3000}/api/events/gcal/callback`)
  );
  oauth2.setCredentials(tokens);
  oauth2.on('tokens', updated => save('gcal_tokens.json', { ...tokens, ...updated }));
  return google.drive({ version: 'v3', auth: oauth2 });
}

function get() { return load('projects.json', seed().projects); }
function set(d) { save('projects.json', d); }

router.get('/', (req, res) => res.json(get()));

router.post('/', (req, res) => {
  const items = get();
  const item = {
    id: Date.now(),
    name: req.body.name || 'New Project',
    client: req.body.client || '',
    status: req.body.status || 'active',
    type: req.body.type || 'implementation',
    startDate: req.body.startDate || new Date().toISOString().split('T')[0],
    endDate: req.body.endDate || '',
    budget: Number(req.body.budget) || 0,
    actualSpend: Number(req.body.actualSpend) || 0,
    linkedRevenue: Number(req.body.linkedRevenue) || 0,
    linkedBudgetCats: req.body.linkedBudgetCats || [],
    manager: req.body.manager || '',
    description: req.body.description || '',
    milestones: req.body.milestones || [],
    notes: req.body.notes || ''
  };
  items.push(item);
  set(items);
  res.json({ item });
});

router.put('/:id', (req, res) => {
  const items = get();
  const i = items.findIndex(x => x.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  items[i] = { ...items[i], ...req.body, id: items[i].id };
  set(items);

  // Sync project budget to financials when budgetItems are saved
  if (req.body.budgetItems !== undefined) {
    try {
      const { MONTHS, DEFAULT_YEAR } = require('../lib/constants');
      const budFile = DEFAULT_YEAR === 2026 ? 'budget.json' : `budget-${DEFAULT_YEAR}.json`;
      const budget = load(budFile, []);
      const project = items[i];
      const totalUsd = (req.body.budgetItems || []).reduce((s, b) => s + (b.amountUsd || 0), 0);
      const catName = `Project: ${project.name}`;
      let catIdx = budget.findIndex(b => b.projectId === project.id);

      if (totalUsd === 0 && catIdx !== -1) {
        budget.splice(catIdx, 1);
      } else if (totalUsd > 0) {
        const startMo = project.startDate ? new Date(project.startDate).getMonth() : 0;
        const endMo   = project.endDate   ? new Date(project.endDate).getMonth()   : 11;
        const projMonths = MONTHS.slice(startMo, Math.min(endMo + 1, 12));
        const perMonth = projMonths.length ? Math.round(totalUsd / projMonths.length) : 0;

        if (catIdx === -1) {
          const newCat = { id: Date.now(), cat: catName, annual: totalUsd, source: 'project', projectId: project.id, note: '', months: {} };
          MONTHS.forEach(m => { newCat.months[m] = { target: projMonths.includes(m) ? perMonth : 0, actual: 0, details: [] }; });
          budget.push(newCat);
        } else {
          budget[catIdx].cat    = catName;
          budget[catIdx].annual = totalUsd;
          budget[catIdx].source = 'project';
          MONTHS.forEach(m => {
            if (!budget[catIdx].months[m]) budget[catIdx].months[m] = { target: 0, actual: 0, details: [] };
            budget[catIdx].months[m].target = projMonths.includes(m) ? perMonth : 0;
          });
        }
        save(budFile, budget);
      }
    } catch (e) {
      console.warn('[projects] budget sync error:', e.message);
    }
  }

  res.json({ item: items[i] });
});

router.delete('/:id', (req, res) => {
  set(get().filter(x => x.id !== Number(req.params.id)));
  res.json({ ok: true });
});

router.post('/:id/milestone', (req, res) => {
  const items = get();
  const i = items.findIndex(x => x.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  if (!items[i].milestones) items[i].milestones = [];
  const ms = { id: Date.now(), title: req.body.title, dueDate: req.body.dueDate, done: false };
  items[i].milestones.push(ms);
  set(items);
  res.json({ milestone: ms });
});

router.patch('/:id/milestone/:mid', (req, res) => {
  const items = get();
  const i = items.findIndex(x => x.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  const ms = (items[i].milestones || []).find(m => m.id === Number(req.params.mid));
  if (ms) Object.assign(ms, req.body);
  set(items);
  res.json({ ok: true });
});

// ── Petty Cash Token ──────────────────────────────────────────────────────────
router.get('/:id/petty-token', (req, res) => {
  const items = get();
  const i = items.findIndex(x => x.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  if (!items[i].pettyToken) { items[i].pettyToken = crypto.randomBytes(20).toString('hex'); set(items); }
  res.json({ token: items[i].pettyToken });
});

router.post('/:id/regenerate-petty-token', (req, res) => {
  const items = get();
  const i = items.findIndex(x => x.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  items[i].pettyToken = crypto.randomBytes(20).toString('hex');
  set(items);
  res.json({ token: items[i].pettyToken });
});

// ── Expense approve / reject ──────────────────────────────────────────────────
router.put('/:id/expenses/:eid/approve', (req, res) => {
  const items = get();
  const i = items.findIndex(x => x.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  const exp = (items[i].expenses || []).find(e => e.id === Number(req.params.eid));
  if (!exp) return res.status(404).json({ error: 'Expense not found' });
  exp.status = 'approved'; exp.approvedAt = new Date().toISOString();
  items[i].actualSpend = (items[i].expenses || []).filter(e => e.status !== 'rejected').reduce((a, e) => a + e.amount, 0);
  set(items);
  res.json({ ok: true });
});

router.put('/:id/expenses/:eid/reject', (req, res) => {
  const items = get();
  const i = items.findIndex(x => x.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  const exp = (items[i].expenses || []).find(e => e.id === Number(req.params.eid));
  if (!exp) return res.status(404).json({ error: 'Expense not found' });
  exp.status = 'rejected'; exp.rejectedAt = new Date().toISOString();
  items[i].actualSpend = (items[i].expenses || []).filter(e => e.status !== 'rejected').reduce((a, e) => a + e.amount, 0);
  set(items);
  res.json({ ok: true });
});

// ── Edit individual expense ───────────────────────────────────────────────────
router.put('/:id/expenses/:eid', (req, res) => {
  const items = get();
  const i = items.findIndex(x => x.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  const ei = (items[i].expenses || []).findIndex(e => e.id === Number(req.params.eid));
  if (ei === -1) return res.status(404).json({ error: 'Expense not found' });
  const allowed = ['from','who','amount','note','paymentMethod','date','attachment','attachmentName','attachmentMime'];
  allowed.forEach(k => { if (req.body[k] !== undefined) items[i].expenses[ei][k] = req.body[k]; });
  if (req.body.amount !== undefined) {
    items[i].actualSpend = (items[i].expenses || []).filter(e => e.status !== 'rejected').reduce((a,e) => a + e.amount, 0);
  }
  set(items);
  res.json({ ok: true, expense: items[i].expenses[ei] });
});

// ── Public Petty Cash handlers (registered in server.js before auth) ──────────
const pettyFormHandler = (req, res) => {
  const items = get();
  const p = items.find(x => x.pettyToken === req.params.token);
  if (!p) return res.status(404).json({ error: 'Invalid or expired link' });
  res.json({ projectName: p.name, projectClient: p.client });
};

const pettySubmitHandler = (req, res) => {
  const items = get();
  const i = items.findIndex(x => x.pettyToken === req.params.token);
  if (i === -1) return res.status(404).json({ error: 'Invalid or expired link' });
  const { description, amount, who, note, paymentMethod, driveId, webViewLink, localFile, attachmentName, attachmentMime } = req.body;
  if (!description?.trim() || !amount) return res.status(400).json({ error: 'Description and amount are required' });
  if (!items[i].expenses) items[i].expenses = [];
  const exp = {
    id: Date.now(), from: description.trim(), who: (who||'').trim(),
    amount: Number(String(amount).replace(/[^0-9.]/g,''))||0,
    date: new Date().toISOString().split('T')[0],
    note: (note||'').trim(),
    paymentMethod: paymentMethod || 'petty_cash',
    driveId:        driveId || null,
    webViewLink:    webViewLink || null,
    localFile:      localFile || null,
    attachmentName: attachmentName || null,
    attachmentMime: attachmentMime || null,
    status: 'pending',
    submittedAt: new Date().toISOString()
  };
  items[i].expenses.push(exp);
  set(items);
  res.json({ ok: true });
};

// ── Public: Upload attachment to Drive (or local fallback) ────────────────────
const _pettyUploadInner = async (req, res) => {
  try {
    const items = get();
    const p = items.find(x => x.pettyToken === req.params.token);
    if (!p) return res.status(404).json({ error: 'Invalid link' });
    if (!req.file) return res.status(400).json({ error: 'No file received' });

    const drive = getDriveClient();
    if (drive) {
      try {
        const { Readable } = require('stream');
        const stream = Readable.from(req.file.buffer);
        // Priority: project's own Drive folder → env expenses folder → env main folder
        const projectFolderId = p.expenseDriveUrl
          ? (p.expenseDriveUrl.match(/folders\/([a-zA-Z0-9_-]+)/)?.[1] || null)
          : null;
        const folderId = projectFolderId
          || process.env.GOOGLE_DRIVE_EXPENSES_FOLDER_ID
          || process.env.GOOGLE_DRIVE_FOLDER_ID;
        const safeName = `[${p.name}] ${Date.now()}-${req.file.originalname}`;
        const { data } = await drive.files.create({
          requestBody: { name: safeName, parents: [folderId] },
          media: { mimeType: req.file.mimetype, body: stream },
          fields: 'id,name,webViewLink,webContentLink'
        });
        return res.json({
          ok: true,
          via: 'drive',
          driveId:     data.id,
          webViewLink: data.webViewLink,
          fileName:    req.file.originalname,
          size:        req.file.size
        });
      } catch (e) {
        console.warn('Drive upload failed, using local fallback:', e.message);
      }
    }

    // Local fallback
    const fname = Date.now() + '-' + req.file.originalname;
    fs.writeFileSync(path.join(UPLOAD_DIR, fname), req.file.buffer);
    return res.json({
      ok: true,
      via: 'local',
      localFile: fname,
      fileName:  req.file.originalname,
      size:      req.file.size
    });
  } catch (err) {
    console.error('pettyUpload error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Upload failed: ' + err.message });
  }
};

const pettyUploadHandler = [_upload.single('file'), _pettyUploadInner];

module.exports = router;
module.exports.pettyFormHandler   = pettyFormHandler;
module.exports.pettySubmitHandler = pettySubmitHandler;
module.exports.pettyUploadHandler = pettyUploadHandler;

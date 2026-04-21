const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { load, save } = require('../data/store');
const { seed } = require('../data/seed');

const TMP = path.join(__dirname, '../uploads/tmp');
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });
const upload = multer({ dest: TMP });

function get() { return load('cashflow.json', seed().cashflow); }
function set(d) { save('cashflow.json', d); }

router.get('/', (req, res) => res.json(get()));

router.put('/', (req, res) => {
  const data = req.body.cashflow || req.body;
  if (!Array.isArray(data)) return res.status(400).json({ error: 'cashflow array required' });
  set(data);
  res.json({ ok: true });
});

router.post('/upload-excel', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const XLSX = require('xlsx');
    const wb = XLSX.readFile(req.file.path);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: 0 });
    const current = get();
    rows.forEach(row => {
      const month = String(row['Month'] || row['month'] || '').trim();
      if (!month) return;
      const existing = current.find(r => r.month.toLowerCase() === month.toLowerCase());
      if (existing) {
        if (row['Inflow'] !== undefined) existing.inflow = Number(row['Inflow']) || existing.inflow;
        if (row['Outflow'] !== undefined) existing.outflow = Number(row['Outflow']) || existing.outflow;
        if (row['Opening'] || row['Opening Balance']) existing.opening = Number(row['Opening'] || row['Opening Balance']) || existing.opening;
      }
    });
    set(current);
    fs.unlinkSync(req.file.path);
    res.json({ ok: true, imported: rows.length });
  } catch (e) {
    if (req.file?.path) try { fs.unlinkSync(req.file.path); } catch {}
    res.status(400).json({ error: 'Invalid Excel file: ' + e.message });
  }
});

router.post('/sync', (req, res) => {
  res.json({ ok: true, source: 'QuickBooks', cashflow: get(), syncedAt: new Date().toISOString() });
});

module.exports = router;

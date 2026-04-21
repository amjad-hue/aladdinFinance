const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { load, save } = require('../data/store');
const { seed } = require('../data/seed');

const TMP = path.join(__dirname, '../uploads/tmp');
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });
const upload = multer({ dest: TMP });

function get() { return load('budget.json', seed().budget); }
function set(d) { save('budget.json', d); }

const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

router.get('/', (req, res) => res.json(get()));

router.post('/', (req, res) => {
  const items = get();
  const annual = Number(req.body.annual) || 0;
  const item = { id: Date.now(), cat: req.body.cat || 'New Category', annual, note: req.body.note || '', months: {} };
  MO.forEach(m => { item.months[m] = { target: Math.round(annual / 12), actual: 0, details: [] }; });
  items.push(item);
  set(items);
  res.json({ item });
});

router.put('/', (req, res) => {
  save('budget.json', req.body.budget || req.body);
  res.json({ ok: true });
});

router.put('/:id', (req, res) => {
  const items = get();
  const i = items.findIndex(b => b.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  const annual = req.body.annual !== undefined ? Number(req.body.annual) : items[i].annual;
  items[i] = { ...items[i], ...req.body, id: items[i].id, annual };
  if (req.body.annual !== undefined) {
    MO.forEach(m => { if (items[i].months[m]) items[i].months[m].target = Math.round(annual / 12); });
  }
  set(items);
  res.json({ item: items[i] });
});

router.delete('/:id', (req, res) => {
  set(get().filter(b => b.id !== Number(req.params.id)));
  res.json({ ok: true });
});

router.put('/:id/month/:month', (req, res) => {
  const items = get();
  const i = items.findIndex(b => b.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  const m = req.params.month;
  if (!items[i].months[m]) items[i].months[m] = { target: 0, actual: 0, details: [] };
  items[i].months[m] = { ...items[i].months[m], ...req.body };
  set(items);
  res.json({ ok: true, month: items[i].months[m] });
});

router.post('/:id/month/:month/detail', (req, res) => {
  const items = get();
  const i = items.findIndex(b => b.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  const m = req.params.month;
  if (!items[i].months[m]) items[i].months[m] = { target: 0, actual: 0, details: [] };
  if (!Array.isArray(items[i].months[m].details)) items[i].months[m].details = [];
  const detail = { id: Date.now(), vendor: req.body.vendor || '', amount: Number(req.body.amount) || 0, date: req.body.date || '', note: req.body.note || '' };
  items[i].months[m].details.push(detail);
  set(items);
  res.json({ detail });
});

router.delete('/:id/month/:month/detail/:did', (req, res) => {
  const items = get();
  const i = items.findIndex(b => b.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  const m = req.params.month;
  if (items[i].months[m]?.details) {
    items[i].months[m].details = items[i].months[m].details.filter(d => d.id !== Number(req.params.did));
  }
  set(items);
  res.json({ ok: true });
});

router.post('/upload-excel', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const XLSX = require('xlsx');
    const wb = XLSX.readFile(req.file.path);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: 0 });
    const items = get();
    rows.forEach(row => {
      const cat = String(row['Category'] || row['category'] || '').trim();
      if (!cat) return;
      let item = items.find(b => b.cat.toLowerCase() === cat.toLowerCase());
      if (!item) {
        item = { id: Date.now() + Math.random(), cat, annual: 0, note: '', months: {} };
        MO.forEach(m => { item.months[m] = { target: 0, actual: 0, details: [] }; });
        items.push(item);
      }
      const ann = row['Annual'] || row['annual'];
      if (ann) item.annual = Number(ann) || item.annual;
      MO.forEach(m => {
        const v = row[m] || row[m.toLowerCase()];
        if (v !== undefined && v !== 0) {
          if (!item.months[m]) item.months[m] = { target: Math.round(item.annual / 12), actual: 0, details: [] };
          item.months[m].actual = Number(v) || 0;
        }
      });
    });
    set(items);
    fs.unlinkSync(req.file.path);
    res.json({ ok: true, imported: rows.length });
  } catch (e) {
    if (req.file?.path) try { fs.unlinkSync(req.file.path); } catch {}
    res.status(400).json({ error: 'Invalid Excel file: ' + e.message });
  }
});

router.post('/sync', (req, res) => {
  res.json({ ok: true, message: 'QuickBooks budget sync — add credentials to .env to enable live data' });
});

module.exports = router;

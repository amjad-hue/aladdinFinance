const router = require('express').Router();
const XLSX   = require('xlsx');
const { requireRole }            = require('../middleware/roles');
const { load, save }             = require('../data/store');
const { seed }                   = require('../data/seed');
const { MONTHS, DEFAULT_YEAR }   = require('../lib/constants');
const { excelUpload, removeTmp } = require('../lib/upload');

function yearFile(y) { return y === DEFAULT_YEAR ? 'budget.json' : `budget-${y}.json`; }

function get(y = DEFAULT_YEAR) {
  return load(yearFile(y), seed().budget.map(b => ({
    ...b,
    annual: 0,
    months: Object.fromEntries(
      Object.entries(b.months || {}).map(([m]) => [m, { target: 0, actual: 0, details: [] }])
    ),
  })));
}

function set(d, y = DEFAULT_YEAR) { save(yearFile(y), d); }

const yr = req => Number(req.query.year) || DEFAULT_YEAR;

router.get('/', (req, res) => res.json(get(yr(req))));

router.post('/', requireRole('finance'), (req, res) => {
  const y      = yr(req);
  const items  = get(y);
  const annual = Number(req.body.annual) || 0;
  const item   = {
    id: Date.now(),
    cat: req.body.cat || 'New Category',
    annual,
    note: req.body.note || '',
    months: {},
  };
  MONTHS.forEach(m => { item.months[m] = { target: Math.round(annual / 12), actual: 0, details: [] }; });
  items.push(item);
  set(items, y);
  res.json({ item });
});

router.put('/', requireRole('finance'), (req, res) => {
  const y = yr(req);
  save(yearFile(y), req.body.budget || req.body);
  res.json({ ok: true });
});

router.put('/:id', requireRole('finance'), (req, res) => {
  const y      = yr(req);
  const items  = get(y);
  const i      = items.findIndex(b => b.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  const annual = req.body.annual !== undefined ? Number(req.body.annual) : items[i].annual;
  items[i]     = { ...items[i], ...req.body, id: items[i].id, annual };
  if (req.body.annual !== undefined) {
    MONTHS.forEach(m => { if (items[i].months[m]) items[i].months[m].target = Math.round(annual / 12); });
  }
  set(items, y);
  res.json({ item: items[i] });
});

router.delete('/:id', requireRole('finance'), (req, res) => {
  const y = yr(req);
  set(get(y).filter(b => b.id !== Number(req.params.id)), y);
  res.json({ ok: true });
});

router.put('/:id/month/:month', requireRole('finance'), (req, res) => {
  const y     = yr(req);
  const items = get(y);
  const i     = items.findIndex(b => b.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  const m = req.params.month;
  if (!items[i].months[m]) items[i].months[m] = { target: 0, actual: 0, details: [] };
  items[i].months[m] = { ...items[i].months[m], ...req.body };
  set(items, y);
  res.json({ ok: true, month: items[i].months[m] });
});

router.post('/:id/month/:month/detail', requireRole('finance'), (req, res) => {
  const y     = yr(req);
  const items = get(y);
  const i     = items.findIndex(b => b.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  const m = req.params.month;
  if (!items[i].months[m])                     items[i].months[m] = { target: 0, actual: 0, details: [] };
  if (!Array.isArray(items[i].months[m].details)) items[i].months[m].details = [];
  const detail = {
    id:     Date.now(),
    vendor: req.body.vendor || '',
    amount: Number(req.body.amount) || 0,
    date:   req.body.date   || '',
    note:   req.body.note   || '',
  };
  items[i].months[m].details.push(detail);
  set(items, y);
  res.json({ detail });
});

router.delete('/:id/month/:month/detail/:did', requireRole('finance'), (req, res) => {
  const y     = yr(req);
  const items = get(y);
  const i     = items.findIndex(b => b.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  const m = req.params.month;
  if (items[i].months[m]?.details) {
    items[i].months[m].details = items[i].months[m].details.filter(d => d.id !== Number(req.params.did));
  }
  set(items, y);
  res.json({ ok: true });
});

router.get('/download-template', (req, res) => {
  const y     = yr(req);
  const items = get(y);

  const targetRows = items.length
    ? items.map(b => {
        const row = { 'Category (Account)': b.cat, 'Annual Target': b.annual || 0 };
        MONTHS.forEach(m => { row[`${m} Target`] = b.months?.[m]?.target || Math.round((b.annual || 0) / 12); });
        return row;
      })
    : [(() => {
        const row = { 'Category (Account)': 'e.g. Salaries & Wages', 'Annual Target': 600000 };
        MONTHS.forEach(m => { row[`${m} Target`] = 50000; });
        return row;
      })()];

  const actualRows = items.length
    ? items.map(b => {
        const row = { 'Category (Account)': b.cat, 'Annual Target': b.annual || 0 };
        MONTHS.forEach(m => { row[`${m} Actual`] = b.months?.[m]?.actual || 0; });
        return row;
      })
    : [(() => {
        const row = { 'Category (Account)': 'e.g. Salaries & Wages', 'Annual Target': 0 };
        MONTHS.forEach(m => { row[`${m} Actual`] = 0; });
        return row;
      })()];

  const instrRows = [
    { Instructions: `Budget Import Template — ${y}` },
    { Instructions: '' },
    { Instructions: 'Sheet "Budget Targets": Category (Account) | Annual Target | Jan Target … Dec Target' },
    { Instructions: 'Sheet "Budget Actuals": Category (Account) | Jan Actual … Dec Actual' },
    { Instructions: 'New category names will create new accounts.' },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(targetRows), 'Budget Targets');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(actualRows), 'Budget Actuals');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(instrRows),  'Instructions');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', `attachment; filename="budget-template-${y}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

router.post('/upload-excel', excelUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const wb    = XLSX.readFile(req.file.path);
    const y     = yr(req);
    const items = get(y);
    let imported = 0;

    function findOrCreate(cat) {
      let item = items.find(b => b.cat.toLowerCase() === cat.toLowerCase());
      if (!item) {
        item = { id: Date.now() + Math.random(), cat, annual: 0, note: '', months: {} };
        MONTHS.forEach(m => { item.months[m] = { target: 0, actual: 0, details: [] }; });
        items.push(item);
      }
      MONTHS.forEach(m => { if (!item.months[m]) item.months[m] = { target: 0, actual: 0, details: [] }; });
      return item;
    }

    const targetSheetName = wb.SheetNames.find(n => /target/i.test(n)) || wb.SheetNames[0];
    const targetRows      = XLSX.utils.sheet_to_json(wb.Sheets[targetSheetName], { defval: '' });
    targetRows.forEach(row => {
      const cat = String(row['Category (Account)'] || row['Category'] || row['category'] || '').trim();
      if (!cat || cat.startsWith('e.g.')) return;
      const item = findOrCreate(cat);
      const ann  = row['Annual Target'] ?? row['Annual'] ?? row['annual'];
      if (ann !== '') item.annual = Number(ann) || item.annual;
      MONTHS.forEach(m => {
        const v = row[`${m} Target`] ?? row[m] ?? row[m.toLowerCase()];
        if (v !== '' && v !== undefined && Number(v) > 0) item.months[m].target = Number(v);
      });
      imported++;
    });

    const actualSheetName = wb.SheetNames.find(n => /actual/i.test(n));
    if (actualSheetName) {
      const actualRows = XLSX.utils.sheet_to_json(wb.Sheets[actualSheetName], { defval: '' });
      actualRows.forEach(row => {
        const cat = String(row['Category (Account)'] || row['Category'] || row['category'] || '').trim();
        if (!cat || cat.startsWith('e.g.')) return;
        const item = findOrCreate(cat);
        MONTHS.forEach(m => {
          const v = row[`${m} Actual`] ?? row[m] ?? row[m.toLowerCase()];
          if (v !== '' && v !== undefined && Number(v) > 0) item.months[m].actual = Number(v);
        });
      });
    }

    set(items, y);
    removeTmp(req.file.path);
    res.json({ ok: true, imported });
  } catch (e) {
    removeTmp(req.file?.path);
    res.status(400).json({ error: 'Invalid Excel file: ' + e.message });
  }
});

router.post('/sync', requireRole('finance'), (_req, res) => {
  res.json({ ok: true, message: 'QuickBooks budget sync — add credentials to .env to enable live data' });
});

module.exports = router;

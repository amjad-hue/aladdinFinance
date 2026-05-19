const router = require('express').Router();
const XLSX   = require('xlsx');
const { requireRole }                  = require('../middleware/roles');
const { load, save }                   = require('../data/store');
const { seed }                         = require('../data/seed');
const { DEFAULT_YEAR }                 = require('../lib/constants');
const { excelUpload, removeTmp, tmpPath } = require('../lib/upload');

function yearFile(y) { return y === DEFAULT_YEAR ? 'cashflow.json' : `cashflow-${y}.json`; }
function get(y = DEFAULT_YEAR) { return load(yearFile(y), seed().cashflow); }
function set(d, y = DEFAULT_YEAR) { save(yearFile(y), d); }

const yr = req => Number(req.query.year) || DEFAULT_YEAR;

router.get('/', (req, res) => res.json(get(yr(req))));

router.put('/', requireRole('finance'), (req, res) => {
  const data = req.body.cashflow || req.body;
  if (!Array.isArray(data)) return res.status(400).json({ error: 'cashflow array required' });
  set(data, yr(req));
  res.json({ ok: true });
});

router.get('/download-template', (req, res) => {
  const y       = yr(req);
  const current = get(y);

  const detailRows = [];
  current.forEach(r => {
    const details  = r.details || [];
    const inItems  = details.filter(d => d.type === 'inflow');
    const outItems = details.filter(d => d.type === 'outflow');
    if (inItems.length || outItems.length) {
      inItems.forEach(d  => detailRows.push({ Month: r.month, Type: 'Inflow',  Description: d.description, Amount: d.amount }));
      outItems.forEach(d => detailRows.push({ Month: r.month, Type: 'Outflow', Description: d.description, Amount: d.amount }));
    } else {
      detailRows.push({ Month: r.month, Type: 'Inflow',  Description: 'e.g. Client Payment', Amount: 0 });
      detailRows.push({ Month: r.month, Type: 'Outflow', Description: 'e.g. Payroll',         Amount: 0 });
    }
  });

  const summaryRows = current.map(r => ({
    Month:             r.month,
    'Opening Balance': r.opening,
    'Total Inflow':    r.inflow,
    'Total Outflow':   r.outflow,
    'Net Movement':    r.inflow - r.outflow,
    'Closing Balance': r.opening + r.inflow - r.outflow,
  }));

  const instrRows = [
    { Instructions: `Cash Flow Import Template — ${y}` },
    { Instructions: '' },
    { Instructions: 'Sheet "Detail Items": Month | Type (Inflow/Outflow) | Description | Amount' },
    { Instructions: 'Sheet "Monthly Summary" (optional): Opening Balance | Total Inflow | Total Outflow' },
    { Instructions: 'If both sheets are present, Detail Items take precedence.' },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detailRows),  'Detail Items');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'Monthly Summary');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(instrRows),   'Instructions');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', `attachment; filename="cashflow-template-${y}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

router.post('/preview-excel', excelUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const wb     = XLSX.readFile(req.file.path);
    const sheets = wb.SheetNames.map(name => {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '' });
      return { name, cols: rows.length ? Object.keys(rows[0]) : [], preview: rows.slice(0, 6) };
    });
    res.json({ tempId: req.file.filename, sheets });
  } catch (e) {
    removeTmp(req.file?.path);
    res.status(400).json({ error: 'Could not read file: ' + e.message });
  }
});

router.post('/upload-excel', (req, res, next) => {
  const ct = req.headers['content-type'] || '';
  if (ct.includes('multipart/form-data')) return excelUpload.single('file')(req, res, next);
  next();
}, (req, res) => {
  const tempId   = req.body?.tempId || req.query.tempId;
  const filePath = req.file?.path || (tempId ? tmpPath(tempId) : null);
  if (!filePath) return res.status(400).json({ error: 'No file uploaded' });

  const { existsSync } = require('fs');
  if (!existsSync(filePath)) return res.status(400).json({ error: 'Temp file expired or not found' });

  const sheetName = req.body?.sheet   || null;
  const monthCol  = req.body?.monthCol || 'Month';
  const typeCol   = req.body?.typeCol  || 'Type';
  const descCol   = req.body?.descCol  || 'Description';
  const amtCol    = req.body?.amtCol   || 'Amount';

  try {
    const wb      = XLSX.readFile(filePath);
    const y       = yr(req);
    const current = get(y);
    let imported  = 0;

    const chosenSheet = sheetName && wb.SheetNames.includes(sheetName)
      ? sheetName
      : wb.SheetNames.find(n => /detail/i.test(n)) || wb.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[chosenSheet], { defval: '' });

    const firstRow   = rows[0] || {};
    const isDetail   = typeCol in firstRow || 'Type' in firstRow || 'type' in firstRow
                    || descCol in firstRow || 'Description' in firstRow;

    if (isDetail) {
      const byMonth = {};
      rows.forEach(row => {
        const month   = String(row[monthCol] || row['Month'] || row['month'] || '').trim();
        const rawType = String(row[typeCol]  || row['Type']  || row['type']  || 'inflow').toLowerCase();
        const desc    = String(row[descCol]  || row['Description'] || row['description'] || '').trim();
        const amt     = Number(row[amtCol]   || row['Amount']      || row['amount'])     || 0;
        if (!month || !desc || !amt || desc.startsWith('e.g.')) return;
        const type = rawType.includes('out') ? 'outflow' : 'inflow';
        if (!byMonth[month]) byMonth[month] = [];
        byMonth[month].push({ id: Date.now() + Math.random(), description: desc, amount: amt, type });
        imported++;
      });
      Object.entries(byMonth).forEach(([month, items]) => {
        const r = current.find(x => x.month.toLowerCase() === month.toLowerCase());
        if (!r) return;
        r.details = items;
        const inSum  = items.filter(d => d.type === 'inflow').reduce((a, d)  => a + d.amount, 0);
        const outSum = items.filter(d => d.type === 'outflow').reduce((a, d) => a + d.amount, 0);
        if (inSum  > 0) r.inflow  = inSum;
        if (outSum > 0) r.outflow = outSum;
      });
    } else {
      rows.forEach(row => {
        const month = String(row[monthCol] || row['Month'] || row['month'] || '').trim();
        if (!month) return;
        const r = current.find(x => x.month.toLowerCase() === month.toLowerCase());
        if (!r) return;
        const openCol = 'Opening Balance' in row ? 'Opening Balance' : ('Opening' in row ? 'Opening' : null);
        const inCol   = 'Total Inflow'    in row ? 'Total Inflow'    : ('Inflow'  in row ? 'Inflow'  : amtCol);
        const outCol  = 'Total Outflow'   in row ? 'Total Outflow'   : ('Outflow' in row ? 'Outflow' : null);
        if (openCol && row[openCol] !== '') r.opening = Number(row[openCol]) || r.opening;
        if (inCol   && row[inCol]  !== '') r.inflow  = Number(row[inCol])   || r.inflow;
        if (outCol  && row[outCol] !== '') r.outflow = Number(row[outCol])  || r.outflow;
        imported++;
      });
    }

    set(current, y);
    removeTmp(filePath);
    res.json({ ok: true, imported });
  } catch (e) {
    removeTmp(filePath);
    res.status(400).json({ error: 'Invalid Excel file: ' + e.message });
  }
});

router.post('/sync', requireRole('finance'), (req, res) => {
  res.json({ ok: true, source: 'QuickBooks', cashflow: get(yr(req)), syncedAt: new Date().toISOString() });
});

module.exports = router;

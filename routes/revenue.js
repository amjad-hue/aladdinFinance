const router = require('express').Router();
const { requireRole }          = require('../middleware/roles');
const { load, save }           = require('../data/store');
const { seed }                 = require('../data/seed');
const { DEFAULT_YEAR }         = require('../lib/constants');

function yearFile(y)     { return y === DEFAULT_YEAR ? 'revenue.json'      : `revenue-${y}.json`; }
function yearTypeFile(y) { return y === DEFAULT_YEAR ? 'revenue-type.json' : `revenue-type-${y}.json`; }

function get(y = DEFAULT_YEAR)      { return load(yearFile(y),     seed().revenue); }
function set(d, y = DEFAULT_YEAR)   { save(yearFile(y), d); }
function getByType(y = DEFAULT_YEAR){ return load(yearTypeFile(y), seed().revenueByType); }
function setByType(d, y = DEFAULT_YEAR) { save(yearTypeFile(y), d); }

const yr = req => Number(req.query.year) || DEFAULT_YEAR;

router.get('/by-type', (req, res) => res.json(getByType(yr(req))));
router.put('/by-type', requireRole('finance'), (req, res) => {
  const data = req.body;
  if (!Array.isArray(data)) return res.status(400).json({ error: 'array required' });
  setByType(data, yr(req));
  res.json({ ok: true });
});

router.get('/', (req, res) => res.json(get(yr(req))));

router.put('/', requireRole('finance'), (req, res) => {
  const data = req.body.revenue || req.body;
  if (!Array.isArray(data)) return res.status(400).json({ error: 'revenue array required' });
  set(data, yr(req));
  res.json({ ok: true });
});

router.put('/:month', requireRole('finance'), (req, res) => {
  const y = yr(req);
  const rev = get(y);
  const i = rev.findIndex(r => r.month.toLowerCase() === req.params.month.toLowerCase());
  if (i === -1) return res.status(404).json({ error: 'Month not found' });
  rev[i] = { ...rev[i], ...req.body };
  set(rev, y);
  res.json({ row: rev[i] });
});

router.post('/sync', (req, res) => {
  res.json({ ok: true, source: 'QuickBooks + HubSpot', revenue: get(), syncedAt: new Date().toISOString() });
});

module.exports = router;


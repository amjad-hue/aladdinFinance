const router = require('express').Router();
const axios  = require('axios');
const { load, save }  = require('../data/store');
const { requireRole } = require('../middleware/roles');

const DEFAULTS = {
  ceoEmail: '',
  cpoEmail: '',
  reportRecipients: [],
  reportSchedule: 'manual',
  reportDay: 'monday',
  pipelineStaleAfterDays: 14
};

router.get('/', (req, res) => res.json(load('app-settings.json', DEFAULTS)));
router.put('/', requireRole('admin'), (req, res) => {
  const current = load('app-settings.json', DEFAULTS);
  save('app-settings.json', { ...current, ...req.body });
  res.json({ ok: true });
});

// ── Live exchange rate (uses open.er-api.com — free, no key required) ─────────
router.get('/exchange-rate', async (req, res) => {
  const from = (req.query.from || 'AED').toUpperCase();
  const to   = (req.query.to   || 'USD').toUpperCase();
  if (from === to) return res.json({ rate: 1, from, to, source: 'identity' });
  try {
    const { data } = await axios.get(`https://open.er-api.com/v6/latest/${from}`, { timeout: 5000 });
    if (data.result !== 'success') throw new Error(data['error-type'] || 'API error');
    const rate = data.rates?.[to];
    if (!rate) return res.status(400).json({ error: `No rate for ${to}` });
    res.json({ rate: Math.round(rate * 100000) / 100000, from, to, source: 'open.er-api.com', updatedAt: data.time_last_update_utc });
  } catch(e) {
    // Fallback hardcoded approximate rates (USD base)
    const USD_RATES = { AED:3.6725, SAR:3.75, EUR:0.92, GBP:0.79, KWD:0.307, BHD:0.376, QAR:3.64, EGP:48.5, INR:83.5 };
    const fromUsd = USD_RATES[from] || 1;
    const toUsd   = USD_RATES[to]   || 1;
    const rate    = Math.round((fromUsd / toUsd) * 100000) / 100000;
    res.json({ rate, from, to, source: 'fallback-static', note: 'Live rate unavailable — using approximate rate' });
  }
});

module.exports = router;

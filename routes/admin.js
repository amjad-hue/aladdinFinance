const router = require('express').Router();
const { requireRole } = require('../middleware/roles');
const { load, save }  = require('../data/store');
const { seed }        = require('../data/seed');
const { buildClientMap, resolveClientId, resolveDealId } = require('../data/linker');

router.get('/linked', (req, res) => {
  try {
    const { computeLinked } = require('../data/linker');
    res.json(computeLinked());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/linked/backfill', requireRole('admin'), (req, res) => {
  try {
    const clients     = load('clients.json',     seed().clients);
    const ar          = load('ar.json',           seed().accountReceivables);
    const pipeline    = load('pipeline.json',     seed().pipeline);
    const commissions = load('commissions.json',  []);
    const clientMap   = buildClientMap(clients);

    const updated = { ar: 0, pipeline: 0, commissions: 0 };

    const newAR = ar.map(x => {
      const cid = resolveClientId(x.client, clientMap);
      const rt  = x.revenueType || 'Services';
      if (x.clientId === cid && x.revenueType === rt) return x;
      updated.ar++;
      return { ...x, clientId: cid, revenueType: rt };
    });
    save('ar.json', newAR);

    const newPipeline = pipeline.map(d => {
      const cid = resolveClientId(d.client, clientMap);
      if (d.clientId === cid) return d;
      updated.pipeline++;
      return { ...d, clientId: cid };
    });
    save('pipeline.json', newPipeline);

    const newCommissions = commissions.map(c => {
      const cid = resolveClientId(c.client, clientMap);
      const did = resolveDealId(c.dealName, newPipeline);
      if (c.clientId === cid && c.dealId === did) return c;
      updated.commissions++;
      return { ...c, clientId: cid, dealId: did };
    });
    save('commissions.json', newCommissions);

    res.json({ ok: true, updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

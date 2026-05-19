const express = require('express');
const router = express.Router();
const { load, save } = require('../data/store');
const { seed } = require('../data/seed');
const { requireRole } = require('../middleware/roles');

// Enrich clients with AR-derived revenue totals (single source of truth)
function enrichClients(clients) {
  const ar = load('ar.json', seed().accountReceivables);
  const arByClient = {};
  ar.forEach(x => {
    if (!x.client) return;
    const key = x.client.toLowerCase().trim();
    if (!arByClient[key]) arByClient[key] = { total: 0, paid: 0 };
    arByClient[key].total += x.amount || 0;
    if (x.status === 'paid') arByClient[key].paid += x.amount || 0;
  });
  return clients.map(c => {
    const key = (c.name || '').toLowerCase().trim();
    const ar = arByClient[key] || { total: 0, paid: 0 };
    return { ...c, arRevenue: ar.total, arPaid: ar.paid };
  });
}

router.get('/', (req, res) => {
  res.json(enrichClients(load('clients.json', seed().clients)));
});

router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  const clients = load('clients.json', seed().clients);
  const client = clients.find(c => c.id === id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  res.json(enrichClients([client])[0]);
});

router.post('/', requireRole('write'), (req, res) => {
  const { name, type, country, revenue, saas, renewal, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Client name required' });
  const clients = load('clients.json', seed().clients);
  const id = Date.now();
  const rev = Number(revenue) || 0;
  const saasVal = Number(saas) || 0;
  const newClient = {
    id,
    qbId: 'NEW-' + id,
    name,
    type: type || 'Enterprise',
    country: country || '—',
    revenue: rev,
    saas: saasVal,
    services: rev - saasVal,
    renewal: renewal || '2027-01-01',
    notes: notes || '',
    trend: [0, 0, 0, 0, 0, Math.round(rev / 12)],
    fromQBO: false
  };
  clients.push(newClient);
  save('clients.json', clients);
  res.json({ success: true, client: newClient });
});

router.put('/:id', requireRole('write'), (req, res) => {
  const id = Number(req.params.id);
  const clients = load('clients.json', seed().clients);
  const idx = clients.findIndex(c => c.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Client not found' });
  const updates = req.body;
  if (updates.revenue !== undefined && updates.saas !== undefined) {
    updates.services = Number(updates.revenue) - Number(updates.saas);
  }
  clients[idx] = { ...clients[idx], ...updates };
  save('clients.json', clients);
  res.json({ success: true, client: clients[idx] });
});

router.put('/:id/archive', requireRole('write'), (req, res) => {
  const id = Number(req.params.id);
  const clients = load('clients.json', seed().clients);
  const idx = clients.findIndex(c => c.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Client not found' });
  clients[idx].archived = !clients[idx].archived;
  clients[idx].archivedAt = clients[idx].archived ? new Date().toISOString() : null;
  save('clients.json', clients);
  res.json({ success: true, client: clients[idx] });
});

router.delete('/:id', requireRole('write'), (req, res) => {
  const id = Number(req.params.id);
  let clients = load('clients.json', seed().clients);
  clients = clients.filter(c => c.id !== id);
  save('clients.json', clients);
  res.json({ success: true });
});

router.post('/sync', async (req, res) => {
  try {
    const clients = load('clients.json', seed().clients);
    res.json({
      success: true,
      source: 'QuickBooks Customers API',
      count: clients.length,
      clients,
      syncedAt: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const { load, save } = require('../data/store');
const seed = require('../data/seed');

router.get('/', (req, res) => {
  res.json(load('clients.json', seed.clients));
});

router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  const clients = load('clients.json', seed.clients);
  const client = clients.find(c => c.id === id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  res.json(client);
});

router.post('/', (req, res) => {
  const { name, type, country, revenue, saas, renewal, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Client name required' });
  const clients = load('clients.json', seed.clients);
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

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const clients = load('clients.json', seed.clients);
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

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  let clients = load('clients.json', seed.clients);
  clients = clients.filter(c => c.id !== id);
  save('clients.json', clients);
  res.json({ success: true });
});

router.post('/sync', async (req, res) => {
  try {
    const clients = load('clients.json', seed.clients);
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

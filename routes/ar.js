const router = require('express').Router();
const { load, save } = require('../data/store');
const { seed } = require('../data/seed');
const { buildClientMap, resolveClientId } = require('../data/linker');
const { requireRole } = require('../middleware/roles');

function get() { return load('ar.json', seed().accountReceivables); }
function set(d) { save('ar.json', d); }
function getClients() { return load('clients.json', seed().clients); }

router.get('/', (req, res) => res.json(get()));

// Check if a client name exists
router.get('/check-client', (req, res) => {
  const name = (req.query.name || '').trim().toLowerCase();
  const clients = getClients().filter(c => !c.archived);
  const match = clients.find(c => c.name.toLowerCase() === name);
  res.json({ exists: !!match, client: match || null });
});

// Return AR items whose client name doesn't resolve to a known client
router.get('/unlinked', (req, res) => {
  const items = get();
  const clients = getClients().filter(c => !c.archived);
  const clientMap = buildClientMap(clients);
  const unlinked = items.filter(x => !resolveClientId(x.client, clientMap));
  res.json(unlinked);
});

router.post('/', requireRole('write'), (req, res) => {
  const { client, invoice, dueDate, amount, status, revenueType, planType, issuedDate } = req.body;
  if (!client || !amount) return res.status(400).json({ error: 'client and amount required' });
  const items = get();
  if (invoice && invoice.trim()) {
    const dup = items.find(x => x.invoice && x.invoice.trim().toLowerCase() === invoice.trim().toLowerCase());
    if (dup) return res.status(409).json({ error: `Invoice number ${invoice} already exists (${dup.client})` });
  }
  const clientMap = buildClientMap(getClients());
  const item = {
    id: Date.now(), client, invoice: invoice || '',
    issuedDate: issuedDate || '', dueDate: dueDate || '',
    amount: Number(amount), status: status || 'pending',
    revenueType: revenueType || 'Services', planType: planType || '',
    clientId: resolveClientId(client, clientMap),
    createdAt: new Date().toISOString()
  };
  items.push(item);
  set(items);
  res.json({ item });
});

router.put('/:id', requireRole('write'), (req, res) => {
  const items = get();
  const i = items.findIndex(x => x.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  const old = items[i];
  items[i] = { ...old, ...req.body, id: old.id };
  if (items[i].amount) items[i].amount = Number(items[i].amount);
  if (!items[i].revenueType) items[i].revenueType = 'Services';
  const clientMapPut = buildClientMap(getClients());
  items[i].clientId = resolveClientId(items[i].client, clientMapPut);
  set(items);
  res.json({ item: items[i] });
});

router.delete('/:id', requireRole('write'), (req, res) => {
  set(get().filter(x => x.id !== Number(req.params.id)));
  res.json({ ok: true });
});

router.post('/sync-to-qbo', requireRole('write'), async (req, res) => {
  const { QUICKBOOKS_ACCESS_TOKEN, QUICKBOOKS_REALM_ID } = process.env;
  if (!QUICKBOOKS_ACCESS_TOKEN || !QUICKBOOKS_REALM_ID) {
    return res.status(400).json({ error: 'QUICKBOOKS_ACCESS_TOKEN and QUICKBOOKS_REALM_ID are not set in .env' });
  }
  const axios = require('axios');
  const items = get();
  const unsynced = items.filter(x => !x.qboId && x.status !== 'paid');
  if (!unsynced.length) return res.json({ ok: true, pushed: 0, message: 'All invoices already synced to QuickBooks' });

  const qboBase = `https://quickbooks.api.intuit.com/v3/company/${QUICKBOOKS_REALM_ID}`;
  const headers = {
    Authorization: `Bearer ${QUICKBOOKS_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
    Accept: 'application/json'
  };

  async function findOrCreateCustomer(name) {
    const q = encodeURIComponent(`SELECT * FROM Customer WHERE DisplayName = '${name.replace(/'/g, "\\'")}'`);
    const r = await axios.get(`${qboBase}/query?query=${q}&minorversion=65`, { headers });
    const found = r.data.QueryResponse?.Customer?.[0];
    if (found) return found.Id;
    const cr = await axios.post(`${qboBase}/customer?minorversion=65`, { DisplayName: name }, { headers });
    return cr.data.Customer.Id;
  }

  const results = [];
  for (const item of unsynced) {
    try {
      const customerId = await findOrCreateCustomer(item.client);
      const invoiceBody = {
        DocNumber: item.invoice || undefined,
        TxnDate: item.issuedDate || new Date().toISOString().slice(0, 10),
        DueDate: item.dueDate || undefined,
        CustomerRef: { value: customerId },
        Line: [{
          Amount: item.amount,
          DetailType: 'SalesItemLineDetail',
          SalesItemLineDetail: { ItemRef: { value: '1', name: 'Services' } }
        }]
      };
      const r = await axios.post(`${qboBase}/invoice?minorversion=65`, invoiceBody, { headers });
      const qboId = r.data.Invoice.Id;
      const idx = items.findIndex(x => x.id === item.id);
      if (idx > -1) items[idx].qboId = qboId;
      results.push({ id: item.id, client: item.client, qboId, ok: true });
    } catch (e) {
      const msg = e.response?.data?.Fault?.Error?.[0]?.Message || e.message;
      results.push({ id: item.id, client: item.client, ok: false, error: msg });
    }
  }

  set(items);
  const pushed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  res.json({
    ok: true, pushed, failed, results,
    message: `${pushed} invoice${pushed !== 1 ? 's' : ''} pushed to QuickBooks${failed ? `, ${failed} failed` : ''}`
  });
});

module.exports = router;

const router = require('express').Router();
const crypto = require('crypto');
const { load, save } = require('../data/store');
const { requireRole } = require('../middleware/roles');

function gS()    { return load('stripe-settings.json', { mode: 'test' }); }
function sS(d)   { save('stripe-settings.json', d); }
function gLog()  { return load('stripe-event-log.json', []); }
function aLog(e) { const l = gLog(); l.unshift(e); save('stripe-event-log.json', l.slice(0, 50)); }

// ── Status (any authenticated user) ──────────────────────────────────────────
router.get('/status', (req, res) => {
  const s   = gS();
  const log = gLog();
  const connected = s.mode === 'live' ? !!s.liveKey : !!s.testKey;
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  res.json({
    connected,
    mode: s.mode || 'test',
    lastWebhook: log[0]?.receivedAt || null,
    eventCount: log.length,
    webhookUrl: `${proto}://${req.get('host')}/api/stripe/webhook`,
  });
});

// ── Settings GET — returns masked keys (admin only) ───────────────────────────
router.get('/settings', requireRole('admin'), (req, res) => {
  const s     = gS();
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  res.json({
    mode: s.mode || 'test',
    testKeySet: !!s.testKey,
    liveKeySet: !!s.liveKey,
    testKeyMasked: s.testKey ? 'sk_test_' + '•'.repeat(8) + s.testKey.slice(-4) : '',
    liveKeyMasked: s.liveKey ? 'sk_live_' + '•'.repeat(8) + s.liveKey.slice(-4) : '',
    webhookSecretSet: !!s.webhookSecret,
    webhookUrl: `${proto}://${req.get('host')}/api/stripe/webhook`,
  });
});

// ── Settings PUT (admin only) ─────────────────────────────────────────────────
router.put('/settings', requireRole('admin'), (req, res) => {
  const s = gS();
  const { testKey, liveKey, webhookSecret, mode } = req.body;
  // Only overwrite if user sent a real value (not the masked placeholder)
  if (testKey     && testKey !== '***'     && !testKey.startsWith('•'))     s.testKey     = testKey.trim();
  if (liveKey     && liveKey !== '***'     && !liveKey.startsWith('•'))     s.liveKey     = liveKey.trim();
  if (webhookSecret && webhookSecret !== '***' && !webhookSecret.startsWith('•')) s.webhookSecret = webhookSecret.trim();
  if (mode) s.mode = mode;
  sS(s);
  res.json({ ok: true });
});

// ── Test connection (admin only) ──────────────────────────────────────────────
router.post('/test', requireRole('admin'), (req, res) => {
  const s   = gS();
  const key = s.mode === 'live' ? s.liveKey : s.testKey;
  if (!key) return res.status(400).json({ ok: false, error: `No ${s.mode} secret key configured` });
  if (!key.startsWith('sk_test_') && !key.startsWith('sk_live_')) {
    return res.status(400).json({ ok: false, error: 'Invalid key — must start with sk_test_ or sk_live_' });
  }
  const expectedPrefix = s.mode === 'live' ? 'sk_live_' : 'sk_test_';
  if (!key.startsWith(expectedPrefix)) {
    const actual = key.startsWith('sk_live_') ? 'live' : 'test';
    return res.status(400).json({ ok: false, error: `Key is a ${actual} key but mode is set to "${s.mode}"` });
  }
  res.json({ ok: true, message: `${s.mode === 'live' ? 'Live' : 'Test'} key format is valid. Register the Webhook URL in your Stripe Dashboard to complete setup.` });
});

// ── Event log (any authenticated user) ───────────────────────────────────────
router.get('/event-log', (req, res) => res.json(gLog()));

// ── Unlinked subscriptions queue ──────────────────────────────────────────────
router.get('/unlinked', requireRole('admin'), (req, res) => {
  res.json(load('stripe-unlinked.json', []));
});

router.post('/unlinked/:stripeSubId/attach', requireRole('admin'), (req, res) => {
  const { stripeSubId } = req.params;
  const { clientId, clientName, dealId, owner, ownerEmail } = req.body;
  const { seed } = require('../data/seed');
  const unlinked = load('stripe-unlinked.json', []);
  const entry    = unlinked.find(u => u.stripeSubId === stripeSubId);
  if (!entry) return res.status(404).json({ error: 'Not found in unlinked queue' });

  const subs = load('subscriptions.json', seed().subscriptions);
  const newSub = {
    id: Date.now(), clientName: clientName || '', clientId: clientId || null,
    dealId: dealId || null, plan: entry.plan || '', billing: entry.interval || 'monthly',
    amount: entry.amount || 0, status: _mapSubStatus(entry.status),
    startDate: entry.currentPeriodEnd || '', renewalDate: '',
    seats: 0, notes: `Linked from Stripe subscription ${stripeSubId}`,
    owner: owner || '', ownerEmail: ownerEmail || '',
    stripeSubId, createdAt: new Date().toISOString(), fromStripe: true,
  };
  subs.push(newSub);
  save('subscriptions.json', subs);

  // Remove from unlinked queue
  save('stripe-unlinked.json', unlinked.filter(u => u.stripeSubId !== stripeSubId));
  res.json({ ok: true, subscription: newSub });
});

// ── Webhook (public — no JWT, verified by Stripe signature if secret is set) ──
// Registered as a public route in server.js (before auth middleware).
// Body is raw Buffer when express.raw() middleware runs first (see server.js).
function webhookHandler(req, res) {
  let rawBody, event;
  try {
    rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body);
    event   = JSON.parse(rawBody);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  // Optional signature verification
  const s = gS();
  if (s.webhookSecret) {
    const sig = req.headers['stripe-signature'];
    if (!sig) return res.status(400).json({ error: 'Missing Stripe-Signature header' });
    try {
      const parts = sig.split(',').reduce((acc, p) => { const [k, v] = p.split('='); acc[k] = v; return acc; }, {});
      const payload  = `${parts.t}.${rawBody}`;
      const expected = crypto.createHmac('sha256', s.webhookSecret).update(payload).digest('hex');
      if (expected !== parts.v1) return res.status(400).json({ error: 'Signature mismatch' });
    } catch (e) {
      return res.status(400).json({ error: 'Signature verification failed' });
    }
  }

  // Log the event
  aLog({
    id: event.id,
    type: event.type,
    receivedAt: new Date().toISOString(),
    livemode: !!event.livemode,
    summary: _summarize(event),
  });

  // Handle known event types
  const obj = event.data?.object || {};
  const type = event.type;
  try {
    if (type === 'customer.subscription.created' || type === 'customer.subscription.updated') {
      _handleSubscriptionChange(obj);
    } else if (type === 'customer.subscription.deleted') {
      _handleSubscriptionDeleted(obj);
    } else if (type === 'invoice.paid') {
      _handleInvoicePaid(obj);
    } else if (type === 'invoice.payment_failed') {
      _handleInvoicePaymentFailed(obj);
    }
    // checkout.session.completed — subscription.created event follows, handles it
  } catch (e) {
    console.error('Stripe webhook handler error:', e.message);
  }

  res.json({ received: true });
}

// ── Internal helpers ──────────────────────────────────────────────────────────
function _summarize(event) {
  const obj = event.data?.object || {};
  switch (event.type) {
    case 'customer.subscription.created':  return `Sub ${obj.id} created — customer ${obj.customer}`;
    case 'customer.subscription.updated':  return `Sub ${obj.id} updated — status: ${obj.status}`;
    case 'customer.subscription.deleted':  return `Sub ${obj.id} canceled`;
    case 'invoice.paid':                   return `Invoice ${obj.id} paid — $${((obj.amount_paid||0)/100).toFixed(2)}`;
    case 'invoice.payment_failed':         return `Invoice ${obj.id} payment failed — $${((obj.amount_due||0)/100).toFixed(2)}`;
    case 'checkout.session.completed':     return `Checkout ${obj.id} completed — $${((obj.amount_total||0)/100).toFixed(2)}`;
    default:                               return event.type;
  }
}

function _handleSubscriptionChange(sub) {
  const { seed } = require('../data/seed');
  const subs = load('subscriptions.json', seed().subscriptions);
  const idx  = subs.findIndex(s => s.stripeSubId === sub.id);

  if (idx === -1) {
    // Check if metadata has a clientId or dealId we can auto-link with
    const meta    = sub.metadata || {};
    const clientId = meta.clientId ? Number(meta.clientId) : null;
    const dealId   = meta.dealId   ? Number(meta.dealId)   : null;

    if (clientId || meta.clientName) {
      // Auto-create linked subscription
      const clients = load('clients.json', seed().clients);
      const client  = clientId ? clients.find(c => c.id === clientId) : null;
      const newSub  = {
        id: Date.now(), clientName: client?.name || meta.clientName || '',
        clientId: client?.id || clientId, dealId,
        plan: meta.plan || '', billing: sub.items?.data?.[0]?.price?.recurring?.interval || 'monthly',
        amount: Math.round((sub.items?.data?.[0]?.price?.unit_amount || 0) / 100),
        status: _mapSubStatus(sub.status),
        startDate: sub.current_period_start ? new Date(sub.current_period_start * 1000).toISOString().split('T')[0] : '',
        renewalDate: sub.current_period_end  ? new Date(sub.current_period_end  * 1000).toISOString().split('T')[0] : '',
        seats: 0, notes: `Auto-created from Stripe webhook`, owner: meta.owner || '', ownerEmail: '',
        stripeSubId: sub.id, createdAt: new Date().toISOString(), fromStripe: true,
      };
      subs.push(newSub);
      save('subscriptions.json', subs);
    } else {
      // No metadata — add to unlinked queue for manual matching
      const unlinked = load('stripe-unlinked.json', []);
      if (!unlinked.some(u => u.stripeSubId === sub.id)) {
        unlinked.push({
          stripeSubId: sub.id, stripeCustomerId: sub.customer,
          status: sub.status,
          amount: Math.round((sub.items?.data?.[0]?.price?.unit_amount || 0) / 100),
          currency: sub.currency || 'usd',
          interval: sub.items?.data?.[0]?.price?.recurring?.interval || '',
          currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString().split('T')[0] : '',
          receivedAt: new Date().toISOString(),
          metadata: sub.metadata || {},
        });
        save('stripe-unlinked.json', unlinked);
      }
    }
    return;
  }

  // Update existing linked subscription
  subs[idx].status      = _mapSubStatus(sub.status);
  subs[idx].renewalDate = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString().split('T')[0] : subs[idx].renewalDate;
  const newAmt = Math.round((sub.items?.data?.[0]?.price?.unit_amount || 0) / 100);
  if (newAmt > 0) subs[idx].amount = newAmt;
  subs[idx].lastStripeSync = new Date().toISOString();
  save('subscriptions.json', subs);
}

function _handleSubscriptionDeleted(sub) {
  const { seed } = require('../data/seed');
  const subs = load('subscriptions.json', seed().subscriptions);
  const idx  = subs.findIndex(s => s.stripeSubId === sub.id);
  if (idx !== -1) {
    subs[idx].status = 'canceled';
    subs[idx].lastStripeSync = new Date().toISOString();
    save('subscriptions.json', subs);
  }
}

function _handleInvoicePaid(invoice) {
  if (!invoice.subscription) return;
  const { seed } = require('../data/seed');
  const subs = load('subscriptions.json', seed().subscriptions);
  const idx  = subs.findIndex(s => s.stripeSubId === invoice.subscription);
  if (idx !== -1) {
    subs[idx].status = 'active';
    subs[idx].lastStripeSync = new Date().toISOString();
    save('subscriptions.json', subs);
  }
}

function _handleInvoicePaymentFailed(invoice) {
  if (!invoice.subscription) return;
  const { seed } = require('../data/seed');
  const subs = load('subscriptions.json', seed().subscriptions);
  const idx  = subs.findIndex(s => s.stripeSubId === invoice.subscription);
  if (idx !== -1) {
    subs[idx].status = 'past_due';
    subs[idx].lastStripeSync = new Date().toISOString();
    save('subscriptions.json', subs);
  }
}

function _mapSubStatus(stripeStatus) {
  const map = {
    active: 'active', past_due: 'past_due', canceled: 'canceled',
    trialing: 'active', incomplete: 'pending_approval',
    incomplete_expired: 'canceled', unpaid: 'past_due', paused: 'on_hold',
  };
  return map[stripeStatus] || stripeStatus;
}

module.exports = { router, webhookHandler };

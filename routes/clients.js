const express = require('express');
const router = express.Router();
const { load, save } = require('../data/store');
const { seed } = require('../data/seed');
const { requireRole } = require('../middleware/roles');
const mailer = require('../lib/mailer');

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

// ── Client Future Notes ───────────────────────────────────────────────────────

router.get('/:id/notes', (req, res) => {
  const id = Number(req.params.id);
  const clients = load('clients.json', seed().clients);
  const client = clients.find(c => c.id === id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  res.json(client.futureNotes || []);
});

router.post('/:id/notes', requireRole('write'), (req, res) => {
  const id = Number(req.params.id);
  const clients = load('clients.json', seed().clients);
  const idx = clients.findIndex(c => c.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Client not found' });
  const { title, content, reminderDate, reminderEmail } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });
  const noteId = Date.now();
  const note = { id: noteId, title: title.trim(), content: content||'', reminderDate: reminderDate||'', reminderEmail: reminderEmail||'', calEventId: null, createdAt: new Date().toISOString() };
  if (!clients[idx].futureNotes) clients[idx].futureNotes = [];
  clients[idx].futureNotes.push(note);
  if (reminderDate) {
    const events = load('events.json', []);
    const calEvent = { id: noteId + 1, type: 'task', title: `📋 ${clients[idx].name}: ${note.title}`, date: reminderDate, note: note.content||'', relatedClientId: id, relatedNoteId: noteId, createdAt: new Date().toISOString() };
    events.push(calEvent);
    save('events.json', events);
    clients[idx].futureNotes[clients[idx].futureNotes.length-1].calEventId = calEvent.id;
    note.calEventId = calEvent.id;
  }
  save('clients.json', clients);
  res.json({ note });
});

router.put('/:id/notes/:noteId', requireRole('write'), (req, res) => {
  const id = Number(req.params.id);
  const noteId = Number(req.params.noteId);
  const clients = load('clients.json', seed().clients);
  const idx = clients.findIndex(c => c.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Client not found' });
  const noteIdx = (clients[idx].futureNotes||[]).findIndex(n => n.id === noteId);
  if (noteIdx === -1) return res.status(404).json({ error: 'Note not found' });
  const note = clients[idx].futureNotes[noteIdx];
  const { title, content, reminderDate, reminderEmail } = req.body;
  if (title !== undefined)         note.title         = title.trim();
  if (content !== undefined)       note.content       = content;
  if (reminderDate !== undefined)  note.reminderDate  = reminderDate;
  if (reminderEmail !== undefined) note.reminderEmail = reminderEmail;
  note.updatedAt = new Date().toISOString();
  const events = load('events.json', []);
  if (note.calEventId) {
    const evIdx = events.findIndex(e => e.id === note.calEventId);
    if (evIdx > -1) {
      if (note.reminderDate) {
        events[evIdx].date  = note.reminderDate;
        events[evIdx].title = `📋 ${clients[idx].name}: ${note.title}`;
        events[evIdx].note  = note.content||'';
      } else {
        events.splice(evIdx, 1);
        note.calEventId = null;
      }
      save('events.json', events);
    }
  } else if (note.reminderDate) {
    const calEvent = { id: Date.now(), type: 'task', title: `📋 ${clients[idx].name}: ${note.title}`, date: note.reminderDate, note: note.content||'', relatedClientId: id, relatedNoteId: noteId, createdAt: new Date().toISOString() };
    events.push(calEvent);
    save('events.json', events);
    note.calEventId = calEvent.id;
  }
  clients[idx].futureNotes[noteIdx] = note;
  save('clients.json', clients);
  res.json({ note });
});

router.delete('/:id/notes/:noteId', requireRole('write'), (req, res) => {
  const id = Number(req.params.id);
  const noteId = Number(req.params.noteId);
  const clients = load('clients.json', seed().clients);
  const idx = clients.findIndex(c => c.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Client not found' });
  const note = (clients[idx].futureNotes||[]).find(n => n.id === noteId);
  if (note?.calEventId) {
    const events = load('events.json', []);
    save('events.json', events.filter(e => e.id !== note.calEventId));
  }
  clients[idx].futureNotes = (clients[idx].futureNotes||[]).filter(n => n.id !== noteId);
  save('clients.json', clients);
  res.json({ ok: true });
});

// GET — preview only (opens in browser popup via previewEmail())
router.get('/:id/notes/:noteId/remind', (req, res) => {
  const id     = Number(req.params.id);
  const noteId = Number(req.params.noteId);
  const clients = load('clients.json', seed().clients);
  const client  = clients.find(c => c.id === id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  const note = (client.futureNotes||[]).find(n => n.id === noteId);
  if (!note) return res.status(404).json({ error: 'Note not found' });
  res.send(clientNoteReminderHtml(client, note));
});

// POST — manual send
router.post('/:id/notes/:noteId/remind', async (req, res) => {
  const id     = Number(req.params.id);
  const noteId = Number(req.params.noteId);
  const clients = load('clients.json', seed().clients);
  const idx = clients.findIndex(c => c.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Client not found' });
  const noteIdx = (clients[idx].futureNotes||[]).findIndex(n => n.id === noteId);
  if (noteIdx === -1) return res.status(404).json({ error: 'Note not found' });
  const note = clients[idx].futureNotes[noteIdx];
  if (!mailer.isConfigured()) return res.status(400).json({ error: 'Email not configured' });
  const to = note.reminderEmail || req.body.email;
  if (!to) return res.status(400).json({ error: 'No recipient email set on this note' });
  const html = clientNoteReminderHtml(clients[idx], note);
  await mailer.sendMail({ to, subject: `Reminder: ${note.title} — ${clients[idx].name}`, html });
  note.sentAt = new Date().toISOString();
  save('clients.json', clients);
  res.json({ ok: true, sentTo: to });
});

function clientNoteReminderHtml(client, note) {
  const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const d = note.reminderDate
    ? new Date(note.reminderDate + 'T00:00:00').toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' })
    : '';
  const now = new Date().toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  const contentHtml = (note.content||'').split('\n')
    .map(l => l ? `<p style="margin:0 0 6px;font-size:13px;color:#374151;line-height:1.65">${esc(l)}</p>` : '<p style="margin:0 0 6px">&nbsp;</p>')
    .join('');
  const init = (client.name||'').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '??';
  const clientMeta = [client.type, client.country].filter(Boolean).map(esc).join(' &middot; ');

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Client Note Reminder</title></head>
<body style="margin:0;padding:0;background:#F4F6FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F4F6FA">
<tr><td align="center" style="padding:40px 16px">

<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.10)">

  <!-- HEADER -->
  <tr>
    <td bgcolor="#3B5BDB" style="background:linear-gradient(135deg,#3B5BDB 0%,#5C7CFA 100%);padding:28px 32px">
      <p style="margin:0 0 8px;font-size:10px;color:rgba(255,255,255,.7);text-transform:uppercase;letter-spacing:.12em">Aladdin Finance &middot; Client Note</p>
      <p style="margin:0 0 4px;font-size:22px;font-weight:800;color:#ffffff;line-height:1.3">&#128203; ${esc(note.title)}</p>
      <p style="margin:0;font-size:11px;color:rgba(255,255,255,.7)">${now}</p>
    </td>
  </tr>

  <!-- BODY -->
  <tr>
    <td bgcolor="#ffffff" style="padding:24px 32px">

      <!-- Client row -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F0F4FF;border-radius:10px;margin-bottom:20px">
        <tr>
          <td style="padding:14px 18px">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="width:44px;vertical-align:middle;padding-right:12px">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="40" height="40" style="border-radius:10px;background:#3B5BDB">
                    <tr><td align="center" valign="middle" width="40" height="40" style="font-size:13px;font-weight:800;color:#ffffff;text-align:center">${init}</td></tr>
                  </table>
                </td>
                <td style="vertical-align:middle">
                  <p style="margin:0;font-size:13px;font-weight:700;color:#111827">${esc(client.name)}</p>
                  ${clientMeta ? `<p style="margin:2px 0 0;font-size:11px;color:#6B7280">${clientMeta}</p>` : ''}
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      ${d ? `<!-- Reminder date -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;margin-bottom:20px">
        <tr>
          <td style="padding:12px 16px">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="vertical-align:middle;padding-right:10px;font-size:20px">&#128197;</td>
                <td style="vertical-align:middle">
                  <p style="margin:0;font-size:10px;font-weight:700;color:#15803D;text-transform:uppercase;letter-spacing:.07em">Reminder Date</p>
                  <p style="margin:3px 0 0;font-size:13px;font-weight:700;color:#14532D">${d}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>` : ''}

      ${note.content ? `<!-- Note content -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F9FAFB;border-radius:10px;margin-bottom:18px">
        <tr>
          <td style="padding:16px 20px">
            <p style="margin:0 0 10px;font-size:10px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:.07em">Note</p>
            ${contentHtml}
          </td>
        </tr>
      </table>` : ''}

      <p style="margin:0;font-size:11px;color:#9CA3AF;line-height:1.7">Reminder sent manually from Aladdin Finance CFO Dashboard.</p>
    </td>
  </tr>

  <!-- FOOTER -->
  <tr>
    <td bgcolor="#F4F6FA" style="padding:14px 32px;text-align:center">
      <p style="margin:0;font-size:10px;color:#9CA3AF">Aladdin Finance &middot; CFO Dashboard</p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

module.exports = router;

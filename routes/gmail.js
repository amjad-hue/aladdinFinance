const router = require('express').Router();
const { load, save } = require('../data/store');

function getGmailClient() {
  const { google } = require('googleapis');
  const tokens = load('gcal_tokens.json', null);
  if (!tokens?.refresh_token) return null;
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return null;
  const scope = tokens.scope || '';
  if (!scope.includes('gmail')) return null;
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/events/gcal/callback'
  );
  oauth2.setCredentials(tokens);
  oauth2.on('tokens', updated => save('gcal_tokens.json', { ...tokens, ...updated }));
  return google.gmail({ version: 'v1', auth: oauth2 });
}

function isGmailReady() {
  const tokens = load('gcal_tokens.json', null);
  if (!tokens?.refresh_token) return false;
  return (tokens.scope || '').includes('gmail');
}

// ── Status ────────────────────────────────────────────────────────────────────
router.get('/status', (req, res) => {
  const tokens = load('gcal_tokens.json', null);
  res.json({
    connected: isGmailReady(),
    email: tokens?._email || null,
    needsAuth: !tokens?.refresh_token,
    needsReauth: !!tokens?.refresh_token && !isGmailReady()
  });
});

// ── List messages ─────────────────────────────────────────────────────────────
router.get('/messages', async (req, res) => {
  const gmail = getGmailClient();
  if (!gmail) return res.status(400).json({ error: 'Gmail not connected. Re-authorize Google in Settings.' });

  const q      = req.query.q      || '';
  const maxRes = Math.min(Number(req.query.max) || 20, 50);
  const label  = req.query.label  || 'INBOX';

  try {
    const list = await gmail.users.messages.list({
      userId: 'me',
      q: q || undefined,
      labelIds: [label],
      maxResults: maxRes
    });

    const msgs = list.data.messages || [];
    if (!msgs.length) return res.json({ messages: [] });

    const details = await Promise.all(
      msgs.map(m => gmail.users.messages.get({
        userId: 'me', id: m.id,
        format: 'metadata',
        metadataHeaders: ['From', 'To', 'Subject', 'Date']
      }))
    );

    const messages = details.map(d => {
      const h = {};
      (d.data.payload?.headers || []).forEach(hdr => { h[hdr.name] = hdr.value; });
      return {
        id:       d.data.id,
        threadId: d.data.threadId,
        snippet:  d.data.snippet,
        from:     h.From    || '',
        to:       h.To      || '',
        subject:  h.Subject || '(no subject)',
        date:     h.Date    || '',
        unread:   (d.data.labelIds || []).includes('UNREAD'),
        labels:   d.data.labelIds || []
      };
    });

    res.json({ messages });
  } catch (e) {
    console.error('Gmail list error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Get message body ──────────────────────────────────────────────────────────
router.get('/messages/:id', async (req, res) => {
  const gmail = getGmailClient();
  if (!gmail) return res.status(400).json({ error: 'Gmail not connected' });

  try {
    const d = await gmail.users.messages.get({ userId: 'me', id: req.params.id, format: 'full' });
    const headers = {};
    (d.data.payload?.headers || []).forEach(h => { headers[h.name] = h.value; });

    function extractBody(payload) {
      if (!payload) return '';
      if (payload.mimeType === 'text/html' && payload.body?.data)
        return Buffer.from(payload.body.data, 'base64').toString('utf8');
      if (payload.mimeType === 'text/plain' && payload.body?.data)
        return '<pre style="white-space:pre-wrap;font-family:inherit">' +
          Buffer.from(payload.body.data, 'base64').toString('utf8') + '</pre>';
      if (payload.parts) {
        const html = payload.parts.find(p => p.mimeType === 'text/html');
        if (html?.body?.data) return Buffer.from(html.body.data, 'base64').toString('utf8');
        const txt = payload.parts.find(p => p.mimeType === 'text/plain');
        if (txt?.body?.data) return '<pre style="white-space:pre-wrap;font-family:inherit">' +
          Buffer.from(txt.body.data, 'base64').toString('utf8') + '</pre>';
        for (const part of payload.parts) { const r = extractBody(part); if (r) return r; }
      }
      return '';
    }

    function extractAttachments(payload, list = []) {
      if (!payload) return list;
      const disp = (payload.headers || []).find(h => h.name === 'Content-Disposition')?.value || '';
      if (payload.filename && payload.body?.attachmentId) {
        list.push({ attachmentId: payload.body.attachmentId, filename: payload.filename, mimeType: payload.mimeType, size: payload.body.size || 0 });
      }
      if (payload.parts) payload.parts.forEach(p => extractAttachments(p, list));
      return list;
    }

    res.json({
      id:          d.data.id,
      subject:     headers.Subject || '(no subject)',
      from:        headers.From    || '',
      to:          headers.To      || '',
      date:        headers.Date    || '',
      body:        extractBody(d.data.payload),
      labels:      d.data.labelIds || [],
      attachments: extractAttachments(d.data.payload)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Send email ────────────────────────────────────────────────────────────────
router.post('/send', async (req, res) => {
  const gmail = getGmailClient();
  if (!gmail) return res.status(400).json({ error: 'Gmail not connected' });

  const { to, cc, subject, body, html } = req.body;
  if (!to || !subject) return res.status(400).json({ error: 'to and subject are required' });

  const tokens  = load('gcal_tokens.json', null);
  const from    = tokens?._email || 'me';
  const content = html || `<pre style="font-family:inherit;white-space:pre-wrap">${body || ''}</pre>`;

  const rawLines = [
    `From: ${from}`,
    `To: ${to}`,
    ...(cc ? [`Cc: ${cc}`] : []),
    `Subject: =?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    '',
    content
  ];
  const raw = rawLines.join('\r\n');

  const encoded = Buffer.from(raw).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');

  try {
    await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encoded } });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Mark read ─────────────────────────────────────────────────────────────────
router.post('/messages/:id/read', async (req, res) => {
  const gmail = getGmailClient();
  if (!gmail) return res.status(400).json({ error: 'Gmail not connected' });
  try {
    await gmail.users.messages.modify({ userId: 'me', id: req.params.id, requestBody: { removeLabelIds: ['UNREAD'] } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Trash message ─────────────────────────────────────────────────────────────
router.post('/messages/:id/trash', async (req, res) => {
  const gmail = getGmailClient();
  if (!gmail) return res.status(400).json({ error: 'Gmail not connected' });
  try {
    await gmail.users.messages.trash({ userId: 'me', id: req.params.id });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Download attachment ───────────────────────────────────────────────────────
router.get('/messages/:id/attachment/:attachmentId', async (req, res) => {
  const gmail = getGmailClient();
  if (!gmail) return res.status(400).json({ error: 'Gmail not connected' });
  try {
    const att = await gmail.users.messages.attachments.get({
      userId: 'me', messageId: req.params.id, id: req.params.attachmentId
    });
    const data = Buffer.from(att.data.data.replace(/-/g,'+').replace(/_/g,'/'), 'base64');
    const filename = req.query.filename || 'attachment';
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', req.query.mime || 'application/octet-stream');
    res.send(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Email signature ───────────────────────────────────────────────────────────
router.get('/signature', (req, res) => {
  const settings = load('gmail_settings.json', {});
  res.json({ signature: settings.signature || '' });
});

router.post('/signature', (req, res) => {
  const settings = load('gmail_settings.json', {});
  settings.signature = req.body.signature || '';
  save('gmail_settings.json', settings);
  res.json({ ok: true });
});

module.exports = router;
module.exports.isGmailReady  = isGmailReady;
module.exports.getGmailClient = getGmailClient;

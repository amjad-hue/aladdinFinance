const router = require('express').Router();
const crypto = require('crypto');
const { load, save } = require('../data/store');
const mailer = require('../lib/mailer');

const FILE = 'requests.json';
const CFG  = 'request-settings.json';

function getAll()   { return load(FILE, []); }
function setAll(d)  { save(FILE, d); }
function getCfg() {
  let c = load(CFG, null);
  if (!c || !c.token) {
    c = { token: crypto.randomBytes(20).toString('hex'), formTitle: 'Submit a Request', formDesc: 'Fill in the details below and our team will review your request promptly.' };
    save(CFG, c);
  }
  return c;
}

// ── Public handlers (registered before auth middleware in server.js) ────────────
const publicFormHandler = (req, res) => {
  const c = getCfg();
  if (c.token !== req.params.token) return res.status(403).json({ error: 'Invalid link' });
  res.json({ title: c.formTitle, desc: c.formDesc });
};

function isPersonalEmail(email) {
  const PERSONAL_DOMAINS = ['gmail.com','yahoo.com','hotmail.com','outlook.com','icloud.com','protonmail.com','aol.com'];
  if (!email) return false;
  const domain = email.split('@')[1]?.toLowerCase();
  return PERSONAL_DOMAINS.includes(domain);
}

const publicSubmitHandler = async (req, res) => {
  const c = getCfg();
  if (c.token !== req.params.token) return res.status(403).json({ error: 'Invalid or expired link' });
  const { subject, details, dueDate, email, priority } = req.body;
  if (!subject?.trim()) return res.status(400).json({ error: 'Subject is required' });
  // Enforce corporate email if domain restriction configured
  if (c.requireCorporateEmail && isPersonalEmail(email)) {
    return res.status(400).json({ error: 'Please use your company email address to submit requests.' });
  }
  const items = getAll();
  const item = {
    id: Date.now(), subject: subject.trim(), details: details || '',
    dueDate: dueDate || '', email: (email||'').trim(), priority: priority || 'medium',
    status: 'pending', submittedAt: new Date().toISOString(),
    acceptedAt: null, rejectedAt: null, taskId: null, rejectionReason: ''
  };
  items.push(item);
  setAll(items);
  res.json({ ok: true });
};

// ── Authenticated routes ──────────────────────────────────────────────────────
router.get('/',        (req, res) => res.json(getAll()));
router.get('/config',  (req, res) => res.json(getCfg()));
router.put('/config',  (req, res) => { save(CFG, { ...getCfg(), ...req.body }); res.json({ ok: true }); });

router.post('/regenerate-token', (req, res) => {
  const c = getCfg();
  c.token = crypto.randomBytes(20).toString('hex');
  save(CFG, c);
  res.json({ token: c.token });
});

// Preview sent email HTML (shows actual stored note/reason)
router.get('/preview-accept/:id', (req, res) => {
  const r = getAll().find(x => x.id === Number(req.params.id));
  if (!r) return res.status(404).send('Not found');
  res.set('Content-Type','text/html').send(acceptEmail(r, r.note || '', r.deliveryDate || ''));
});

router.get('/preview-reject/:id', (req, res) => {
  const r = getAll().find(x => x.id === Number(req.params.id));
  if (!r) return res.status(404).send('Not found');
  res.set('Content-Type','text/html').send(rejectEmail(r, r.rejectionReason || '', ''));
});

router.put('/:id/accept', async (req, res) => {
  const items = getAll();
  const i = items.findIndex(x => x.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  const r = items[i];
  const { note, deliveryDate, customSubject } = req.body;
  const deadline = deliveryDate || r.dueDate || '';
  const tasks = load('tasks.json', []);
  const task = {
    id: Date.now(), title: r.subject, deadline, priority: r.priority || 'medium',
    taskType: 'task', done: false, ceoNote: r.details || '', requestId: r.id,
    requestEmail: r.email, notifyEmail: r.email || '', createdAt: new Date().toISOString()
  };
  tasks.push(task);
  save('tasks.json', tasks);
  items[i] = { ...r, status: 'accepted', acceptedAt: new Date().toISOString(), taskId: task.id, note: note||'', deliveryDate: deliveryDate||'' };
  setAll(items);
  if (r.email && mailer.isConfigured()) {
    mailer.sendMail({
      to: r.email,
      subject: customSubject || `Request Accepted: ${r.subject}`,
      html: acceptEmail(r, note, deliveryDate)
    }).catch(e => console.error('Accept email:', e.message));
  }
  res.json({ ok: true, task });
});

router.put('/:id/reject', async (req, res) => {
  const items = getAll();
  const i = items.findIndex(x => x.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  const { reason, alternative, customSubject } = req.body;
  items[i] = { ...items[i], status: 'rejected', rejectedAt: new Date().toISOString(), rejectionReason: reason || '' };
  setAll(items);
  const r = items[i];
  if (r.email && mailer.isConfigured()) {
    mailer.sendMail({
      to: r.email,
      subject: customSubject || `Request Update: ${r.subject}`,
      html: rejectEmail(r, reason, alternative)
    }).catch(e => console.error('Reject email:', e.message));
  }
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => { setAll(getAll().filter(x => x.id !== Number(req.params.id))); res.json({ ok: true }); });

router.put('/:id/adjust', async (req, res) => {
  const items = getAll();
  const i = items.findIndex(x => x.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  const r = items[i];
  if (!r.email) return res.status(400).json({ error: 'No email address on this request' });
  const respondToken = crypto.randomBytes(20).toString('hex');
  const { adjustedSubject, adjustedDetails, adjustedDueDate, adjustedPriority, adjustNote } = req.body;
  items[i] = { ...r, status: 'adjusted', adjustedAt: new Date().toISOString(),
    adjustedSubject: adjustedSubject || r.subject, adjustedDetails: adjustedDetails || r.details,
    adjustedDueDate: adjustedDueDate || r.dueDate, adjustedPriority: adjustedPriority || r.priority,
    adjustNote: adjustNote || '', respondToken, respondedAt: null, respondDecision: null };
  setAll(items);
  const updated = items[i];
  if (mailer.isConfigured()) {
    const origin = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
    mailer.sendMail({ to: r.email, subject: `Request Adjustment Proposal: ${r.subject}`, html: adjustEmail(updated, origin) })
      .catch(e => console.error('Adjust email:', e.message));
  }
  res.json({ ok: true });
});

// ── Public respond handlers (registered before auth middleware in server.js) ──
const publicRespondHandler = (req, res) => {
  const items = getAll();
  const r = items.find(x => x.respondToken === req.params.token);
  if (!r) return res.status(404).json({ error: 'Invalid or expired link' });
  res.json({
    subject: r.subject, details: r.details,
    adjustedSubject: r.adjustedSubject, adjustedDetails: r.adjustedDetails,
    adjustedDueDate: r.adjustedDueDate, adjustedPriority: r.adjustedPriority,
    adjustNote: r.adjustNote, status: r.status
  });
};

const publicRespondSubmitHandler = (req, res) => {
  const items = getAll();
  const i = items.findIndex(x => x.respondToken === req.params.token);
  if (i === -1) return res.status(404).json({ error: 'Invalid or expired link' });
  if (items[i].respondDecision) return res.status(400).json({ error: 'Already responded' });
  const { decision } = req.body;
  if (decision !== 'accept' && decision !== 'decline') return res.status(400).json({ error: 'Invalid decision' });
  items[i].respondDecision = decision;
  items[i].respondedAt = new Date().toISOString();
  items[i].status = decision === 'accept' ? 'adjustment_accepted' : 'adjustment_declined';
  if (decision === 'accept') {
    items[i].subject  = items[i].adjustedSubject  || items[i].subject;
    items[i].details  = items[i].adjustedDetails  || items[i].details;
    items[i].dueDate  = items[i].adjustedDueDate  || items[i].dueDate;
    items[i].priority = items[i].adjustedPriority || items[i].priority;
  }
  setAll(items);
  res.json({ ok: true, decision });
};

// ── Email templates ───────────────────────────────────────────────────────────
function acceptEmail(r, note, deliveryDate) {
  const d   = new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  const delivFmt = deliveryDate
    ? new Date(deliveryDate+'T00:00:00').toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'})
    : '';
  const msgHtml = note
    ? note.split('\n').map(l=>`<div style="margin-bottom:4px">${l||'&nbsp;'}</div>`).join('')
    : `<p style="margin:0">Great news! Your request has been <strong style="color:#16A34A">accepted</strong> and added to our task queue. We will begin working on it shortly.</p>`;

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Request Accepted</title></head>
<body style="margin:0;padding:0;background:#F4F6FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6FA;padding:40px 0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.12)">
  <!-- Header -->
  <tr><td style="background:linear-gradient(135deg,#14532D 0%,#15803D 50%,#16A34A 100%);padding:36px 40px">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td>
        <div style="font-size:10px;color:rgba(255,255,255,.6);text-transform:uppercase;letter-spacing:.12em;margin-bottom:14px">Aladdin Finance · Request Management</div>
        <table cellpadding="0" cellspacing="0"><tr>
          <td style="width:52px;height:52px;background:rgba(255,255,255,.2);border-radius:50%;text-align:center;vertical-align:middle">
            <span style="font-size:26px;color:#fff;line-height:52px;display:block;font-weight:700">✓</span>
          </td>
          <td style="padding-left:16px;vertical-align:middle">
            <div style="font-size:26px;font-weight:800;color:#fff;line-height:1.2">Request Accepted</div>
            <div style="font-size:11px;color:rgba(255,255,255,.65);margin-top:4px">${d}</div>
          </td>
        </tr></table>
      </td>
    </tr></table>
  </td></tr>
  <!-- Body -->
  <tr><td style="background:#fff;padding:32px 40px">
    <div style="font-size:14px;color:#374151;line-height:1.75;margin-bottom:24px">${msgHtml}</div>
    <!-- Request card -->
    <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:12px;padding:20px;margin-bottom:20px">
      <div style="font-size:10px;color:#15803D;text-transform:uppercase;letter-spacing:.1em;font-weight:700;margin-bottom:10px">Your Request</div>
      <div style="font-size:18px;font-weight:700;color:#14532D;margin-bottom:${r.details?'10px':'0'}">${r.subject}</div>
      ${r.details ? `<div style="font-size:13px;color:#166534;line-height:1.6;margin-bottom:10px;padding-top:10px;border-top:1px solid #BBF7D0">${r.details}</div>` : ''}
      ${delivFmt ? `
      <div style="margin-top:12px;padding-top:12px;border-top:1px solid #BBF7D0">
        <table cellpadding="0" cellspacing="0"><tr>
          <td style="width:36px;height:36px;background:linear-gradient(135deg,#14532D,#16A34A);border-radius:9px;text-align:center;vertical-align:middle">
            <span style="font-size:18px;line-height:36px;display:block">📅</span>
          </td>
          <td style="padding-left:12px;vertical-align:middle">
            <div style="font-size:9px;color:#15803D;text-transform:uppercase;letter-spacing:.08em;font-weight:700">Expected Delivery</div>
            <div style="font-size:14px;font-weight:800;color:#14532D;margin-top:2px">${delivFmt}</div>
          </td>
        </tr></table>
      </div>` : ''}
    </div>
    <p style="font-size:12px;color:#9CA3AF;margin:0;line-height:1.7">We will keep you informed about progress. If you have questions, please reach out to us directly. This message was automatically generated.</p>
  </td></tr>
  <!-- Footer -->
  <tr><td style="background:#0F1B2D;padding:18px 40px;text-align:center">
    <div style="font-size:13px;font-weight:700;color:#FF681A;margin-bottom:4px">Aladdin Finance</div>
    <div style="font-size:10px;color:rgba(255,255,255,.3)">Request Management System · ${new Date().getFullYear()}</div>
  </td></tr>
</table></td></tr></table></body></html>`;
}

function rejectEmail(r, reason, alternative) {
  const d = new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  const msgHtml = reason
    ? reason.split('\n').map(l=>`<div style="margin-bottom:4px">${l||'&nbsp;'}</div>`).join('')
    : `<p style="margin:0">Thank you for taking the time to submit your request. After careful review, we are unable to proceed with it at this time.</p>`;

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Request Update</title></head>
<body style="margin:0;padding:0;background:#F4F6FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6FA;padding:40px 0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.12)">
  <!-- Header -->
  <tr><td style="background:linear-gradient(135deg,#1F2937 0%,#374151 100%);padding:36px 40px">
    <div style="font-size:10px;color:rgba(255,255,255,.6);text-transform:uppercase;letter-spacing:.12em;margin-bottom:14px">Aladdin Finance · Request Management</div>
    <div style="font-size:26px;font-weight:800;color:#fff;margin-bottom:4px">Request Update</div>
    <div style="font-size:11px;color:rgba(255,255,255,.6)">${d}</div>
  </td></tr>
  <!-- Body -->
  <tr><td style="background:#fff;padding:32px 40px">
    <div style="font-size:14px;color:#374151;line-height:1.75;margin-bottom:24px">${msgHtml}</div>
    <!-- Request card -->
    <div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:12px;padding:20px;margin-bottom:${alternative?'16px':'20px'}">
      <div style="font-size:10px;color:#DC2626;text-transform:uppercase;letter-spacing:.1em;font-weight:700;margin-bottom:8px">Request</div>
      <div style="font-size:18px;font-weight:700;color:#7F1D1D">${r.subject}</div>
    </div>
    ${alternative ? `
    <div style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:12px;padding:20px;margin-bottom:20px">
      <div style="font-size:10px;color:#C2410C;text-transform:uppercase;letter-spacing:.1em;font-weight:700;margin-bottom:8px">💡 Suggestion</div>
      <div style="font-size:13px;color:#7C2D12;line-height:1.65">${alternative}</div>
    </div>` : ''}
    <p style="font-size:12px;color:#9CA3AF;margin:0;line-height:1.7">You are welcome to submit a revised request or contact us for more details. We appreciate your understanding.</p>
  </td></tr>
  <!-- Footer -->
  <tr><td style="background:#0F1B2D;padding:18px 40px;text-align:center">
    <div style="font-size:13px;font-weight:700;color:#FF681A;margin-bottom:4px">Aladdin Finance</div>
    <div style="font-size:10px;color:rgba(255,255,255,.3)">Request Management System · ${new Date().getFullYear()}</div>
  </td></tr>
</table></td></tr></table></body></html>`;
}

function adjustEmail(r, origin) {
  const d = new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  const respondUrl = `${origin}/request-respond/${r.respondToken}`;
  const changed = [];
  if (r.adjustedSubject  !== r.subject)  changed.push(`Subject changed to: <strong>${r.adjustedSubject}</strong>`);
  if (r.adjustedDetails  !== r.details)  changed.push(`Details updated`);
  if (r.adjustedDueDate  !== r.dueDate)  changed.push(`Due date changed to: <strong>${r.adjustedDueDate||'None'}</strong>`);
  if (r.adjustedPriority !== r.priority) changed.push(`Priority changed to: <strong>${r.adjustedPriority}</strong>`);
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Request Adjustment</title></head>
<body style="margin:0;padding:0;background:#0F1B2D;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0F1B2D;padding:40px 0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
  <tr><td style="background:linear-gradient(135deg,#1E3A8A 0%,#2563EB 100%);border-radius:16px 16px 0 0;padding:36px 40px">
    <div style="font-size:10px;color:rgba(255,255,255,.6);text-transform:uppercase;letter-spacing:.12em;margin-bottom:12px">Aladdin Finance · Request Management</div>
    <div style="font-size:28px;font-weight:800;color:#fff;margin-bottom:6px">Adjustment Proposal</div>
    <div style="font-size:12px;color:rgba(255,255,255,.65)">${d}</div>
  </td></tr>
  <tr><td style="background:#fff;padding:32px 40px">
    <p style="font-size:14px;color:#374151;line-height:1.7;margin:0 0 22px">We have reviewed your request and would like to propose some adjustments. Please review the changes below and let us know if you accept.</p>
    <div style="background:#F0F9FF;border:1px solid #BAE6FD;border-radius:12px;padding:20px;margin-bottom:20px">
      <div style="font-size:10px;color:#0369A1;text-transform:uppercase;letter-spacing:.1em;font-weight:700;margin-bottom:10px">Original Request</div>
      <div style="font-size:16px;font-weight:700;color:#0C4A6E;margin-bottom:6px">${r.subject}</div>
      ${r.details ? `<div style="font-size:12px;color:#0369A1;line-height:1.5">${r.details}</div>` : ''}
    </div>
    ${changed.length ? `<div style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:12px;padding:20px;margin-bottom:20px"><div style="font-size:10px;color:#C2410C;text-transform:uppercase;letter-spacing:.1em;font-weight:700;margin-bottom:10px">Proposed Changes</div>${changed.map(c=>`<div style="font-size:13px;color:#7C2D12;margin-bottom:6px">• ${c}</div>`).join('')}</div>` : ''}
    ${r.adjustNote ? `<div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:12px;padding:16px;margin-bottom:20px"><div style="font-size:10px;color:#1D4ED8;font-weight:700;text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px">Note from our team</div><div style="font-size:13px;color:#1E3A8A;line-height:1.6">${r.adjustNote}</div></div>` : ''}
    <div style="text-align:center;margin:28px 0 20px">
      <a href="${respondUrl}" style="display:inline-block;background:#2563EB;color:#fff;font-size:14px;font-weight:700;padding:14px 32px;border-radius:10px;text-decoration:none;letter-spacing:.02em">Review & Respond →</a>
    </div>
    <p style="font-size:12px;color:#9CA3AF;margin:0;line-height:1.6;text-align:center">Or copy this link: <span style="color:#2563EB">${respondUrl}</span></p>
  </td></tr>
  <tr><td style="background:#0F1B2D;border-radius:0 0 16px 16px;padding:18px 40px;text-align:center">
    <div style="font-size:13px;font-weight:700;color:#FF681A;margin-bottom:4px">Aladdin Finance</div>
    <div style="font-size:10px;color:rgba(255,255,255,.3)">Request Management System · ${new Date().getFullYear()}</div>
  </td></tr>
</table></td></tr></table></body></html>`;
}

module.exports = router;
module.exports.publicFormHandler     = publicFormHandler;
module.exports.publicSubmitHandler   = publicSubmitHandler;
module.exports.publicRespondHandler  = publicRespondHandler;
module.exports.publicRespondSubmitHandler = publicRespondSubmitHandler;

const router = require('express').Router();
const { load, save } = require('../data/store');
const { seed } = require('../data/seed');
const crypto = require('crypto');
const mailer = require('../lib/mailer');

function get() { return load('tasks.json', seed().tasks); }
function set(d) { save('tasks.json', d); }

router.get('/', (req, res) => {
  const tasks = get();
  let changed = false;
  tasks.forEach(t => { if (!t.completionToken) { t.completionToken = crypto.randomBytes(16).toString('hex'); changed = true; } });
  if (changed) set(tasks);
  res.json(tasks);
});

router.post('/', (req, res) => {
  const { title, due, deadline, priority, taskType, ceoNote, remindDays, recurring, recurringInterval, notifyEmail } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });
  const tasks = get();
  const task = {
    id: Date.now(),
    title,
    due: due || (deadline ? new Date(deadline+'T00:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : '—'),
    deadline: deadline || null,
    priority: priority || 'medium',
    done: false,
    taskType: taskType || 'task',
    ceoNote: ceoNote || '',
    remindDays: remindDays ? Number(remindDays) : 3,
    recurring: !!recurring,
    recurringInterval: recurringInterval || 'weekly',
    notifyEmail: notifyEmail || '',
    completionToken: crypto.randomBytes(16).toString('hex'),
    lastReminderSent: null,
    createdAt: new Date().toISOString()
  };
  tasks.unshift(task);
  set(tasks);
  res.json({ task });
});

router.patch('/:id', (req, res) => {
  const tasks = get();
  const task = tasks.find(t => t.id === Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'Not found' });
  Object.assign(task, req.body);
  set(tasks);
  res.json({ task });
});

router.delete('/:id', (req, res) => {
  set(get().filter(t => t.id !== Number(req.params.id)));
  res.json({ ok: true });
});

// ── Task Completion Notification Email ───────────────────────────────────────
function buildCompletionEmailHtml(task, message) {
  const completedDate = task.doneAt
    ? new Date(task.doneAt).toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric', timeZone:'Asia/Dubai' })
    : new Date().toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric', timeZone:'Asia/Dubai' });
  const deadlineText = task.deadline
    ? new Date(task.deadline + 'T00:00:00').toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })
    : '—';
  const msgHtml = (message || '').split('\n').filter(Boolean).map(l => `<div style="margin-bottom:6px">${l}</div>`).join('') ||
    `<div>We are pleased to confirm that the above task has been successfully completed. Please review the details below.</div>`;
  const PRIO_COLOR = { high: '#DC2626', medium: '#D97706', low: '#6B7280' };
  const prioColor = PRIO_COLOR[task.priority] || '#6B7280';

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F0F4F8;font-family:'Segoe UI',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F0F4F8;padding:32px 16px">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%">

        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#0D9488,#059669);border-radius:14px 14px 0 0;padding:36px 36px 28px;text-align:center">
          <div style="width:68px;height:68px;background:rgba(255,255,255,.15);border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;font-size:32px;line-height:68px">✅</div>
          <div style="font-size:26px;font-weight:800;color:#fff;margin-bottom:6px">Task Completed</div>
          <div style="font-size:12px;color:rgba(255,255,255,.7);letter-spacing:.04em">${completedDate}</div>
        </td></tr>

        <!-- Body -->
        <tr><td style="background:#fff;padding:32px 36px">

          <!-- Greeting message -->
          <div style="font-size:13px;color:#374151;line-height:1.75;margin-bottom:24px">${msgHtml}</div>

          <!-- Task card -->
          <div style="background:#F0FDF4;border:1px solid #86EFAC;border-radius:12px;padding:20px 22px;margin-bottom:20px">
            <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#16A34A;margin-bottom:10px">Completed Task</div>
            <div style="font-size:17px;font-weight:700;color:#14532D;line-height:1.4;margin-bottom:14px">${task.title || ''}</div>
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="width:50%;vertical-align:top;padding-right:12px">
                  <div style="font-size:9px;color:#6B7280;text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px">Deadline</div>
                  <div style="font-size:12px;font-weight:600;color:#1F2937">📅 ${deadlineText}</div>
                </td>
                <td style="width:50%;vertical-align:top">
                  <div style="font-size:9px;color:#6B7280;text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px">Priority</div>
                  <div style="font-size:12px;font-weight:700;color:${prioColor};text-transform:capitalize">● ${task.priority || 'medium'}</div>
                </td>
              </tr>
            </table>
          </div>

          <!-- Status bar -->
          <div style="background:#ECFDF5;border-radius:8px;padding:12px 16px;display:flex;align-items:center;gap:10px;margin-bottom:24px">
            <div style="width:8px;height:8px;background:#16A34A;border-radius:50%;flex-shrink:0"></div>
            <div style="font-size:12px;color:#166534;font-weight:600">Status: Completed on ${completedDate}</div>
          </div>

          <div style="font-size:11px;color:#9CA3AF;line-height:1.6;border-top:1px solid #F3F4F6;padding-top:18px">
            This is an automated notification from the Aladdin Finance CFO platform. No action is required on your part.
          </div>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#0F1B2D;border-radius:0 0 14px 14px;padding:18px 36px;text-align:center">
          <div style="font-size:13px;font-weight:800;color:#FF681A;margin-bottom:4px">Aladdin Finance</div>
          <div style="font-size:10px;color:rgba(255,255,255,.35)">CFO Command Center · Task Management · ${new Date().getFullYear()}</div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

router.post('/:id/notify-complete', async (req, res) => {
  const tasks = get();
  const task = tasks.find(t => t.id === Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'Not found' });
  const toEmail = req.body.toEmail || task.notifyEmail;
  if (!toEmail) return res.status(400).json({ error: 'No notification email set for this task' });
  if (!mailer.isConfigured()) return res.status(503).json({ error: 'Email not configured — connect Gmail in Settings' });
  const subject = req.body.customSubject || `✅ Task Completed: ${task.title}`;
  const html = buildCompletionEmailHtml(task, req.body.message || '');
  try {
    await mailer.sendMail({ to: toEmail, subject, html });
    task.completionNotifiedAt = new Date().toISOString();
    set(tasks);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Future Notes (shared notepad) ────────────────────────────────────────────
function getNotes() { return load('task-notes.json', { content: '', updatedAt: null }); }
function setNotes(d) { save('task-notes.json', d); }

router.get('/notes', (req, res) => {
  res.json(getNotes());
});

router.post('/notes', (req, res) => {
  const { content } = req.body;
  if (typeof content !== 'string') return res.status(400).json({ error: 'content required' });
  const notes = { content, updatedAt: new Date().toISOString() };
  setNotes(notes);
  res.json(notes);
});

// Complete CEO task via token link (no auth required — called from email link)
const completeByToken = (req, res) => {
  const tasks = get();
  const task = tasks.find(t => t.completionToken === req.params.token);
  if (!task) return res.status(404).send('<html><body style="font-family:sans-serif;padding:40px;text-align:center"><h2>Link expired or invalid</h2></body></html>');
  task.done = true;
  task.doneAt = new Date().toISOString();
  set(tasks);
  res.send(`<!DOCTYPE html><html><head><title>Task Done</title></head>
  <body style="font-family:sans-serif;background:#EDF0F5;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column">
    <div style="background:#fff;border-radius:14px;padding:40px 50px;box-shadow:0 4px 20px rgba(0,0,0,.1);text-align:center">
      <div style="font-size:56px;margin-bottom:16px">✅</div>
      <h2 style="color:#16A34A;margin:0 0 8px;font-size:22px">Task Marked as Done</h2>
      <p style="color:#5E6C84;margin:0 0 20px">"${task.title}"</p>
      <a href="/" style="background:#FF681A;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">Open CFO Genie</a>
    </div>
  </body></html>`);
};
router.get('/complete-by-token/:token', completeByToken);

module.exports = router;
module.exports.completeByToken = completeByToken;

const router  = require('express').Router();
const crypto  = require('crypto');
const bcrypt  = require('bcryptjs');
const { load, save } = require('../data/store');
const { seed }       = require('../data/seed');
const mailer         = require('../lib/mailer');

const EMP_FILE = 'hr-employees.json';
const CFG_FILE = 'hr-settings.json';
const TOF_FILE = 'hr-timeoff.json';

function getEmps()  { return load(EMP_FILE, seed().hrEmployees || []); }
function setEmps(d) { save(EMP_FILE, d); }
function getCfg()   { return load(CFG_FILE, seed().hrSettings  || defaultSettings()); }
function setCfg(d)  { save(CFG_FILE, d); }
function getTOff()  { return load(TOF_FILE, []); }
function setTOff(d) { save(TOF_FILE, d); }

function defaultSettings() {
  return {
    departments: ['Engineering','Sales','Finance','Operations','Marketing','Legal','HR'],
    positions:   ['CEO','CFO','CPO','HR Manager','Sales Manager','Software Engineer','Operations Manager','Marketing Specialist','Legal Counsel','Finance Analyst'],
    employmentTypes: ['Full-time','Part-time','Contractor','Intern'],
    leaveTypes: [
      { id:'annual',    name:'Annual Leave',    defaultDays:30, color:'#2563EB' },
      { id:'sick',      name:'Sick Leave',      defaultDays:15, color:'#DC2626' },
      { id:'emergency', name:'Emergency Leave', defaultDays:3,  color:'#D97706' },
      { id:'unpaid',    name:'Unpaid Leave',    defaultDays:0,  color:'#6B7280' }
    ],
    portalEnabled: true,
    hrEmail: '',
    financeEmail: '',
    defaultOnboardingTasks: [
      { title:'Send offer letter & welcome email',        owner:'HR',      category:'Pre-Hire' },
      { title:'Setup laptop, email & system access',      owner:'IT',      category:'Day 1'   },
      { title:'Office tour & team introductions',         owner:'Manager', category:'Day 1'   },
      { title:'Complete employment contract & visa docs', owner:'HR',      category:'Day 1'   },
      { title:'Enroll in payroll & benefits',             owner:'Finance', category:'Week 1'  },
      { title:'Assign buddy / mentor',                    owner:'Manager', category:'Week 1'  },
      { title:'30-day check-in with manager',             owner:'Manager', category:'Month 1' },
      { title:'Complete compliance & safety training',    owner:'HR',      category:'Month 1' },
      { title:'90-day probation review',                  owner:'HR',      category:'Month 3' }
    ],
    companyPolicy: `Welcome to Aladdin Finance. These are the key policies for all team members:\n\n1. WORKING HOURS\nStandard hours are Sunday–Thursday, 9:00 AM–6:00 PM (UAE time). Fridays and Saturdays are weekends.\n\n2. LEAVE POLICY\nAnnual leave must be requested at least 5 working days in advance. Sick leave requires a medical certificate for absences of 3 or more consecutive days. Emergency leave of up to 3 days may be taken without prior approval.\n\n3. REMOTE WORK\nRemote work requests must be approved by your direct manager. Up to 2 days per week may be permitted depending on role requirements.\n\n4. CODE OF CONDUCT\nAll employees are expected to maintain professional standards, respect colleagues, and protect confidential company and client information at all times.\n\n5. REQUESTS & EXPENSES\nAll purchase requests and expense reimbursements must be submitted through the official portal and approved before commitment.`
  };
}

// ── Settings (must be before /:id to avoid param capture) ─────────────────────
router.get('/settings', (req, res) => res.json(getCfg()));
router.put('/settings', (req, res) => {
  setCfg({ ...getCfg(), ...req.body });
  res.json({ ok: true });
});

// ── Employees ─────────────────────────────────────────────────────────────────
router.get('/', (req, res) => res.json(getEmps()));

router.post('/', (req, res) => {
  const emps = getEmps();
  const emp  = buildEmp(req.body);
  emps.push(emp);
  setEmps(emps);
  res.json({ employee: emp });
});

router.put('/:id', (req, res) => {
  const emps = getEmps();
  const i    = emps.findIndex(e => e.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  emps[i] = { ...emps[i], ...req.body, id: emps[i].id };
  setEmps(emps);
  res.json({ employee: emps[i] });
});

router.delete('/:id', (req, res) => {
  setEmps(getEmps().filter(e => e.id !== Number(req.params.id)));
  res.json({ ok: true });
});

// ── Time Off ──────────────────────────────────────────────────────────────────
router.get('/time-off', (req, res) => res.json(getTOff()));

router.post('/time-off', (req, res) => {
  const items = getTOff();
  const { employeeId, type, startDate, endDate, days, reason } = req.body;
  const item = {
    id: Date.now(), employeeId: Number(employeeId), type,
    startDate, endDate, days: Number(days) || 1, reason: reason || '',
    status: 'pending', submittedAt: new Date().toISOString(),
    approvedBy: '', approvedAt: null, approvalNote: '',
    rejectedAt: null, rejectionReason: ''
  };
  items.push(item);
  setTOff(items);
  // Notify HR
  const cfg = getCfg();
  const emps = getEmps();
  const emp  = emps.find(e => e.id === Number(employeeId));
  if (cfg.hrEmail && emp && mailer.isConfigured()) {
    mailer.sendMail({
      to: cfg.hrEmail,
      subject: `[Leave Request] ${emp.firstName} ${emp.lastName} — ${type} leave`,
      html: hrTimeOffNotifyEmail(emp, item)
    }).catch(e => console.error('HR time-off notify:', e.message));
  }
  res.json({ request: item });
});

router.put('/time-off/:id/approve', async (req, res) => {
  const items = getTOff();
  const i = items.findIndex(x => x.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  const { approvedBy, note, customSubject } = req.body;
  items[i] = { ...items[i], status: 'approved', approvedBy: approvedBy || 'HR', approvedAt: new Date().toISOString(), approvalNote: note || '' };
  setTOff(items);
  const emps = getEmps();
  const ei = emps.findIndex(e => e.id === items[i].employeeId);
  if (ei > -1) {
    const bal = emps[ei].leaveBalances || {};
    const lt  = items[i].type;
    if (bal[lt] !== undefined) bal[lt] = Math.max(0, bal[lt] - items[i].days);
    emps[ei].leaveBalances = bal;
    setEmps(emps);
  }
  const emp = emps.find(e => e.id === items[i].employeeId);
  if (emp?.email && mailer.isConfigured()) {
    mailer.sendMail({
      to: emp.email,
      subject: customSubject || `Leave Approved: ${items[i].type} leave`,
      html: leaveApprovedEmail(emp, items[i], note || '')
    }).catch(e => console.error('HR approve email:', e.message));
  }
  res.json({ ok: true });
});

router.put('/time-off/:id/reject', async (req, res) => {
  const items = getTOff();
  const i = items.findIndex(x => x.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  const { reason, customSubject } = req.body;
  items[i] = { ...items[i], status: 'rejected', rejectedAt: new Date().toISOString(), rejectionReason: reason || '' };
  setTOff(items);
  const emps = getEmps();
  const emp  = emps.find(e => e.id === items[i].employeeId);
  if (emp?.email && mailer.isConfigured()) {
    mailer.sendMail({
      to: emp.email,
      subject: customSubject || `Leave Request Update: ${items[i].type} leave`,
      html: leaveRejectedEmail(emp, items[i], reason || '')
    }).catch(e => console.error('HR reject email:', e.message));
  }
  res.json({ ok: true });
});

router.delete('/time-off/:id', (req, res) => {
  setTOff(getTOff().filter(x => x.id !== Number(req.params.id)));
  res.json({ ok: true });
});

// ── Employee Portal — Send Invite (authenticated) ─────────────────────────────
router.post('/:id/send-invite', async (req, res) => {
  const emps = getEmps();
  const i    = emps.findIndex(e => e.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  const token = crypto.randomBytes(24).toString('hex');
  emps[i].portalToken    = token;
  emps[i].portalPassword = null; // reset so employee must set a new password
  setEmps(emps);
  const emp  = emps[i];
  const host = `${req.protocol}://${req.get('host')}`;
  const url  = `${host}/employee-portal/${token}`;
  const cfg  = getCfg();
  if (emp.email && mailer.isConfigured()) {
    mailer.sendMail({
      to: emp.email,
      subject: 'Your Aladdin Finance Employee Portal Invitation',
      html: portalInviteEmail(emp, url, cfg.companyPolicy || '')
    }).catch(e => console.error('HR portal invite email:', e.message));
  }
  res.json({ ok: true, token, url });
});

// ── Onboarding ────────────────────────────────────────────────────────────────
router.post('/:id/start-onboarding', (req, res) => {
  const emps = getEmps();
  const i    = emps.findIndex(e => e.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  const cfg   = getCfg();
  const tmpl  = cfg.defaultOnboardingTasks || defaultOnboardingTasks();
  const tasks = (req.body.tasks || tmpl).map((t, idx) => ({ ...t, id: idx + 1, done: false, doneAt: null }));
  emps[i].onboarding = { startedAt: new Date().toISOString(), completedAt: null, tasks };
  setEmps(emps);
  res.json({ ok: true, onboarding: emps[i].onboarding });
});

router.patch('/:id/onboarding/:tid', (req, res) => {
  const emps = getEmps();
  const i    = emps.findIndex(e => e.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  const task = (emps[i].onboarding?.tasks || []).find(t => t.id === Number(req.params.tid));
  if (task) { Object.assign(task, req.body); if (req.body.done) task.doneAt = new Date().toISOString(); }
  const allDone = (emps[i].onboarding?.tasks || []).every(t => t.done);
  if (allDone && emps[i].onboarding && !emps[i].onboarding.completedAt)
    emps[i].onboarding.completedAt = new Date().toISOString();
  setEmps(emps);
  res.json({ ok: true });
});

router.post('/:id/onboarding/task', (req, res) => {
  const emps = getEmps();
  const i    = emps.findIndex(e => e.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  if (!emps[i].onboarding) return res.status(400).json({ error: 'Onboarding not started' });
  const tasks  = emps[i].onboarding.tasks || [];
  const newId  = (tasks.reduce((m,t) => Math.max(m, t.id||0), 0)) + 1;
  const task   = { id: newId, title: req.body.title || 'New Task', category: req.body.category || 'General', owner: req.body.owner || 'HR', done: false, doneAt: null };
  tasks.push(task);
  emps[i].onboarding.tasks = tasks;
  if (emps[i].onboarding.completedAt) emps[i].onboarding.completedAt = null;
  setEmps(emps);
  res.json({ ok: true, task, onboarding: emps[i].onboarding });
});

router.delete('/:id/onboarding/:tid', (req, res) => {
  const emps = getEmps();
  const i    = emps.findIndex(e => e.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  if (!emps[i].onboarding) return res.status(400).json({ error: 'No onboarding' });
  emps[i].onboarding.tasks = (emps[i].onboarding.tasks || []).filter(t => t.id !== Number(req.params.tid));
  setEmps(emps);
  res.json({ ok: true });
});

router.post('/:id/terminate', (req, res) => {
  const emps = getEmps();
  const i    = emps.findIndex(e => e.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  const { type, date, reason, lastWorkingDay, noticePeriod, rehireEligible } = req.body;
  emps[i].status          = type === 'resignation' ? 'terminated' : 'terminated';
  emps[i].terminationType = type || 'terminated';
  emps[i].terminationDate = date || new Date().toISOString().slice(0,10);
  emps[i].lastWorkingDay  = lastWorkingDay || date || '';
  emps[i].terminationReason  = reason   || '';
  emps[i].noticePeriod       = noticePeriod || '';
  emps[i].rehireEligible     = rehireEligible !== undefined ? rehireEligible : true;
  setEmps(emps);
  res.json({ employee: emps[i] });
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function buildEmp(body) {
  const cfg = getCfg();
  const bal = {};
  (cfg.leaveTypes || []).forEach(lt => { bal[lt.id] = lt.defaultDays; });
  return {
    id:              Date.now(),
    firstName:       body.firstName       || '',
    lastName:        body.lastName        || '',
    email:           body.email           || '',
    phone:           body.phone           || '',
    nationality:     body.nationality     || '',
    dob:             body.dob             || '',
    gender:          body.gender          || '',
    employeeId:      body.employeeId      || `EMP-${String(Date.now()).slice(-4)}`,
    department:      body.department      || '',
    position:        body.position        || '',
    type:            body.type            || 'full-time',
    status:          body.status          || 'active',
    startDate:       body.startDate       || '',
    managerId:       body.managerId ? Number(body.managerId) : null,
    salary:          Number(body.salary)  || 0,
    currency:        body.currency        || 'AED',
    salaryFrequency: body.salaryFrequency || 'monthly',
    hoursPerMonth:   Number(body.hoursPerMonth || body.hoursPerWeek) || 0,
    ratePerHour:     Number(body.ratePerHour) || 0,
    leaveBalances:   bal,
    onboarding:      null,
    portalToken:     null,
    portalPassword:  null,
    notes:           body.notes           || '',
    createdAt:       new Date().toISOString()
  };
}

function defaultOnboardingTasks() {
  return [
    { title:'Send offer letter & welcome email',        owner:'HR',      category:'Pre-Hire' },
    { title:'Setup laptop, email & system access',      owner:'IT',      category:'Day 1'   },
    { title:'Office tour & team introductions',         owner:'Manager', category:'Day 1'   },
    { title:'Complete employment contract & visa docs', owner:'HR',      category:'Day 1'   },
    { title:'Enroll in payroll & benefits',             owner:'Finance', category:'Week 1'  },
    { title:'Assign buddy / mentor',                    owner:'Manager', category:'Week 1'  },
    { title:'30-day check-in with manager',             owner:'Manager', category:'Month 1' },
    { title:'Complete compliance & safety training',    owner:'HR',      category:'Month 1' },
    { title:'90-day probation review',                  owner:'HR',      category:'Month 3' }
  ];
}

// ── Public Portal Handlers (registered in server.js before auth) ──────────────
function portalGetHandler(req, res) {
  const emp = getEmps().find(e => e.portalToken === req.params.token);
  if (!emp) return res.status(404).json({ error: 'Invalid or expired portal link' });
  const cfg = getCfg();
  res.json({
    employee: {
      id: emp.id, firstName: emp.firstName, lastName: emp.lastName,
      email: emp.email, position: emp.position, department: emp.department,
      employeeId: emp.employeeId, leaveBalances: emp.leaveBalances || {}
    },
    leaveTypes:    cfg.leaveTypes    || [],
    policy:        cfg.companyPolicy || '',
    portalEnabled: cfg.portalEnabled !== false,
    passwordSet:   !!emp.portalPassword
  });
}

function portalSetPasswordHandler(req, res) {
  const emps = getEmps();
  const i    = emps.findIndex(e => e.portalToken === req.params.token);
  if (i === -1) return res.status(404).json({ error: 'Invalid or expired portal link' });
  const { password } = req.body;
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  emps[i].portalPassword = bcrypt.hashSync(password, 10);
  setEmps(emps);
  res.json({ ok: true });
}

function portalLoginHandler(req, res) {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const emp = getEmps().find(e => e.email && e.email.toLowerCase() === email.toLowerCase());
  if (!emp) return res.status(401).json({ error: 'No account found for this email address.' });
  if (!emp.portalToken) return res.status(401).json({ error: 'Your portal invite has not been sent yet. Please contact HR.' });
  if (!emp.portalPassword) return res.status(401).json({ error: 'You have not set a password yet. Please open the invite link sent to your email and set your password first.' });
  if (!bcrypt.compareSync(password, emp.portalPassword)) {
    return res.status(401).json({ error: 'Incorrect password. Please try again.' });
  }
  res.json({ ok: true, token: emp.portalToken });
}

function portalTimeOffHandler(req, res) {
  const emp = getEmps().find(e => e.portalToken === req.params.token);
  if (!emp) return res.status(404).json({ error: 'Invalid or expired portal link' });
  const { type, startDate, endDate, days, reason } = req.body;
  if (!type || !startDate || !endDate) return res.status(400).json({ error: 'type, startDate, and endDate are required' });
  const items = getTOff();
  const item  = {
    id: Date.now(), employeeId: emp.id, type,
    startDate, endDate, days: Number(days) || 1, reason: reason || '',
    status: 'pending', submittedAt: new Date().toISOString(),
    approvedBy: '', approvedAt: null, approvalNote: '',
    rejectedAt: null, rejectionReason: ''
  };
  items.push(item);
  setTOff(items);
  const cfg = getCfg();
  if (cfg.hrEmail && mailer.isConfigured()) {
    mailer.sendMail({
      to: cfg.hrEmail,
      subject: `[Leave Request] ${emp.firstName} ${emp.lastName} — ${type} leave (${days} day${days!=1?'s':''})`,
      html: hrTimeOffNotifyEmail(emp, item)
    }).catch(e => console.error('HR notify:', e.message));
  }
  if (emp.email && mailer.isConfigured()) {
    mailer.sendMail({
      to: emp.email,
      subject: `Leave Request Received — ${type} leave`,
      html: employeeLeaveReceivedEmail(emp, item)
    }).catch(e => console.error('employee confirm:', e.message));
  }
  res.json({ ok: true, request: item });
}

function portalRequestHandler(req, res) {
  const emp = getEmps().find(e => e.portalToken === req.params.token);
  if (!emp) return res.status(404).json({ error: 'Invalid or expired portal link' });
  const { subject, body, priority, routeTo } = req.body;
  if (!subject) return res.status(400).json({ error: 'Subject is required' });
  const route = routeTo === 'finance' ? 'finance' : 'hr';

  const reqsFile = 'requests.json';
  let reqs = [];
  try { reqs = load(reqsFile, []); } catch(e) { reqs = []; }
  const item = {
    id: Date.now(), subject, body: body || '',
    priority: priority || 'medium', routeTo: route,
    email: emp.email, name: `${emp.firstName} ${emp.lastName}`,
    employeeId: emp.id, status: 'pending',
    note: '', deliveryDate: '', rejectionReason: '',
    submittedAt: new Date().toISOString()
  };
  reqs.push(item);
  try { save(reqsFile, reqs); } catch(e) { console.error('portal request save:', e.message); }

  const cfg       = getCfg();
  const toEmail   = route === 'finance' ? (cfg.financeEmail || cfg.hrEmail) : cfg.hrEmail;
  const deptLabel = route === 'finance' ? 'Finance' : 'HR';
  if (toEmail && mailer.isConfigured()) {
    mailer.sendMail({
      to: toEmail,
      subject: `[${deptLabel} Request] ${subject} — ${emp.firstName} ${emp.lastName}`,
      html: hrRequestNotifyEmail(emp, item, deptLabel)
    }).catch(e => console.error('request notify:', e.message));
  }
  if (emp.email && mailer.isConfigured()) {
    mailer.sendMail({
      to: emp.email,
      subject: `Request Received: ${subject}`,
      html: employeeRequestConfirmEmail(emp, item, deptLabel)
    }).catch(e => console.error('emp request confirm:', e.message));
  }
  res.json({ ok: true, request: item });
}

// ── Email Templates ───────────────────────────────────────────────────────────
const FOOTER = (year = new Date().getFullYear()) =>
  `<tr><td style="background:#0F1B2D;padding:18px 40px;text-align:center"><div style="font-size:13px;font-weight:700;color:#FF681A;margin-bottom:4px">Aladdin Finance</div><div style="font-size:10px;color:rgba(255,255,255,.3)">HR Department · ${year}</div></td></tr>`;

function leaveApprovedEmail(emp, req, note) {
  const name = `${emp.firstName} ${emp.lastName}`;
  const d    = new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  const s    = new Date(req.startDate+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  const e2   = new Date(req.endDate  +'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  const COL  = {annual:'#2563EB',sick:'#DC2626',emergency:'#D97706',unpaid:'#6B7280'};
  const col  = COL[req.type] || '#2563EB';
  const msg  = note ? note.split('\n').map(l=>`<div style="margin-bottom:4px">${l||'&nbsp;'}</div>`).join('') : `<p style="margin:0">Your <strong>${req.type} leave</strong> has been <strong style="color:#16A34A">approved</strong>. Enjoy your time off!</p>`;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#F4F6FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6FA;padding:40px 0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.12)">
  <tr><td style="background:linear-gradient(135deg,#14532D 0%,#16A34A 100%);padding:36px 40px">
    <div style="font-size:10px;color:rgba(255,255,255,.6);text-transform:uppercase;letter-spacing:.12em;margin-bottom:12px">Aladdin Finance · HR</div>
    <div style="font-size:24px;font-weight:800;color:#fff">✅ Leave Approved</div>
    <div style="font-size:11px;color:rgba(255,255,255,.65);margin-top:4px">${d}</div>
  </td></tr>
  <tr><td style="background:#fff;padding:32px 40px">
    <div style="font-size:14px;color:#374151;line-height:1.75;margin-bottom:20px">Dear <strong>${name}</strong>,</div>
    <div style="font-size:14px;color:#374151;line-height:1.75;margin-bottom:24px">${msg}</div>
    <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:12px;padding:20px;margin-bottom:16px">
      <div style="font-size:10px;color:#15803D;text-transform:uppercase;letter-spacing:.1em;font-weight:700;margin-bottom:12px">Leave Details</div>
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="width:50%;padding-right:12px;vertical-align:top"><div style="font-size:9px;color:#6B7280;text-transform:uppercase;letter-spacing:.07em;margin-bottom:3px">Type</div><div style="font-size:13px;font-weight:700;color:${col};text-transform:capitalize">${req.type} Leave</div></td>
        <td style="width:50%;vertical-align:top"><div style="font-size:9px;color:#6B7280;text-transform:uppercase;letter-spacing:.07em;margin-bottom:3px">Duration</div><div style="font-size:13px;font-weight:700;color:#1F2937">${req.days} day${req.days!==1?'s':''}</div></td>
      </tr><tr><td colspan="2" style="padding-top:12px"><div style="font-size:9px;color:#6B7280;text-transform:uppercase;letter-spacing:.07em;margin-bottom:3px">Period</div><div style="font-size:13px;font-weight:700;color:#1F2937">📅 ${s} → ${e2}</div></td></tr></table>
    </div>
    <p style="font-size:12px;color:#9CA3AF;margin:0;line-height:1.7">Please plan your handover before your leave starts.</p>
  </td></tr>${FOOTER()}</table></td></tr></table></body></html>`;
}

function leaveRejectedEmail(emp, req, reason) {
  const name = `${emp.firstName} ${emp.lastName}`;
  const d    = new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  const s    = new Date(req.startDate+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  const e2   = new Date(req.endDate  +'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  const msg  = reason ? reason.split('\n').map(l=>`<div style="margin-bottom:4px">${l||'&nbsp;'}</div>`).join('') : `<p style="margin:0">After careful review, we are unable to approve your leave request at this time. Please contact HR to discuss alternatives.</p>`;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#F4F6FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6FA;padding:40px 0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.12)">
  <tr><td style="background:linear-gradient(135deg,#1F2937 0%,#374151 100%);padding:36px 40px">
    <div style="font-size:10px;color:rgba(255,255,255,.6);text-transform:uppercase;letter-spacing:.12em;margin-bottom:12px">Aladdin Finance · HR</div>
    <div style="font-size:24px;font-weight:800;color:#fff">Leave Request Update</div>
    <div style="font-size:11px;color:rgba(255,255,255,.6);margin-top:4px">${d}</div>
  </td></tr>
  <tr><td style="background:#fff;padding:32px 40px">
    <div style="font-size:14px;color:#374151;line-height:1.75;margin-bottom:16px">Dear <strong>${name}</strong>,</div>
    <div style="font-size:14px;color:#374151;line-height:1.75;margin-bottom:24px">${msg}</div>
    <div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:12px;padding:20px;margin-bottom:16px">
      <div style="font-size:10px;color:#DC2626;text-transform:uppercase;letter-spacing:.1em;font-weight:700;margin-bottom:10px">Leave Request</div>
      <div style="font-size:13px;font-weight:700;color:#7F1D1D;text-transform:capitalize;margin-bottom:6px">${req.type} Leave · ${req.days} day${req.days!==1?'s':''}</div>
      <div style="font-size:12px;color:#991B1B">📅 ${s} → ${e2}</div>
    </div>
    <p style="font-size:12px;color:#9CA3AF;margin:0;line-height:1.7">You are welcome to submit a new request for alternative dates.</p>
  </td></tr>${FOOTER()}</table></td></tr></table></body></html>`;
}

function hrTimeOffNotifyEmail(emp, req) {
  const name = `${emp.firstName} ${emp.lastName}`;
  const d    = new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  const s    = new Date(req.startDate+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  const e2   = new Date(req.endDate  +'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  const COL  = {annual:'#2563EB',sick:'#DC2626',emergency:'#D97706',unpaid:'#6B7280'};
  const col  = COL[req.type] || '#2563EB';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#F4F6FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6FA;padding:40px 0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.12)">
  <tr><td style="background:linear-gradient(135deg,#1E3A5F 0%,#2563EB 100%);padding:36px 40px">
    <div style="font-size:10px;color:rgba(255,255,255,.6);text-transform:uppercase;letter-spacing:.12em;margin-bottom:12px">Aladdin Finance · HR Notification</div>
    <div style="font-size:24px;font-weight:800;color:#fff">🗓 New Leave Request</div>
    <div style="font-size:11px;color:rgba(255,255,255,.65);margin-top:4px">${d}</div>
  </td></tr>
  <tr><td style="background:#fff;padding:32px 40px">
    <div style="font-size:14px;color:#374151;line-height:1.75;margin-bottom:24px"><strong>${name}</strong> (${emp.department||'—'} · ${emp.position||'—'}) has submitted a leave request that requires your review.</div>
    <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:12px;padding:20px;margin-bottom:20px">
      <div style="font-size:10px;color:#1D4ED8;text-transform:uppercase;letter-spacing:.1em;font-weight:700;margin-bottom:12px">Request Details</div>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="width:50%;padding-right:12px;vertical-align:top"><div style="font-size:9px;color:#6B7280;text-transform:uppercase;letter-spacing:.07em;margin-bottom:3px">Type</div><div style="font-size:14px;font-weight:700;color:${col};text-transform:capitalize">${req.type} Leave</div></td>
          <td style="width:50%;vertical-align:top"><div style="font-size:9px;color:#6B7280;text-transform:uppercase;letter-spacing:.07em;margin-bottom:3px">Duration</div><div style="font-size:14px;font-weight:700;color:#1F2937">${req.days} working day${req.days!==1?'s':''}</div></td>
        </tr>
        <tr><td colspan="2" style="padding-top:12px"><div style="font-size:9px;color:#6B7280;text-transform:uppercase;letter-spacing:.07em;margin-bottom:3px">Period</div><div style="font-size:13px;font-weight:700;color:#1F2937">📅 ${s} → ${e2}</div></td></tr>
        ${req.reason ? `<tr><td colspan="2" style="padding-top:12px"><div style="font-size:9px;color:#6B7280;text-transform:uppercase;letter-spacing:.07em;margin-bottom:3px">Reason</div><div style="font-size:13px;color:#374151">${req.reason}</div></td></tr>` : ''}
      </table>
    </div>
    <p style="font-size:12px;color:#9CA3AF;margin:0;line-height:1.7">Please log into the HR dashboard to approve or reject this request.</p>
  </td></tr>${FOOTER()}</table></td></tr></table></body></html>`;
}

function hrRequestNotifyEmail(emp, req, deptLabel) {
  const name = `${emp.firstName} ${emp.lastName}`;
  const d    = new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  const PRIO = {high:'#DC2626',medium:'#D97706',low:'#6B7280'};
  const prioCol = PRIO[req.priority] || '#6B7280';
  const isFinance = deptLabel === 'Finance';
  const hdr = isFinance ? 'linear-gradient(135deg,#14532D 0%,#16A34A 100%)' : 'linear-gradient(135deg,#4F1D96 0%,#7C3AED 100%)';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#F4F6FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6FA;padding:40px 0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.12)">
  <tr><td style="background:${hdr};padding:36px 40px">
    <div style="font-size:10px;color:rgba(255,255,255,.6);text-transform:uppercase;letter-spacing:.12em;margin-bottom:12px">Aladdin Finance · ${deptLabel} Notification</div>
    <div style="font-size:24px;font-weight:800;color:#fff">📋 New ${deptLabel} Request</div>
    <div style="font-size:11px;color:rgba(255,255,255,.65);margin-top:4px">${d}</div>
  </td></tr>
  <tr><td style="background:#fff;padding:32px 40px">
    <div style="font-size:14px;color:#374151;line-height:1.75;margin-bottom:24px"><strong>${name}</strong> (${emp.department||'—'} · ${emp.position||'—'}) has submitted a request to the ${deptLabel} team.</div>
    <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:12px;padding:20px;margin-bottom:16px">
      <div style="font-size:10px;color:#6B7280;text-transform:uppercase;letter-spacing:.1em;font-weight:700;margin-bottom:12px">Request Details</div>
      <div style="font-size:15px;font-weight:700;color:#111827;margin-bottom:8px">${req.subject}</div>
      <div style="display:inline-block;font-size:10px;font-weight:700;color:${prioCol};background:rgba(${req.priority==='high'?'220,38,38':req.priority==='medium'?'217,119,6':'107,114,128'},.1);padding:3px 9px;border-radius:6px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:12px">${req.priority} priority</div>
      ${req.body ? `<div style="font-size:13px;color:#374151;line-height:1.65;border-top:1px solid #F3F4F6;padding-top:12px;margin-top:4px">${req.body}</div>` : ''}
    </div>
    <p style="font-size:12px;color:#9CA3AF;margin:0;line-height:1.7">Please log into the dashboard to review and respond to this request.</p>
  </td></tr>${FOOTER()}</table></td></tr></table></body></html>`;
}

function employeeLeaveReceivedEmail(emp, req) {
  const name = `${emp.firstName} ${emp.lastName}`;
  const s    = new Date(req.startDate+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  const e2   = new Date(req.endDate  +'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#F4F6FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6FA;padding:40px 0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.12)">
  <tr><td style="background:linear-gradient(135deg,#FF681A 0%,#FF8C4A 100%);padding:36px 40px">
    <div style="font-size:10px;color:rgba(255,255,255,.7);text-transform:uppercase;letter-spacing:.12em;margin-bottom:12px">Aladdin Finance · Employee Portal</div>
    <div style="font-size:24px;font-weight:800;color:#fff">Request Received ✓</div>
  </td></tr>
  <tr><td style="background:#fff;padding:32px 40px">
    <div style="font-size:14px;color:#374151;line-height:1.75;margin-bottom:16px">Dear <strong>${name}</strong>,</div>
    <div style="font-size:14px;color:#374151;line-height:1.75;margin-bottom:24px">Your leave request has been received and is now pending HR review. You will be notified once a decision is made.</div>
    <div style="background:#FFF7F3;border:1px solid #FFD5B8;border-radius:12px;padding:18px;margin-bottom:16px">
      <div style="font-size:13px;font-weight:700;color:#9A3412;text-transform:capitalize;margin-bottom:4px">${req.type} Leave · ${req.days} day${req.days!==1?'s':''}</div>
      <div style="font-size:12px;color:#C2410C">📅 ${s} → ${e2}</div>
    </div>
    <p style="font-size:12px;color:#9CA3AF;margin:0;line-height:1.7">Questions? Reply to this email or contact HR directly.</p>
  </td></tr>${FOOTER()}</table></td></tr></table></body></html>`;
}

function employeeRequestConfirmEmail(emp, req, deptLabel) {
  const name = `${emp.firstName} ${emp.lastName}`;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#F4F6FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6FA;padding:40px 0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.12)">
  <tr><td style="background:linear-gradient(135deg,#FF681A 0%,#FF8C4A 100%);padding:36px 40px">
    <div style="font-size:10px;color:rgba(255,255,255,.7);text-transform:uppercase;letter-spacing:.12em;margin-bottom:12px">Aladdin Finance · Employee Portal</div>
    <div style="font-size:24px;font-weight:800;color:#fff">Request Submitted ✓</div>
  </td></tr>
  <tr><td style="background:#fff;padding:32px 40px">
    <div style="font-size:14px;color:#374151;line-height:1.75;margin-bottom:16px">Dear <strong>${name}</strong>,</div>
    <div style="font-size:14px;color:#374151;line-height:1.75;margin-bottom:24px">Your request has been submitted to the <strong>${deptLabel}</strong> team and is under review.</div>
    <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:16px">
      <div style="font-size:9px;color:#6B7280;text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px">Subject</div>
      <div style="font-size:14px;font-weight:700;color:#111827">${req.subject}</div>
      ${req.body ? `<div style="font-size:13px;color:#6B7280;margin-top:8px;line-height:1.6">${req.body}</div>` : ''}
    </div>
    <p style="font-size:12px;color:#9CA3AF;margin:0;line-height:1.7">You will receive a response once your request has been reviewed.</p>
  </td></tr>${FOOTER()}</table></td></tr></table></body></html>`;
}

function portalInviteEmail(emp, url, policy) {
  const name = `${emp.firstName} ${emp.lastName}`;
  const d    = new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  const policyHtml = (policy||'').split('\n').map(l => l ? `<div style="margin-bottom:6px;font-size:13px;color:#374151;line-height:1.6">${l}</div>` : '<div style="margin-bottom:6px">&nbsp;</div>').join('');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#F4F6FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6FA;padding:40px 0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.12)">
  <tr><td style="background:linear-gradient(135deg,#FF681A 0%,#FF8C4A 100%);padding:36px 40px">
    <div style="font-size:10px;color:rgba(255,255,255,.7);text-transform:uppercase;letter-spacing:.12em;margin-bottom:12px">Aladdin Finance · Employee Portal</div>
    <div style="font-size:26px;font-weight:800;color:#fff;margin-bottom:4px">You're Invited!</div>
    <div style="font-size:11px;color:rgba(255,255,255,.75)">${d}</div>
  </td></tr>
  <tr><td style="background:#fff;padding:32px 40px">
    <div style="font-size:14px;color:#374151;line-height:1.75;margin-bottom:16px">Dear <strong>${name}</strong>,</div>
    <div style="font-size:14px;color:#374151;line-height:1.75;margin-bottom:24px">You now have access to the Aladdin Finance employee self-service portal. Click the button below to set your password and access your portal.</div>
    <div style="text-align:center;margin-bottom:28px">
      <a href="${url}" style="display:inline-block;background:linear-gradient(135deg,#FF681A,#FF8C4A);color:#fff;font-size:14px;font-weight:700;padding:14px 32px;border-radius:10px;text-decoration:none">Set Password & Access Portal →</a>
    </div>
    <div style="background:#FFF7F3;border:1px solid #FFD5B8;border-radius:12px;padding:18px;margin-bottom:20px">
      <div style="font-size:10px;color:#FF681A;text-transform:uppercase;letter-spacing:.1em;font-weight:700;margin-bottom:8px">Your Portal Link</div>
      <div style="font-size:12px;color:#7C2D12;word-break:break-all;line-height:1.5">${url}</div>
    </div>
    ${policy ? `<div style="border-top:1px solid #F3F4F6;padding-top:20px;margin-top:4px"><div style="font-size:10px;color:#6B7280;text-transform:uppercase;letter-spacing:.08em;font-weight:700;margin-bottom:12px">Company Policy</div><div style="background:#F9FAFB;border-radius:8px;padding:16px">${policyHtml}</div></div>` : ''}
    <p style="font-size:12px;color:#9CA3AF;margin:16px 0 0;line-height:1.7">Keep this link private. Contact HR if you need a new link generated.</p>
  </td></tr>${FOOTER()}</table></td></tr></table></body></html>`;
}

// ── Welcome Email Templates ───────────────────────────────────────────────────
function welcomeEmail(emp, type, note) {
  const name   = `${emp.firstName} ${emp.lastName}`;
  const first  = emp.firstName;
  const d      = new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  const role   = emp.position || 'Team Member';
  const dept   = emp.department || 'the team';
  const t      = (type || emp.type || 'full-time').toLowerCase();

  const typeMessages = {
    'full-time':  { icon:'🎉', title:`Welcome to the Family, ${first}!`, sub:'We\'re thrilled to have you join us full-time.', color:'linear-gradient(135deg,#FF681A 0%,#FF8C4A 100%)' },
    'part-time':  { icon:'👋', title:`Welcome Aboard, ${first}!`, sub:'We\'re delighted to have you join us as part of the team.', color:'linear-gradient(135deg,#7C3AED 0%,#A855F7 100%)' },
    'contractor': { icon:'🤝', title:`Great to Work With You, ${first}!`, sub:'We\'re excited to start this engagement with you.', color:'linear-gradient(135deg,#0F766E 0%,#14B8A6 100%)' },
    'intern':     { icon:'🌟', title:`Welcome, ${first}! Great to Have You!`, sub:'Your internship journey at Aladdin Finance starts today.', color:'linear-gradient(135deg,#1D4ED8 0%,#3B82F6 100%)' },
    'milestone':  { icon:'🏆', title:`Welcome, ${first}!`, sub:'We\'re glad to have you on board for this project.', color:'linear-gradient(135deg,#B45309 0%,#F59E0B 100%)' },
  };
  const tm = typeMessages[t] || typeMessages['full-time'];

  const perks = {
    'full-time':  ['Competitive salary & benefits package','Annual leave & sick leave entitlement','Health insurance coverage','Performance-based bonuses','Professional development budget'],
    'part-time':  ['Flexible working schedule','Pro-rated leave entitlements','Access to company portal & systems','Collaborative team environment'],
    'contractor': ['Professional project collaboration','Transparent payment terms','Access to required systems & resources','Clear deliverables & milestones'],
    'intern':     ['Hands-on real-world experience','Mentorship from senior professionals','Certificate of completion','Potential full-time opportunity','Networking opportunities'],
    'milestone':  ['Project-based collaboration','Clear scope & objectives','Regular check-ins & feedback'],
  };
  const empPerks = (perks[t] || perks['full-time']).map(p => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #F3F4F6">
      <div style="width:20px;height:20px;border-radius:50%;background:linear-gradient(135deg,#FF681A,#FF8C4A);display:flex;align-items:center;justify-content:center;font-size:9px;color:#fff;flex-shrink:0;font-weight:700">✓</div>
      <div style="font-size:13px;color:#374151">${p}</div>
    </div>`).join('');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#F4F6FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6FA;padding:40px 0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.12)">
  <tr><td style="background:${tm.color};padding:40px 40px 32px">
    <div style="font-size:10px;color:rgba(255,255,255,.65);text-transform:uppercase;letter-spacing:.12em;margin-bottom:14px">Aladdin Finance · Welcome</div>
    <div style="font-size:48px;margin-bottom:12px">${tm.icon}</div>
    <div style="font-size:26px;font-weight:800;color:#fff;margin-bottom:6px">${tm.title}</div>
    <div style="font-size:13px;color:rgba(255,255,255,.75)">${tm.sub}</div>
  </td></tr>
  <tr><td style="background:#fff;padding:32px 40px">
    <div style="font-size:14px;color:#374151;line-height:1.8;margin-bottom:20px">Dear <strong>${name}</strong>,<br><br>
    On behalf of everyone at <strong>Aladdin Finance</strong>, we are thrilled to welcome you to the team. You are joining us as <strong>${role}</strong> in our <strong>${dept}</strong> team, and we are confident that your skills and experience will make a significant contribution.</div>
    <div style="background:#FFF7F3;border:1px solid #FFD5B8;border-radius:12px;padding:20px;margin-bottom:24px">
      <div style="font-size:10px;color:#FF681A;text-transform:uppercase;letter-spacing:.1em;font-weight:700;margin-bottom:14px">What's Included</div>
      ${empPerks}
    </div>
    ${emp.startDate ? `<div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:12px;padding:16px;margin-bottom:24px;display:flex;align-items:center;gap:12px">
      <div style="font-size:24px">📅</div>
      <div><div style="font-size:11px;color:#15803D;font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin-bottom:3px">Start Date</div>
      <div style="font-size:14px;font-weight:700;color:#14532D">${new Date(emp.startDate+'T00:00:00').toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</div></div>
    </div>` : ''}
    <div style="font-size:14px;color:#374151;line-height:1.8;margin-bottom:20px">We look forward to seeing you thrive with us. If you have any questions before your first day, don't hesitate to reach out to HR.<br><br>Once again, welcome — we are excited to have you with us!</div>
    ${note ? `<div style="background:#F8F9FA;border-left:4px solid #FF681A;border-radius:0 8px 8px 0;padding:16px 20px;margin-bottom:20px"><div style="font-size:11px;color:#FF681A;font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">Personal Note</div><div style="font-size:14px;color:#374151;line-height:1.8">${note.replace(/\n/g,'<br>')}</div></div>` : ''}
    <div style="font-size:12px;color:#9CA3AF;border-top:1px solid #F3F4F6;padding-top:16px;line-height:1.7">Warm regards,<br><strong style="color:#374151">Aladdin Finance HR Team</strong></div>
  </td></tr>${FOOTER()}</table></td></tr></table></body></html>`;
}

function birthdayReminderEmail(emp, daysUntil) {
  const name  = `${emp.firstName} ${emp.lastName}`;
  const bday  = emp.dob ? new Date(emp.dob+'T00:00:00').toLocaleDateString('en-US',{month:'long',day:'numeric'}) : '';
  const age   = emp.dob ? (new Date().getFullYear() - new Date(emp.dob).getFullYear()) : null;
  const when  = daysUntil === 0 ? 'TODAY' : daysUntil === 1 ? 'TOMORROW' : `IN ${daysUntil} DAYS`;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#F4F6FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6FA;padding:40px 0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.12)">
  <tr><td style="background:linear-gradient(135deg,#DB2777 0%,#EC4899 100%);padding:36px 40px">
    <div style="font-size:10px;color:rgba(255,255,255,.65);text-transform:uppercase;letter-spacing:.12em;margin-bottom:12px">Aladdin Finance · HR Reminder</div>
    <div style="font-size:36px;margin-bottom:10px">🎂</div>
    <div style="font-size:22px;font-weight:800;color:#fff">Birthday Reminder — ${when}</div>
  </td></tr>
  <tr><td style="background:#fff;padding:32px 40px">
    <div style="background:#FDF2F8;border:1px solid #FBCFE8;border-radius:12px;padding:20px;margin-bottom:20px;display:flex;align-items:center;gap:14px">
      <div style="width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,#DB2777,#EC4899);display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:800;color:#fff;flex-shrink:0">${(emp.firstName[0]||'?').toUpperCase()}${(emp.lastName[0]||'?').toUpperCase()}</div>
      <div><div style="font-size:15px;font-weight:700;color:#111827">${name}</div>
        <div style="font-size:12px;color:#6B7280;margin-top:2px">${emp.position||''} ${emp.department?'· '+emp.department:''}</div>
        ${bday ? `<div style="font-size:12px;color:#DB2777;margin-top:3px">🎂 ${bday}${age ? ' · Turning '+age : ''}</div>` : ''}
      </div>
    </div>
    <div style="font-size:14px;color:#374151;line-height:1.8">Don't forget to wish <strong>${emp.firstName}</strong> a happy birthday${daysUntil===0?' today':''}! A small gesture goes a long way in building a positive team culture.</div>
  </td></tr>${FOOTER()}</table></td></tr></table></body></html>`;
}

function anniversaryReminderEmail(emp, years, daysUntil) {
  const name  = `${emp.firstName} ${emp.lastName}`;
  const when  = daysUntil === 0 ? 'TODAY' : daysUntil === 1 ? 'TOMORROW' : `IN ${daysUntil} DAYS`;
  const start = emp.startDate ? new Date(emp.startDate+'T00:00:00').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}) : '';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#F4F6FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6FA;padding:40px 0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.12)">
  <tr><td style="background:linear-gradient(135deg,#0F766E 0%,#14B8A6 100%);padding:36px 40px">
    <div style="font-size:10px;color:rgba(255,255,255,.65);text-transform:uppercase;letter-spacing:.12em;margin-bottom:12px">Aladdin Finance · HR Reminder</div>
    <div style="font-size:36px;margin-bottom:10px">🏆</div>
    <div style="font-size:22px;font-weight:800;color:#fff">${years}-Year Work Anniversary — ${when}</div>
  </td></tr>
  <tr><td style="background:#fff;padding:32px 40px">
    <div style="background:#F0FDFA;border:1px solid #99F6E4;border-radius:12px;padding:20px;margin-bottom:20px;display:flex;align-items:center;gap:14px">
      <div style="width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,#0F766E,#14B8A6);display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:800;color:#fff;flex-shrink:0">${(emp.firstName[0]||'?').toUpperCase()}${(emp.lastName[0]||'?').toUpperCase()}</div>
      <div><div style="font-size:15px;font-weight:700;color:#111827">${name}</div>
        <div style="font-size:12px;color:#6B7280;margin-top:2px">${emp.position||''} ${emp.department?'· '+emp.department:''}</div>
        ${start ? `<div style="font-size:12px;color:#0F766E;margin-top:3px">📅 Started ${start}</div>` : ''}
      </div>
    </div>
    <div style="font-size:14px;color:#374151;line-height:1.8"><strong>${name}</strong> is celebrating <strong>${years} year${years!==1?'s':''}</strong> with Aladdin Finance${daysUntil===0?' today':''}! Consider recognizing this milestone with a personal message or team acknowledgement.</div>
  </td></tr>${FOOTER()}</table></td></tr></table></body></html>`;
}

// ── Welcome Email Route ───────────────────────────────────────────────────────
router.post('/:id/welcome-email', async (req, res) => {
  const emps = getEmps();
  const emp  = emps.find(e => e.id === Number(req.params.id));
  if (!emp) return res.status(404).json({ error: 'Not found' });
  if (!emp.email) return res.status(400).json({ error: 'Employee has no email address' });
  if (!mailer.isConfigured()) return res.status(400).json({ error: 'Email not configured on server' });
  const type = req.body.type || emp.type || 'full-time';
  const note = req.body.note || '';
  await mailer.sendMail({
    to: emp.email,
    subject: req.body.subject || `Welcome to Aladdin Finance, ${emp.firstName}!`,
    html: welcomeEmail(emp, type, note)
  });
  res.json({ ok: true });
});

// ── Birthday / Anniversary Reminders ─────────────────────────────────────────
router.get('/check-reminders', async (req, res) => {
  const cfg  = getCfg();
  if (!cfg.hrEmail) return res.status(400).json({ error: 'HR email not configured in settings' });
  if (!mailer.isConfigured()) return res.status(400).json({ error: 'Email not configured on server' });
  const emps  = getEmps().filter(e => e.status !== 'terminated');
  const today = new Date();
  const todayMD = `${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const sent  = [];

  for (const emp of emps) {
    // Birthday check (7-day window)
    if (emp.dob) {
      const dobMD = emp.dob.slice(5); // MM-DD
      for (let d = 0; d <= 7; d++) {
        const check = new Date(today); check.setDate(check.getDate() + d);
        const checkMD = `${String(check.getMonth()+1).padStart(2,'0')}-${String(check.getDate()).padStart(2,'0')}`;
        if (checkMD === dobMD && (d === 0 || d === 1 || d === 7)) {
          mailer.sendMail({ to: cfg.hrEmail, subject: `🎂 Birthday Reminder: ${emp.firstName} ${emp.lastName} — ${d===0?'Today':d===1?'Tomorrow':'In 7 days'}`, html: birthdayReminderEmail(emp, d) }).catch(()=>{});
          sent.push({ type:'birthday', employee:`${emp.firstName} ${emp.lastName}`, daysUntil:d });
          break;
        }
      }
    }
    // Anniversary check (7-day window)
    if (emp.startDate) {
      const startMD = emp.startDate.slice(5);
      const startYear = parseInt(emp.startDate.slice(0,4),10);
      for (let d = 0; d <= 7; d++) {
        const check = new Date(today); check.setDate(check.getDate() + d);
        const checkMD = `${String(check.getMonth()+1).padStart(2,'0')}-${String(check.getDate()).padStart(2,'0')}`;
        const years = check.getFullYear() - startYear;
        if (checkMD === startMD && years > 0 && (d === 0 || d === 1 || d === 7)) {
          mailer.sendMail({ to: cfg.hrEmail, subject: `🏆 Work Anniversary: ${emp.firstName} ${emp.lastName} — ${years} Year${years!==1?'s':''}`, html: anniversaryReminderEmail(emp, years, d) }).catch(()=>{});
          sent.push({ type:'anniversary', employee:`${emp.firstName} ${emp.lastName}`, years, daysUntil:d });
          break;
        }
      }
    }
  }
  res.json({ ok: true, sent });
});

module.exports = router;
module.exports.portalGetHandler         = portalGetHandler;
module.exports.portalSetPasswordHandler = portalSetPasswordHandler;
module.exports.portalLoginHandler       = portalLoginHandler;
module.exports.portalTimeOffHandler     = portalTimeOffHandler;
module.exports.portalRequestHandler     = portalRequestHandler;

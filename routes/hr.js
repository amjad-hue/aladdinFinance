const router  = require('express').Router();
const crypto  = require('crypto');
const bcrypt  = require('bcryptjs');
const { load, save } = require('../data/store');
const { seed }       = require('../data/seed');
const mailer         = require('../lib/mailer');
const { requireRole } = require('../middleware/roles');

const EMP_FILE = 'hr-employees.json';
const CFG_FILE = 'hr-settings.json';
const TOF_FILE = 'hr-timeoff.json';
const ANN_FILE = 'announcements.json';

function getEmps()  { return load(EMP_FILE, seed().hrEmployees || []); }
function setEmps(d) { save(EMP_FILE, d); }
function getCfg()   { return load(CFG_FILE, seed().hrSettings  || defaultSettings()); }
function setCfg(d)  { save(CFG_FILE, d); }
function getTOff()  { return load(TOF_FILE, []); }
function setTOff(d) { save(TOF_FILE, d); }
function getAnns()  { return load(ANN_FILE, []); }
function setAnns(d) { save(ANN_FILE, d); }

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
  syncSalesRep(emp);
  res.json({ employee: emp });
});

router.put('/:id', (req, res) => {
  const emps = getEmps();
  const i    = emps.findIndex(e => e.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  emps[i] = { ...emps[i], ...req.body, id: emps[i].id };
  setEmps(emps);
  syncSalesRep(emps[i]);
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
    salesTarget:     Number(body.salesTarget) || 0,
    createdAt:       new Date().toISOString()
  };
}

function syncSalesRep(emp) {
  if (emp.department !== 'Sales' || emp.status === 'terminated') return;
  const fullName = `${emp.firstName} ${emp.lastName}`.trim();
  if (!fullName) return;

  const settings = load('commission-settings.json', {
    rates: { Enterprise: 5, Government: 4, Tradeshow: 3, Default: 4 },
    customReps: [], repEmails: {}, targets: {}, archivedReps: []
  });
  if (!settings.customReps)   settings.customReps   = [];
  if (!settings.repEmails)    settings.repEmails    = {};
  if (!settings.targets)      settings.targets      = {};
  if (!settings.archivedReps) settings.archivedReps = [];

  if (!settings.customReps.includes(fullName)) settings.customReps.push(fullName);
  settings.archivedReps = settings.archivedReps.filter(r => r !== fullName);
  if (emp.email) settings.repEmails[fullName] = emp.email;

  const salesTarget = emp.salesTarget || 0;
  if (salesTarget > 0 && emp.startDate) {
    const now       = new Date();
    const curYear   = now.getFullYear();
    const start     = new Date(emp.startDate + 'T00:00:00');
    const startYear = start.getFullYear();
    let yearly, monthly, remainingMonths;
    if (startYear < curYear) {
      yearly = salesTarget; monthly = Math.round(salesTarget / 12); remainingMonths = 12;
    } else if (startYear === curYear) {
      remainingMonths = 12 - start.getMonth();
      yearly  = Math.round(salesTarget * remainingMonths / 12);
      monthly = remainingMonths > 0 ? Math.round(yearly / remainingMonths) : 0;
    } else {
      yearly = 0; monthly = 0; remainingMonths = 0;
    }
    settings.targets[fullName] = { monthly, yearly, fullYearTarget: salesTarget, startDate: emp.startDate, remainingMonths, hrSynced: true };
  }
  save('commission-settings.json', settings);
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
  const cfg  = getCfg();
  const anns = getAnns();
  const empAckIds = (emp.announcementAcks || []).map(a => a.annId);
  const announcements = anns.map(a => ({
    id:          a.id,
    title:       a.title,
    body:        a.body,
    publishedAt: a.publishedAt,
    acknowledged: empAckIds.includes(a.id)
  }));
  res.json({
    employee: {
      id: emp.id, firstName: emp.firstName, lastName: emp.lastName,
      email: emp.email, position: emp.position, department: emp.department,
      employeeId: emp.employeeId, leaveBalances: emp.leaveBalances || {}
    },
    leaveTypes:    cfg.leaveTypes    || [],
    policy:        cfg.companyPolicy || '',
    portalEnabled: cfg.portalEnabled !== false,
    passwordSet:   !!emp.portalPassword,
    policySigned:  emp.policySigned  || null,
    announcements
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

  const emp = getEmps().find(e => e.email && e.email.trim().toLowerCase() === email.trim().toLowerCase());
  if (!emp) return res.status(401).json({ error: 'No account found for this email address.' });
  if (!emp.portalToken) return res.status(401).json({ error: 'Your portal invitation has not been sent yet. Please contact HR to request access.' });
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

// ── Announcement Reminder Email Template ─────────────────────────────────────
function announcementReminderEmail(emp, ann, portalUrl) {
  const name = `${emp.firstName} ${emp.lastName}`;
  const bodyHtml = (ann.body||'').split('\n').map(l => l
    ? `<div style="margin-bottom:6px;font-size:13px;color:#374151;line-height:1.65">${l}</div>`
    : '<div style="margin-bottom:6px">&nbsp;</div>').join('');
  const published = ann.publishedAt ? new Date(ann.publishedAt).toLocaleDateString('en-US',{day:'2-digit',month:'short',year:'numeric'}) : '';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#F4F6FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6FA;padding:40px 0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.12)">
  <tr><td style="background:linear-gradient(135deg,#92400E 0%,#D97706 100%);padding:36px 40px">
    <div style="font-size:10px;color:rgba(255,255,255,.65);text-transform:uppercase;letter-spacing:.12em;margin-bottom:12px">Aladdin Finance · Acknowledgement Reminder</div>
    <div style="font-size:26px;font-weight:800;color:#fff;margin-bottom:6px">⏳ Action Required: Please Acknowledge</div>
    <div style="font-size:11px;color:rgba(255,255,255,.65);margin-top:4px">Originally published ${published}</div>
  </td></tr>
  <tr><td style="background:#fff;padding:32px 40px">
    <div style="font-size:14px;color:#374151;line-height:1.75;margin-bottom:20px">Dear <strong>${name}</strong>,</div>
    <div style="font-size:14px;color:#374151;line-height:1.75;margin-bottom:20px">This is a reminder that the following announcement requires your acknowledgement. Please take a moment to read and confirm.</div>
    <div style="background:#FFFBEB;border:1px solid #FCD34D;border-radius:12px;padding:22px 24px;margin-bottom:24px">
      <div style="font-size:16px;font-weight:800;color:#92400E;margin-bottom:12px">${ann.title}</div>
      <div style="font-size:13px;color:#374151;line-height:1.7">${bodyHtml}</div>
    </div>
    <div style="text-align:center;margin-bottom:28px">
      <a href="${portalUrl}#announcements" style="display:inline-block;background:linear-gradient(135deg,#D97706,#F59E0B);color:#fff;font-size:14px;font-weight:700;padding:14px 36px;border-radius:10px;text-decoration:none">✓ Acknowledge Now →</a>
    </div>
    <p style="font-size:12px;color:#9CA3AF;margin:0;line-height:1.7;text-align:center">Open the portal and click <strong>Acknowledge</strong> in the Announcements tab.</p>
  </td></tr>${FOOTER()}</table></td></tr></table></body></html>`;
}

// ── Announcement Email Template ───────────────────────────────────────────────
function announcementEmail(emp, ann, portalUrl) {
  const name = `${emp.firstName} ${emp.lastName}`;
  const d    = new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  const bodyHtml = (ann.body||'').split('\n').map(l => l
    ? `<div style="margin-bottom:6px;font-size:13px;color:#374151;line-height:1.65">${l}</div>`
    : '<div style="margin-bottom:6px">&nbsp;</div>').join('');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#F4F6FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6FA;padding:40px 0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.12)">
  <tr><td style="background:linear-gradient(135deg,#1E3A5F 0%,#2563EB 100%);padding:36px 40px">
    <div style="font-size:10px;color:rgba(255,255,255,.6);text-transform:uppercase;letter-spacing:.12em;margin-bottom:12px">Aladdin Finance · HR Announcement</div>
    <div style="font-size:26px;font-weight:800;color:#fff;margin-bottom:6px">📢 New Announcement from HR</div>
    <div style="font-size:11px;color:rgba(255,255,255,.65);margin-top:4px">${d}</div>
  </td></tr>
  <tr><td style="background:#fff;padding:32px 40px">
    <div style="font-size:14px;color:#374151;line-height:1.75;margin-bottom:20px">Dear <strong>${name}</strong>,</div>
    <div style="font-size:14px;color:#374151;line-height:1.75;margin-bottom:20px">Please read the following announcement from HR:</div>
    <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:12px;padding:22px 24px;margin-bottom:24px">
      <div style="font-size:16px;font-weight:800;color:#1E3A5F;margin-bottom:12px">${ann.title}</div>
      <div style="font-size:13px;color:#374151;line-height:1.7">${bodyHtml}</div>
    </div>
    <div style="text-align:center;margin-bottom:28px">
      <a href="${portalUrl}#announcements" style="display:inline-block;background:linear-gradient(135deg,#1D4ED8,#3B82F6);color:#fff;font-size:14px;font-weight:700;padding:14px 36px;border-radius:10px;text-decoration:none">✓ Acknowledge in Portal →</a>
    </div>
    <p style="font-size:12px;color:#9CA3AF;margin:0;line-height:1.7;text-align:center">Open the portal and click <strong>Acknowledge</strong> in the Announcements tab after reading.</p>
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

function birthdayReminderEmail(emp, daysUntil, customMessage) {
  const name  = `${emp.firstName} ${emp.lastName}`;
  const bday  = emp.dob ? new Date(emp.dob+'T00:00:00').toLocaleDateString('en-US',{month:'long',day:'numeric'}) : '';
  const age   = emp.dob ? (new Date().getFullYear() - new Date(emp.dob).getFullYear()) : null;
  const when  = daysUntil === 0 ? 'TODAY' : daysUntil === 1 ? 'TOMORROW' : `IN ${daysUntil} DAYS`;
  const msg   = (customMessage || `Don't forget to wish <strong>${emp.firstName}</strong> a happy birthday${daysUntil===0?' today':''}! A small gesture goes a long way in building a positive team culture.`)
    .replace(/\{\{firstName\}\}/g, emp.firstName)
    .replace(/\{\{fullName\}\}/g,  name)
    .replace(/\{\{position\}\}/g,  emp.position||'')
    .replace(/\{\{department\}\}/g, emp.department||'');
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
    <div style="font-size:14px;color:#374151;line-height:1.8">${msg}</div>
  </td></tr>${FOOTER()}</table></td></tr></table></body></html>`;
}

function anniversaryReminderEmail(emp, years, daysUntil, customMessage) {
  const name  = `${emp.firstName} ${emp.lastName}`;
  const when  = daysUntil === 0 ? 'TODAY' : daysUntil === 1 ? 'TOMORROW' : `IN ${daysUntil} DAYS`;
  const start = emp.startDate ? new Date(emp.startDate+'T00:00:00').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}) : '';
  const msg   = (customMessage || `<strong>${name}</strong> is celebrating <strong>${years} year${years!==1?'s':''}</strong> with Aladdin Finance${daysUntil===0?' today':''}! Consider recognizing this milestone with a personal message or team acknowledgement.`)
    .replace(/\{\{firstName\}\}/g, emp.firstName)
    .replace(/\{\{fullName\}\}/g,  name)
    .replace(/\{\{years\}\}/g,     String(years))
    .replace(/\{\{position\}\}/g,  emp.position||'')
    .replace(/\{\{department\}\}/g, emp.department||'');
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
    <div style="font-size:14px;color:#374151;line-height:1.8">${msg}</div>
  </td></tr>${FOOTER()}</table></td></tr></table></body></html>`;
}

// ── Celebration Email Templates (sent TO employee on the day) ────────────────
function _applyVars(str, emp, extra) {
  const vars = {
    firstName:   emp.firstName || '',
    fullName:    `${emp.firstName} ${emp.lastName}`.trim(),
    department:  emp.department  || '',
    position:    emp.position    || '',
    hireDate:    emp.startDate   ? new Date(emp.startDate+'T00:00:00').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}) : '',
    ...extra,
  };
  return str.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] !== undefined ? vars[k] : `{{${k}}}`);
}

const DEFAULT_CELEBRATION_SETTINGS = {
  enabled: true,
  birthdayEnabled: true,
  anniversaryEnabled: true,
  advanceNoticeDays: 3,
  birthdaySubject:  'Happy Birthday, {{firstName}}! 🎂',
  birthdayBody:     'Dear {{firstName}},\n\nOn behalf of everyone at Aladdin Finance, wishing you a very Happy Birthday! 🎂\n\nYour energy, talent, and dedication mean so much to our team. We hope your day is filled with joy and everything you love.\n\nHere\'s to a wonderful year ahead!\n\nWarm regards,\nAladdin Finance HR Team',
  anniversarySubject: 'Happy {{years}}-Year Work Anniversary, {{firstName}}! 🏆',
  anniversaryBody:    'Dear {{firstName}},\n\nCongratulations on {{years}} year{{yearsPlural}} with Aladdin Finance! 🏆\n\nYour commitment and contributions over this time have made a real difference to our team and our clients. This milestone is a testament to your dedication and we are truly grateful.\n\nHere\'s to many more years together!\n\nWarm regards,\nAladdin Finance HR Team',
};

function birthdayCelebrationEmail(emp, settings) {
  const s = { ...DEFAULT_CELEBRATION_SETTINGS, ...settings };
  const heading = _applyVars(s.birthdaySubject, emp);
  const body    = _applyVars(s.birthdayBody, emp);
  const bodyHtml = body.split('\n').map(l => l ? `<div style="font-size:14px;color:#374151;line-height:1.75;margin-bottom:8px">${l}</div>` : '<div style="margin-bottom:8px">&nbsp;</div>').join('');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#F4F6FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6FA;padding:40px 0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.12)">
  <tr><td style="background:linear-gradient(135deg,#DB2777 0%,#EC4899 100%);padding:40px;text-align:center">
    <div style="font-size:10px;color:rgba(255,255,255,.65);text-transform:uppercase;letter-spacing:.12em;margin-bottom:14px">Aladdin Finance · Celebration</div>
    <div style="font-size:52px;margin-bottom:12px">🎂</div>
    <div style="font-size:26px;font-weight:800;color:#fff">${heading}</div>
  </td></tr>
  <tr><td style="background:#fff;padding:32px 40px">
    ${bodyHtml}
    <div style="background:linear-gradient(135deg,rgba(219,39,119,.05),rgba(236,72,153,.05));border:1px solid #FBCFE8;border-radius:12px;padding:18px 20px;text-align:center;margin-top:20px">
      <div style="font-size:24px;margin-bottom:6px">🎉 🎈 🎁</div>
      <div style="font-size:13px;font-weight:700;color:#DB2777">${emp.firstName} ${emp.lastName}</div>
      ${emp.position||emp.department ? `<div style="font-size:11px;color:#9CA3AF;margin-top:2px">${[emp.position,emp.department].filter(Boolean).join(' · ')}</div>` : ''}
    </div>
  </td></tr>${FOOTER()}</table></td></tr></table></body></html>`;
}

function anniversaryCelebrationEmail(emp, years, settings) {
  const s = { ...DEFAULT_CELEBRATION_SETTINGS, ...settings };
  const extra = { years: String(years), yearsPlural: years !== 1 ? 's' : '' };
  const heading = _applyVars(s.anniversarySubject, emp, extra);
  const body    = _applyVars(s.anniversaryBody,    emp, extra);
  const bodyHtml = body.split('\n').map(l => l ? `<div style="font-size:14px;color:#374151;line-height:1.75;margin-bottom:8px">${l}</div>` : '<div style="margin-bottom:8px">&nbsp;</div>').join('');
  const start = emp.startDate ? new Date(emp.startDate+'T00:00:00').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}) : '';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#F4F6FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6FA;padding:40px 0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.12)">
  <tr><td style="background:linear-gradient(135deg,#0F766E 0%,#14B8A6 100%);padding:40px;text-align:center">
    <div style="font-size:10px;color:rgba(255,255,255,.65);text-transform:uppercase;letter-spacing:.12em;margin-bottom:14px">Aladdin Finance · Celebration</div>
    <div style="font-size:52px;margin-bottom:12px">🏆</div>
    <div style="font-size:26px;font-weight:800;color:#fff">${heading}</div>
    ${start ? `<div style="font-size:12px;color:rgba(255,255,255,.7);margin-top:8px">With us since ${start}</div>` : ''}
  </td></tr>
  <tr><td style="background:#fff;padding:32px 40px">
    ${bodyHtml}
    <div style="background:linear-gradient(135deg,rgba(15,118,110,.05),rgba(20,184,166,.05));border:1px solid #99F6E4;border-radius:12px;padding:18px 20px;text-align:center;margin-top:20px">
      <div style="font-size:24px;margin-bottom:6px">🌟 ⭐ 🎊</div>
      <div style="font-size:15px;font-weight:800;color:#0F766E">${years} Year${years!==1?'s':''} with Aladdin Finance</div>
      <div style="font-size:13px;font-weight:700;color:#374151;margin-top:4px">${emp.firstName} ${emp.lastName}</div>
      ${emp.position||emp.department ? `<div style="font-size:11px;color:#9CA3AF;margin-top:2px">${[emp.position,emp.department].filter(Boolean).join(' · ')}</div>` : ''}
    </div>
  </td></tr>${FOOTER()}</table></td></tr></table></body></html>`;
}

// Advance notice email sent TO the employee (before the day)
function birthdayAdvanceEmail(emp, daysUntil) {
  const when = daysUntil === 1 ? 'tomorrow' : `in ${daysUntil} days`;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#F4F6FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6FA;padding:40px 0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.12)">
  <tr><td style="background:linear-gradient(135deg,#DB2777 0%,#EC4899 100%);padding:36px 40px;text-align:center">
    <div style="font-size:10px;color:rgba(255,255,255,.65);text-transform:uppercase;letter-spacing:.12em;margin-bottom:12px">Aladdin Finance · Birthday Coming Up</div>
    <div style="font-size:40px;margin-bottom:10px">🎂</div>
    <div style="font-size:22px;font-weight:800;color:#fff">Your Birthday is ${when}, ${emp.firstName}!</div>
  </td></tr>
  <tr><td style="background:#fff;padding:32px 40px">
    <div style="font-size:14px;color:#374151;line-height:1.8">Dear <strong>${emp.firstName}</strong>,<br><br>
    Just a heads-up — your birthday is <strong>${when}</strong>! 🎉 The Aladdin Finance team is looking forward to celebrating with you.<br><br>
    Expect a special birthday message from us on your big day.<br><br>Warm regards,<br><strong style="color:#374151">Aladdin Finance HR Team</strong></div>
  </td></tr>${FOOTER()}</table></td></tr></table></body></html>`;
}

function anniversaryAdvanceEmail(emp, years, daysUntil) {
  const when = daysUntil === 1 ? 'tomorrow' : `in ${daysUntil} days`;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#F4F6FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6FA;padding:40px 0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.12)">
  <tr><td style="background:linear-gradient(135deg,#0F766E 0%,#14B8A6 100%);padding:36px 40px;text-align:center">
    <div style="font-size:10px;color:rgba(255,255,255,.65);text-transform:uppercase;letter-spacing:.12em;margin-bottom:12px">Aladdin Finance · Work Anniversary Coming Up</div>
    <div style="font-size:40px;margin-bottom:10px">🏆</div>
    <div style="font-size:22px;font-weight:800;color:#fff">Your ${years}-Year Anniversary is ${when}!</div>
  </td></tr>
  <tr><td style="background:#fff;padding:32px 40px">
    <div style="font-size:14px;color:#374151;line-height:1.8">Dear <strong>${emp.firstName}</strong>,<br><br>
    We wanted to let you know that your <strong>${years}-year work anniversary</strong> at Aladdin Finance is <strong>${when}</strong>! 🌟<br><br>
    It has been a privilege having you on our team. Thank you for your commitment, your contributions, and everything you bring to Aladdin Finance every day.<br><br>
    Look forward to a special message from us on your anniversary.<br><br>Warm regards,<br><strong style="color:#374151">Aladdin Finance HR Team</strong></div>
  </td></tr>${FOOTER()}</table></td></tr></table></body></html>`;
}

// ── Portal Sign Policy Handler ────────────────────────────────────────────────
function portalSignPolicyHandler(req, res) {
  const emps = getEmps();
  const i    = emps.findIndex(e => e.portalToken === req.params.token);
  if (i === -1) return res.status(404).json({ error: 'Invalid or expired portal link' });
  const cfg = getCfg();
  const policySnippet = (cfg.companyPolicy || '').slice(0, 100);
  emps[i].policySigned = { signedAt: new Date().toISOString(), policySnippet };
  setEmps(emps);
  res.json({ ok: true });
}

// ── Portal Acknowledge Announcement Handler (public GET — email link) ─────────
function portalAcknowledgeHandler(req, res) {
  const emps = getEmps();
  const i    = emps.findIndex(e => e.portalToken === req.params.token);
  if (i === -1) return res.status(404).json({ error: 'Invalid or expired portal link' });
  const annId = Number(req.params.annId);
  const anns  = getAnns();
  const ann   = anns.find(a => a.id === annId);
  if (!ann) return res.status(404).json({ error: 'Announcement not found' });
  const emp = emps[i];
  const acks = emp.announcementAcks || [];
  if (!acks.find(a => a.annId === annId)) {
    acks.push({ annId, acknowledgedAt: new Date().toISOString() });
    emps[i].announcementAcks = acks;
    setEmps(emps);
    // Also record in the announcement's acknowledgements array
    if (!ann.acknowledgements) ann.acknowledgements = [];
    ann.acknowledgements.push({ empId: emp.id, acknowledgedAt: new Date().toISOString() });
    setAnns(anns);
  }
  // Redirect to portal announcements tab
  const host = `${req.protocol}://${req.get('host')}`;
  res.redirect(`${host}/employee-portal/${req.params.token}#announcements`);
}

// ── Portal Forgot Password Handler ────────────────────────────────────────────
function portalForgotPasswordHandler(req, res) {
  const { email } = req.body;
  if (!email) return res.json({ ok: true }); // always ok for security
  const emps = getEmps();
  const i    = emps.findIndex(e => e.email && e.email.trim().toLowerCase() === email.trim().toLowerCase());
  if (i !== -1 && emps[i].portalToken) {
    // Generate a new token and clear password so employee must reset via new link
    const token = crypto.randomBytes(24).toString('hex');
    emps[i].portalToken    = token;
    emps[i].portalPassword = null;
    setEmps(emps);
    const emp  = emps[i];
    const cfg  = getCfg();
    // We need req for host; if called from public route, req has host
    if (emp.email && mailer.isConfigured()) {
      const host = req._host || '';
      const url  = host ? `${host}/employee-portal/${token}` : `/employee-portal/${token}`;
      mailer.sendMail({
        to: emp.email,
        subject: 'Reset Your Aladdin Finance Employee Portal Password',
        html: portalPasswordResetEmail(emp, url, cfg.companyPolicy || '')
      }).catch(e => console.error('portal forgot-password email:', e.message));
    }
  }
  res.json({ ok: true });
}

// ── Portal Password Reset Email ───────────────────────────────────────────────
function portalPasswordResetEmail(emp, url) {
  const name = `${emp.firstName} ${emp.lastName}`;
  const d    = new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#F4F6FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6FA;padding:40px 0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.12)">
  <tr><td style="background:linear-gradient(135deg,#1E3A5F 0%,#2563EB 100%);padding:36px 40px">
    <div style="font-size:10px;color:rgba(255,255,255,.6);text-transform:uppercase;letter-spacing:.12em;margin-bottom:12px">Aladdin Finance · Employee Portal</div>
    <div style="font-size:24px;font-weight:800;color:#fff">🔑 Password Reset</div>
    <div style="font-size:11px;color:rgba(255,255,255,.65);margin-top:4px">${d}</div>
  </td></tr>
  <tr><td style="background:#fff;padding:32px 40px">
    <div style="font-size:14px;color:#374151;line-height:1.75;margin-bottom:16px">Dear <strong>${name}</strong>,</div>
    <div style="font-size:14px;color:#374151;line-height:1.75;margin-bottom:24px">We received a request to reset your employee portal password. Click the button below to set a new password and regain access to your portal.</div>
    <div style="text-align:center;margin-bottom:28px">
      <a href="${url}" style="display:inline-block;background:linear-gradient(135deg,#FF681A,#FF8C4A);color:#fff;font-size:14px;font-weight:700;padding:14px 32px;border-radius:10px;text-decoration:none">Reset Password & Access Portal →</a>
    </div>
    <div style="background:#FFF7F3;border:1px solid #FFD5B8;border-radius:12px;padding:18px;margin-bottom:20px">
      <div style="font-size:10px;color:#FF681A;text-transform:uppercase;letter-spacing:.1em;font-weight:700;margin-bottom:8px">Your Reset Link</div>
      <div style="font-size:12px;color:#7C2D12;word-break:break-all;line-height:1.5">${url}</div>
    </div>
    <p style="font-size:12px;color:#9CA3AF;margin:0;line-height:1.7">If you did not request a password reset, please ignore this email. Your account remains secure. Contact HR if you have concerns.</p>
  </td></tr>${FOOTER()}</table></td></tr></table></body></html>`;
}

// ── Welcome Email Preview (GET — returns draft without sending) ───────────────
router.get('/:id/welcome-email/preview', (req, res) => {
  const emps = getEmps();
  const emp  = emps.find(e => e.id === Number(req.params.id));
  if (!emp) return res.status(404).json({ error: 'Not found' });
  const type = req.query.type || emp.type || 'full-time';
  const note = req.query.note || '';
  res.json({
    to:      emp.email || '',
    subject: `Welcome to Aladdin Finance, ${emp.firstName}!`,
    html:    welcomeEmail(emp, type, note),
  });
});

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
  if (cfg.celebrationAutoSend === false) return res.json({ ok: true, sent: [], skipped: 'Auto-send disabled' });
  const emps  = getEmps().filter(e => e.status !== 'terminated');
  const today = new Date();
  const sent  = [];

  for (const emp of emps) {
    if (emp.dob) {
      const dobMD = emp.dob.slice(5);
      for (let d = 0; d <= 7; d++) {
        const check = new Date(today); check.setDate(check.getDate() + d);
        const checkMD = `${String(check.getMonth()+1).padStart(2,'0')}-${String(check.getDate()).padStart(2,'0')}`;
        if (checkMD === dobMD && (d === 0 || d === 1 || d === 7)) {
          mailer.sendMail({ to: cfg.hrEmail, subject: `🎂 Birthday Reminder: ${emp.firstName} ${emp.lastName} — ${d===0?'Today':d===1?'Tomorrow':'In 7 days'}`, html: birthdayReminderEmail(emp, d, cfg.birthdayEmailMessage||'') }).catch(()=>{});
          sent.push({ type:'birthday', employee:`${emp.firstName} ${emp.lastName}`, daysUntil:d });
          break;
        }
      }
    }
    if (emp.startDate) {
      const startMD  = emp.startDate.slice(5);
      const startYear = parseInt(emp.startDate.slice(0,4),10);
      for (let d = 0; d <= 7; d++) {
        const check = new Date(today); check.setDate(check.getDate() + d);
        const checkMD = `${String(check.getMonth()+1).padStart(2,'0')}-${String(check.getDate()).padStart(2,'0')}`;
        const years = check.getFullYear() - startYear;
        if (checkMD === startMD && years > 0 && (d === 0 || d === 1 || d === 7)) {
          mailer.sendMail({ to: cfg.hrEmail, subject: `🏆 Work Anniversary: ${emp.firstName} ${emp.lastName} — ${years} Year${years!==1?'s':''}`, html: anniversaryReminderEmail(emp, years, d, cfg.anniversaryEmailMessage||'') }).catch(()=>{});
          sent.push({ type:'anniversary', employee:`${emp.firstName} ${emp.lastName}`, years, daysUntil:d });
          break;
        }
      }
    }
  }
  res.json({ ok: true, sent });
});

// ── Celebration Settings ──────────────────────────────────────────────────────
const CEL_FILE = 'celebration-settings.json';
function getCelSettings() { return load(CEL_FILE, DEFAULT_CELEBRATION_SETTINGS); }
function setCelSettings(d) { save(CEL_FILE, d); }

router.get('/celebration-settings', (req, res) => res.json(getCelSettings()));
router.put('/celebration-settings', requireRole('write'), (req, res) => {
  setCelSettings({ ...getCelSettings(), ...req.body });
  res.json({ ok: true });
});

// Manual trigger: send celebration emails for today (test / one-off use)
router.post('/celebration-settings/send-today', requireRole('write'), async (req, res) => {
  const cfg  = getCfg();
  const cel  = getCelSettings();
  if (!mailer.isConfigured()) return res.status(400).json({ error: 'Email not configured' });
  const emps  = getEmps().filter(e => e.status !== 'terminated' && e.email);
  const today = new Date();
  const todayMD = `${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const sent  = [];

  for (const emp of emps) {
    if (cel.birthdayEnabled !== false && emp.dob && emp.dob.slice(5) === todayMD) {
      mailer.sendMail({ to: emp.email, subject: _applyVars(cel.birthdaySubject||DEFAULT_CELEBRATION_SETTINGS.birthdaySubject, emp), html: birthdayCelebrationEmail(emp, cel) }).catch(()=>{});
      if (cfg.hrEmail) mailer.sendMail({ to: cfg.hrEmail, subject: `🎂 Birthday Today: ${emp.firstName} ${emp.lastName}`, html: birthdayReminderEmail(emp, 0, '') }).catch(()=>{});
      sent.push({ type:'birthday', name:`${emp.firstName} ${emp.lastName}` });
    }
    if (cel.anniversaryEnabled !== false && emp.startDate && emp.startDate.slice(5) === todayMD) {
      const years = today.getFullYear() - parseInt(emp.startDate.slice(0,4),10);
      if (years > 0) {
        mailer.sendMail({ to: emp.email, subject: _applyVars(cel.anniversarySubject||DEFAULT_CELEBRATION_SETTINGS.anniversarySubject, emp, { years: String(years), yearsPlural: years!==1?'s':'' }), html: anniversaryCelebrationEmail(emp, years, cel) }).catch(()=>{});
        if (cfg.hrEmail) mailer.sendMail({ to: cfg.hrEmail, subject: `🏆 Anniversary Today: ${emp.firstName} ${emp.lastName} — ${years} Year${years!==1?'s':''}`, html: anniversaryReminderEmail(emp, years, 0, '') }).catch(()=>{});
        sent.push({ type:'anniversary', name:`${emp.firstName} ${emp.lastName}`, years });
      }
    }
  }
  res.json({ ok: true, sent });
});

// ── Portal Forgot Password Route (authenticated — reached via /api/hr/portal/forgot-password)
router.post('/portal/forgot-password', (req, res) => {
  // Attach host for email link generation
  req._host = `${req.protocol}://${req.get('host')}`;
  portalForgotPasswordHandler(req, res);
});

// ── Portal Sign Policy Route (authenticated — reached via /api/hr/portal/:token/sign-policy)
router.post('/portal/:token/sign-policy', (req, res) => {
  portalSignPolicyHandler(req, res);
});

// ── Notify Policy Update (reset signed status + email all portal employees) ───
router.post('/notify-policy-update', async (req, res) => {
  const cfg  = getCfg();
  if (!mailer.isConfigured()) return res.status(400).json({ error: 'Email not configured' });
  const emps = getEmps();
  const host = `${req.protocol}://${req.get('host')}`;
  let sent = 0;
  for (let i = 0; i < emps.length; i++) {
    const emp = emps[i];
    if (!emp.portalToken) continue;
    if (emp.policySigned) { emps[i].policySigned = null; }
    if (emp.email) {
      const url = `${host}/employee-portal/${emp.portalToken}`;
      mailer.sendMail({
        to: emp.email,
        subject: `Action Required: Updated ${cfg.policyTitle||'Company Policy'} — Please Re-sign`,
        html: policyReminderEmail(emp, url, cfg.companyPolicy||'', cfg.policyTitle||'Company Policy'),
      }).catch(e => console.error('policy update email:', e.message));
      sent++;
    }
  }
  setEmps(emps);
  res.json({ ok: true, sent });
});

// ── Policy Reminder Email Template ────────────────────────────────────────────
function policyReminderEmail(emp, url, policy, policyTitle) {
  const name = `${emp.firstName} ${emp.lastName}`;
  const d    = new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  const title = policyTitle || 'Company Policy';
  const policyHtml = (policy||'').split('\n').map(l => l
    ? `<div style="margin-bottom:6px;font-size:13px;color:#374151;line-height:1.6">${l}</div>`
    : '<div style="margin-bottom:6px">&nbsp;</div>').join('');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#F4F6FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6FA;padding:40px 0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.12)">
  <tr><td style="background:linear-gradient(135deg,#1D4ED8 0%,#3B82F6 100%);padding:36px 40px">
    <div style="font-size:10px;color:rgba(255,255,255,.7);text-transform:uppercase;letter-spacing:.12em;margin-bottom:12px">Aladdin Finance · HR Compliance</div>
    <div style="font-size:26px;font-weight:800;color:#fff;margin-bottom:6px">📋 Policy Acknowledgement Required</div>
    <div style="font-size:12px;color:rgba(255,255,255,.75)">${d}</div>
  </td></tr>
  <tr><td style="background:#fff;padding:32px 40px">
    <div style="font-size:14px;color:#374151;line-height:1.75;margin-bottom:16px">Dear <strong>${name}</strong>,</div>
    <div style="font-size:14px;color:#374151;line-height:1.75;margin-bottom:24px">
      Please review and acknowledge the <strong>${title}</strong> via your employee self-service portal. Your acknowledgement is required to remain compliant.
    </div>
    <div style="text-align:center;margin-bottom:28px">
      <a href="${url}" style="display:inline-block;background:linear-gradient(135deg,#1D4ED8,#3B82F6);color:#fff;font-size:14px;font-weight:700;padding:14px 32px;border-radius:10px;text-decoration:none">Review &amp; Sign Policy →</a>
    </div>
    ${policy ? `<div style="border-top:1px solid #F3F4F6;padding-top:20px;margin-top:4px"><div style="font-size:10px;color:#6B7280;text-transform:uppercase;letter-spacing:.08em;font-weight:700;margin-bottom:12px">${title}</div><div style="background:#F9FAFB;border-radius:8px;padding:16px;max-height:300px;overflow:hidden">${policyHtml}</div></div>` : ''}
    <p style="font-size:12px;color:#9CA3AF;margin:24px 0 0;line-height:1.7">If you have already signed the policy please disregard this email. Contact HR if you have any questions.</p>
  </td></tr>${FOOTER()}</table></td></tr></table></body></html>`;
}

// ── Send Policy Reminder ───────────────────────────────────────────────────────
router.post('/:id/send-policy-reminder', async (req, res) => {
  const emps = getEmps();
  const i = emps.findIndex(e => e.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  const emp = emps[i];
  if (!emp.portalToken) return res.status(400).json({ error: 'Employee has no portal access' });
  if (emp.policySigned) return res.json({ ok: true, skipped: true, reason: 'Already signed' });
  if (!emp.email) return res.status(400).json({ error: 'No email address' });
  if (!mailer.isConfigured()) return res.status(400).json({ error: 'Email not configured' });
  const cfg  = getCfg();
  const host = `${req.protocol}://${req.get('host')}`;
  const url  = `${host}/employee-portal/${emp.portalToken}`;
  await mailer.sendMail({
    to: emp.email,
    subject: `Action Required: Please Sign the ${cfg.policyTitle||'Company Policy'}`,
    html: policyReminderEmail(emp, url, cfg.companyPolicy||'', cfg.policyTitle||'Company Policy'),
  });
  res.json({ ok: true });
});

// ── Reset Portal Password ─────────────────────────────────────────────────────
router.post('/:id/reset-portal-password', async (req, res) => {
  const emps = getEmps();
  const i = emps.findIndex(e => e.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  const token = crypto.randomBytes(24).toString('hex');
  emps[i].portalToken = token;
  emps[i].portalPassword = null;
  setEmps(emps);
  const emp = emps[i];
  const host = `${req.protocol}://${req.get('host')}`;
  const url = `${host}/employee-portal/${token}`;
  const cfg = getCfg();
  if (emp.email && mailer.isConfigured()) {
    mailer.sendMail({
      to: emp.email,
      subject: 'Your Aladdin Finance Employee Portal — Password Reset',
      html: portalInviteEmail(emp, url, cfg.companyPolicy || '')
    }).catch(e => console.error('reset password email:', e.message));
  }
  res.json({ ok: true, url });
});

// ── Announcements ─────────────────────────────────────────────────────────────
router.get('/announcements', (req, res) => {
  res.json(getAnns());
});

router.post('/announcements', async (req, res) => {
  const { title, body, requiresAck, reminderSettings } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });
  const ann = {
    id:               Date.now(),
    title:            title.trim(),
    body:             (body || '').trim(),
    publishedAt:      new Date().toISOString(),
    publishedBy:      'HR',
    acknowledgements: [],
    requiresAck:      !!requiresAck,
    reminderSettings: requiresAck ? {
      firstReminderHours:  (reminderSettings?.firstReminderHours)  || 24,
      secondReminderHours: (reminderSettings?.secondReminderHours) || 48,
      repeatEveryDays:     (reminderSettings?.repeatEveryDays)     || 3,
      maxReminders:        (reminderSettings?.maxReminders)        || 5,
    } : null,
    remindersSent: {},  // { empId: [isoDate, ...] }
  };
  const anns = getAnns();
  anns.push(ann);
  setAnns(anns);

  // Email all portal employees
  const emps = getEmps().filter(e => e.portalToken && e.email);
  const host = `${req.protocol}://${req.get('host')}`;
  if (mailer.isConfigured()) {
    for (const emp of emps) {
      const portalUrl = `${host}/employee-portal/${emp.portalToken}`;
      mailer.sendMail({
        to: emp.email,
        subject: `📢 New Announcement: ${ann.title}`,
        html: announcementEmail(emp, ann, portalUrl)
      }).catch(e => console.error('announcement email:', e.message));
    }
  }
  res.json({ announcement: ann, emailed: emps.length });
});

// Pending acknowledgements for an announcement
router.get('/announcements/:id/pending-acks', (req, res) => {
  const anns = getAnns();
  const ann  = anns.find(a => a.id === Number(req.params.id));
  if (!ann) return res.status(404).json({ error: 'Not found' });
  const emps       = getEmps().filter(e => e.portalToken);
  const ackedIds   = new Set((ann.acknowledgements||[]).map(a => a.empId));
  const pending    = emps.filter(e => !ackedIds.has(e.id)).map(e => ({
    id: e.id, name: `${e.firstName} ${e.lastName}`, email: e.email||'',
    department: e.department||'', position: e.position||'',
    remindersCount: (ann.remindersSent?.[e.id]||[]).length,
    lastReminder: (ann.remindersSent?.[e.id]||[]).slice(-1)[0] || null,
  }));
  const acked = emps.filter(e => ackedIds.has(e.id)).map(e => ({
    id: e.id, name: `${e.firstName} ${e.lastName}`,
    acknowledgedAt: (ann.acknowledgements||[]).find(a => a.empId === e.id)?.acknowledgedAt,
  }));
  res.json({ pending, acked, total: emps.length });
});

// Manual send reminders for an announcement
router.post('/announcements/:id/send-reminders', requireRole('write'), async (req, res) => {
  const anns = getAnns();
  const annIdx = anns.findIndex(a => a.id === Number(req.params.id));
  if (annIdx === -1) return res.status(404).json({ error: 'Not found' });
  const ann  = anns[annIdx];
  if (!mailer.isConfigured()) return res.status(400).json({ error: 'Email not configured' });
  const emps     = getEmps().filter(e => e.portalToken && e.email);
  const ackedIds = new Set((ann.acknowledgements||[]).map(a => a.empId));
  const pending  = emps.filter(e => !ackedIds.has(e.id));
  const host     = `${req.protocol}://${req.get('host')}`;
  const sent     = [];
  for (const emp of pending) {
    const portalUrl = `${host}/employee-portal/${emp.portalToken}`;
    await mailer.sendMail({ to: emp.email, subject: `⏳ Reminder: Please Acknowledge "${ann.title}"`, html: announcementReminderEmail(emp, ann, portalUrl) }).catch(()=>{});
    if (!ann.remindersSent) ann.remindersSent = {};
    if (!ann.remindersSent[emp.id]) ann.remindersSent[emp.id] = [];
    ann.remindersSent[emp.id].push(new Date().toISOString());
    sent.push(emp.email);
  }
  anns[annIdx] = ann;
  setAnns(anns);
  res.json({ ok: true, sent: sent.length, recipients: sent });
});

router.delete('/announcements/:id', (req, res) => {
  const id = Number(req.params.id);
  setAnns(getAnns().filter(a => a.id !== id));
  res.json({ ok: true });
});

// ── Sales Reps (for Commission & Pipeline sync) ───────────────────────────────
router.get('/sales-reps', (req, res) => {
  const emps = getEmps().filter(e => e.department === 'Sales' && e.status !== 'terminated');
  res.json(emps.map(e => ({
    id:          e.id,
    name:        `${e.firstName} ${e.lastName}`.trim(),
    email:       e.email       || '',
    salesTarget: e.salesTarget || 0,
    startDate:   e.startDate   || ''
  })));
});

module.exports = router;
module.exports.portalGetHandler            = portalGetHandler;
module.exports.portalSetPasswordHandler    = portalSetPasswordHandler;
module.exports.portalLoginHandler          = portalLoginHandler;
module.exports.portalTimeOffHandler        = portalTimeOffHandler;
module.exports.portalRequestHandler        = portalRequestHandler;
module.exports.portalSignPolicyHandler      = portalSignPolicyHandler;
module.exports.portalForgotPasswordHandler  = portalForgotPasswordHandler;
module.exports.portalAcknowledgeHandler     = portalAcknowledgeHandler;

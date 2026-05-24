const { load, save } = require('../data/store');
const { EMAIL_LOG_MAX } = require('./constants');
const mailer = require('./mailer');

function appBaseUrl(port) {
  return process.env.APP_URL || `http://localhost:${port || process.env.PORT || 3000}`;
}

const SETTINGS_DEFAULTS = {
  reportSchedule: 'manual',
  reportNextSend: '',
  reportStopDate: '',
};

// Dubai is UTC+4, no DST
function dubaiNow() {
  return new Date(Date.now() + 4 * 60 * 60 * 1000);
}

function dubaiDateStr() {
  return dubaiNow().toISOString().split('T')[0];
}

function isDubaiSendTime() {
  return dubaiNow().getUTCHours() === 7;
}

function nextSendDate(schedule, fromDate) {
  const d = fromDate ? new Date(fromDate + 'T00:00:00Z') : dubaiNow();
  if (schedule === 'daily')        d.setUTCDate(d.getUTCDate() + 1);
  else if (schedule === 'weekly')  d.setUTCDate(d.getUTCDate() + 7);
  else if (schedule === 'monthly') d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().split('T')[0];
}

function appendEmailLog(cfg, type, to, status, message) {
  const log = cfg.emailSendLog || [];
  log.unshift({ ts: new Date().toISOString(), type, to, status, message });
  if (log.length > EMAIL_LOG_MAX) log.length = EMAIL_LOG_MAX;
  cfg.emailSendLog = log;
}

async function runReportScheduler(PORT) {
  try {
    if (!isDubaiSendTime()) return;
    const cfg = load('app-settings.json', SETTINGS_DEFAULTS);
    const { reportSchedule, reportNextSend, reportStopDate } = cfg;
    if (!reportSchedule || reportSchedule === 'manual' || !reportNextSend) return;
    const today = dubaiDateStr();
    if (reportStopDate && today > reportStopDate) return;
    if (today < reportNextSend) return;

    const perType  = (cfg.financialReportRecipients || []).filter(Boolean);
    const global   = [cfg.ceoEmail, cfg.cpoEmail, ...(cfg.reportRecipients || [])].filter(Boolean);
    const toList   = perType.length ? perType : global;
    if (!toList.length) return;

    const reports = require('../routes/reports');
    const d       = reports.getData();
    const html    = reports.buildEmailHTML(d, appBaseUrl(PORT));

    try {
      await mailer.sendMail({
        to:      toList.join(','),
        subject: `Financial Summary — ${today}`,
        html,
      });
      console.log(`[scheduler] Financial report sent to ${toList.join(', ')}`);
      appendEmailLog(cfg, 'Financial Report (Scheduled)', toList.join(', '), 'sent', `Sent to ${toList.join(', ')}`);
    } catch (mailErr) {
      console.error('[scheduler] Mail send error:', mailErr.message);
      appendEmailLog(cfg, 'Financial Report (Scheduled)', toList.join(', '), 'failed', mailErr.message);
    }

    cfg.reportNextSend = nextSendDate(reportSchedule, today);
    save('app-settings.json', cfg);
  } catch (e) {
    console.error('[scheduler] Report error:', e.message);
  }
}

async function runReminderScheduler(PORT) {
  try {
    if (!isDubaiSendTime()) return;
    const cfg   = load('app-settings.json', {});
    const today = dubaiDateStr();
    const reports = require('../routes/reports');

    for (const role of ['ceo', 'cpo']) {
      const schedKey = role === 'ceo' ? 'ceoReminderSchedule' : 'cpoReminderSchedule';
      const nextKey  = role === 'ceo' ? 'ceoReminderNextSend' : 'cpoReminderNextSend';
      const emailKey = role === 'ceo' ? 'ceoEmail'            : 'cpoEmail';

      const schedule = cfg[schedKey];
      const nextSend = cfg[nextKey];
      if (!schedule || schedule === 'manual' || !nextSend) continue;
      if (today < nextSend) continue;

      const toEmail = cfg[emailKey];
      if (!toEmail || !mailer.isConfigured()) continue;

      try {
        await reports.sendReminderEmail(role, toEmail, appBaseUrl(PORT));
        console.log(`[scheduler] ${role.toUpperCase()} reminders sent to ${toEmail}`);
      } catch (e) {
        console.error(`[scheduler] ${role} reminder error:`, e.message);
      }

      cfg[nextKey] = nextSendDate(schedule, today);
      save('app-settings.json', cfg);
    }
  } catch (e) {
    console.error('[scheduler] Reminder check error:', e.message);
  }
}

async function runDigestScheduler(PORT) {
  try {
    if (!isDubaiSendTime()) return;
    const cfg   = load('app-settings.json', {});
    const today = dubaiDateStr();
    const digests  = cfg.salespersonDigests || [];
    const frequency = cfg.digestBulkFrequency || 'weekly';
    const startDate = cfg.digestBulkStartDate || '';
    const nextKey   = 'digestBulkNextSend';
    const nextSend  = cfg[nextKey] || startDate;

    if (frequency === 'manual' || !nextSend) return;
    if (today < nextSend) return;

    const withEmail = digests.filter(d => d.email);
    if (!withEmail.length) return;
    if (!mailer.isConfigured()) return;

    const reports = require('../routes/reports');
    for (const d of withEmail) {
      try {
        await reports.sendSalespersonDigestEmail(d.owner, d.email, appBaseUrl(PORT));
        console.log(`[scheduler] Digest sent to ${d.owner} <${d.email}>`);
      } catch (e) {
        console.error(`[scheduler] Digest error for ${d.owner}:`, e.message);
      }
    }

    cfg[nextKey] = nextSendDate(frequency, today);
    save('app-settings.json', cfg);
  } catch (e) {
    console.error('[scheduler] Digest error:', e.message);
  }
}

async function runPipelineDigestScheduler(PORT) {
  try {
    if (!isDubaiSendTime()) return;
    const cfg      = load('app-settings.json', {});
    const schedule = cfg.pipelineDigestSchedule;
    const nextSend = cfg.pipelineDigestNextSend;
    if (!schedule || schedule === 'manual' || !nextSend) return;
    const today = dubaiDateStr();
    if (today < nextSend) return;

    const perType    = (cfg.pipelineDigestRecipients || []).filter(Boolean);
    const globalList = [cfg.ceoEmail, cfg.cpoEmail, ...(cfg.reportRecipients||[])].filter(Boolean);
    const toList     = [...new Set(perType.length ? perType : globalList)];
    if (!toList.length) return;

    const reports = require('../routes/reports');
    const baseUrl  = appBaseUrl(PORT);
    try {
      await reports.sendPipelineDigestEmail(toList, baseUrl);
      console.log(`[scheduler] Pipeline digest sent to ${toList.join(', ')}`);
      appendEmailLog(cfg, 'Pipeline Digest (Scheduled)', toList.join(', '), 'sent', `Sent to ${toList.join(', ')}`);
    } catch(e) {
      console.error('[scheduler] Pipeline digest error:', e.message);
      appendEmailLog(cfg, 'Pipeline Digest (Scheduled)', toList.join(', '), 'failed', e.message);
    }

    cfg.pipelineDigestNextSend = nextSendDate(schedule, today);
    save('app-settings.json', cfg);
  } catch(e) { console.error('[scheduler] Pipeline digest error:', e.message); }
}

async function runDailyBriefingScheduler(PORT) {
  try {
    if (!isDubaiSendTime()) return;
    const cfg      = load('app-settings.json', {});
    const schedule = cfg.dailyBriefingSchedule;
    const nextSend = cfg.dailyBriefingNextSend;
    if (!schedule || schedule === 'manual' || !nextSend) return;
    const today = dubaiDateStr();
    if (today < nextSend) return;

    const perType    = (cfg.dailyBriefingRecipients || []).filter(Boolean);
    const globalList = [cfg.ceoEmail, ...(cfg.reportRecipients||[])].filter(Boolean);
    const toList     = [...new Set(perType.length ? perType : globalList)];
    if (!toList.length) return;

    const reports = require('../routes/reports');
    const baseUrl  = appBaseUrl(PORT);
    try {
      await reports.sendDailyBriefingEmail(toList, baseUrl);
      console.log(`[scheduler] Daily briefing sent to ${toList.join(', ')}`);
      appendEmailLog(cfg, 'Daily Briefing (Scheduled)', toList.join(', '), 'sent', `Sent to ${toList.join(', ')}`);
    } catch(e) {
      console.error('[scheduler] Daily briefing error:', e.message);
      appendEmailLog(cfg, 'Daily Briefing (Scheduled)', toList.join(', '), 'failed', e.message);
    }

    cfg.dailyBriefingNextSend = nextSendDate(schedule, today);
    save('app-settings.json', cfg);
  } catch(e) { console.error('[scheduler] Daily briefing error:', e.message); }
}

async function runStaleAlertScheduler(PORT) {
  try {
    if (!isDubaiSendTime()) return;
    const cfg      = load('app-settings.json', {});
    const schedule = cfg.staleAlertSchedule;
    const nextSend = cfg.staleAlertNextSend;
    if (!schedule || schedule === 'manual' || !nextSend) return;
    const today = dubaiDateStr();
    if (today < nextSend) return;

    const reports = require('../routes/reports');
    const baseUrl  = appBaseUrl(PORT);
    try {
      const result = await reports.sendStaleAlertEmail(baseUrl, cfg);
      console.log(`[scheduler] Stale alerts: ${result.message}`);
      appendEmailLog(cfg, 'Stale Deal Alerts (Scheduled)', 'deal owners', 'sent', result.message);
    } catch(e) {
      console.error('[scheduler] Stale alert error:', e.message);
      appendEmailLog(cfg, 'Stale Deal Alerts (Scheduled)', 'deal owners', 'failed', e.message);
    }

    cfg.staleAlertNextSend = nextSendDate(schedule, today);
    save('app-settings.json', cfg);
  } catch(e) { console.error('[scheduler] Stale alert error:', e.message); }
}

async function runSubscriptionRenewalScheduler() {
  try {
    if (!isDubaiSendTime()) return;
    const cfg  = load('sub-settings.json', { reminderDays:[7,30,60], recipients:[] });
    const subs = load('subscriptions', []);
    const days = cfg.reminderDays || [7, 30, 60];
    const rcpt = cfg.recipients || [];
    if (!rcpt.length || !mailer.isConfigured()) return;

    const today = dubaiNow();
    for (const sub of subs.filter(s => s.status === 'active' && s.renewalDate)) {
      const renewal   = new Date(sub.renewalDate + 'T00:00:00');
      const daysUntil = Math.round((renewal - today) / 86400000);
      if (!days.includes(daysUntil)) continue;
      // Don't re-send if already sent today for this sub+day combo
      const sentKey = `sentRenewal_${sub.id}_${daysUntil}`;
      if (cfg[sentKey] === dubaiDateStr()) continue;
      try {
        const urgency = daysUntil <= 7 ? '🔴' : daysUntil <= 14 ? '🟠' : '🟡';
        await mailer.sendMail({
          to: rcpt.join(', '),
          subject: `${urgency} Renewal in ${daysUntil} day${daysUntil !== 1 ? 's' : ''}: ${sub.clientName}`,
          html: buildRenewalReminderHtml(sub, daysUntil),
        });
        cfg[sentKey] = dubaiDateStr();
        console.log(`[scheduler] Renewal reminder sent: ${sub.clientName} (${daysUntil}d)`);
      } catch (e) {
        console.error('[scheduler] Renewal reminder mail error:', e.message);
      }
    }
    save('sub-settings.json', cfg);
  } catch (e) {
    console.error('[scheduler] Renewal scheduler error:', e.message);
  }
}

function buildRenewalReminderHtml(sub, daysUntil) {
  const urgencyColor = daysUntil <= 7 ? '#DC2626' : daysUntil <= 14 ? '#D97706' : '#2563EB';
  const billingMap   = { monthly:'Monthly', quarterly:'Quarterly', yearly:'Annual' };
  const fmtAmt = n => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Number(n)||0);
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:28px 16px;background:#F4F6FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<div style="max-width:540px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.09)">
  <div style="background:${urgencyColor};padding:26px 32px">
    <div style="font-size:11px;color:rgba(255,255,255,.75);text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px">Subscription Renewal Alert</div>
    <div style="font-size:22px;font-weight:800;color:#fff">${sub.clientName}</div>
    <div style="font-size:13px;color:rgba(255,255,255,.88);margin-top:5px">Renews in <strong>${daysUntil} day${daysUntil!==1?'s':''}</strong> — ${sub.renewalDate}</div>
  </div>
  <div style="padding:24px 32px">
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr style="border-bottom:1px solid #E4E7EC"><td style="padding:9px 0;color:#5E6C84">Billing Cycle</td><td style="padding:9px 0;font-weight:600;text-align:right">${billingMap[sub.billing]||sub.billing||'—'}</td></tr>
      <tr style="border-bottom:1px solid #E4E7EC"><td style="padding:9px 0;color:#5E6C84">Amount</td><td style="padding:9px 0;font-weight:600;text-align:right">${fmtAmt(sub.amount)}</td></tr>
      ${sub.seats?`<tr style="border-bottom:1px solid #E4E7EC"><td style="padding:9px 0;color:#5E6C84">Seats / Licenses</td><td style="padding:9px 0;font-weight:600;text-align:right">${sub.seats}</td></tr>`:''}
      ${sub.plan?`<tr style="border-bottom:1px solid #E4E7EC"><td style="padding:9px 0;color:#5E6C84">Plan / Tier</td><td style="padding:9px 0;font-weight:600;text-align:right">${sub.plan}</td></tr>`:''}
    </table>
    ${daysUntil <= 7 ? `<div style="margin-top:16px;background:#FEF2F2;border:1px solid #FCA5A5;border-radius:8px;padding:12px 16px;font-size:12px;color:#7F1D1D">⚠ <strong>Urgent:</strong> Renewal is in ${daysUntil} day${daysUntil!==1?'s':''}. Confirm with the client immediately.</div>` : ''}
  </div>
  <div style="background:#F4F6FA;padding:14px 32px;text-align:center">
    <div style="font-size:10px;color:#97A0AF">CFO Genie · Subscription Renewal Reminder · Automated</div>
  </div>
</div></body></html>`;
}

// ── Announcement Acknowledgement Reminders ────────────────────────────────────
async function runAnnouncementReminderScheduler() {
  try {
    const { load, save } = require('../data/store');
    const mailerMod = require('./mailer');
    if (!mailerMod.isConfigured()) return;

    const anns = load('announcements.json', []);
    const emps = load('hr-employees.json', []).filter(e => e.portalToken && e.email);
    const now  = Date.now();
    let changed = false;

    for (const ann of anns) {
      if (!ann.requiresAck || !ann.reminderSettings) continue;
      const { firstReminderHours = 24, secondReminderHours = 48, repeatEveryDays = 3, maxReminders = 5 } = ann.reminderSettings;
      const publishedAt = new Date(ann.publishedAt).getTime();
      const ackedIds = new Set((ann.acknowledgements||[]).map(a => a.empId));
      const pending  = emps.filter(e => !ackedIds.has(e.id) && e.portalToken);
      if (!pending.length) continue;
      if (!ann.remindersSent) ann.remindersSent = {};

      for (const emp of pending) {
        const prevSends = ann.remindersSent[emp.id] || [];
        if (prevSends.length >= maxReminders) continue;

        const lastSentMs   = prevSends.length ? new Date(prevSends[prevSends.length - 1]).getTime() : 0;
        const hoursSincePublish = (now - publishedAt) / (1000 * 3600);
        let shouldSend = false;

        if (prevSends.length === 0 && hoursSincePublish >= firstReminderHours) shouldSend = true;
        else if (prevSends.length === 1 && hoursSincePublish >= secondReminderHours && (now - lastSentMs) > 3600000) shouldSend = true;
        else if (prevSends.length >= 2 && (now - lastSentMs) >= repeatEveryDays * 24 * 3600000) shouldSend = true;

        if (!shouldSend) continue;
        const hrEmps = load('hr-employees.json', []);
        const empRecord = hrEmps.find(e => e.id === emp.id);
        if (!empRecord?.portalToken) continue;

        const host = (process.env.APP_URL || `http://localhost:${process.env.PORT||3000}`);
        const portalUrl = `${host}/employee-portal/${empRecord.portalToken}`;
        const { announcementReminderEmailFn } = require('../routes/hr');

        // Build reminder email inline (hr route template not directly exported — use a self-contained approach)
        const name     = `${emp.firstName} ${emp.lastName}`;
        const bodyHtml = (ann.body||'').split('\n').map(l => l ? `<div style="margin-bottom:6px;font-size:13px;color:#374151;line-height:1.65">${l}</div>` : '<div style="margin-bottom:6px">&nbsp;</div>').join('');
        const published = ann.publishedAt ? new Date(ann.publishedAt).toLocaleDateString('en-US',{day:'2-digit',month:'short',year:'numeric'}) : '';
        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#F4F6FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6FA;padding:40px 0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.12)">
<tr><td style="background:linear-gradient(135deg,#92400E 0%,#D97706 100%);padding:36px 40px">
  <div style="font-size:10px;color:rgba(255,255,255,.65);text-transform:uppercase;letter-spacing:.12em;margin-bottom:12px">Aladdin Finance · Reminder</div>
  <div style="font-size:26px;font-weight:800;color:#fff">⏳ Acknowledgement Required</div>
  <div style="font-size:11px;color:rgba(255,255,255,.65);margin-top:4px">Published ${published}</div>
</td></tr>
<tr><td style="background:#fff;padding:32px 40px">
  <div style="font-size:14px;color:#374151;margin-bottom:16px">Dear <strong>${name}</strong>, please acknowledge the following announcement:</div>
  <div style="background:#FFFBEB;border:1px solid #FCD34D;border-radius:12px;padding:22px 24px;margin-bottom:24px">
    <div style="font-size:16px;font-weight:800;color:#92400E;margin-bottom:12px">${ann.title}</div>
    <div style="font-size:13px;color:#374151;line-height:1.7">${bodyHtml}</div>
  </div>
  <div style="text-align:center;margin-bottom:20px">
    <a href="${portalUrl}#announcements" style="display:inline-block;background:linear-gradient(135deg,#D97706,#F59E0B);color:#fff;font-size:14px;font-weight:700;padding:14px 36px;border-radius:10px;text-decoration:none">✓ Acknowledge Now →</a>
  </div>
</td></tr></table></td></tr></table></body></html>`;

        await mailerMod.sendMail({ to: emp.email, subject: `⏳ Reminder (${prevSends.length+1}): Please Acknowledge "${ann.title}"`, html }).catch(()=>{});
        if (!ann.remindersSent[emp.id]) ann.remindersSent[emp.id] = [];
        ann.remindersSent[emp.id].push(new Date().toISOString());
        changed = true;
      }
    }
    if (changed) save('announcements.json', anns);
  } catch(e) { console.error('Announcement reminder scheduler error:', e.message); }
}

// ── Birthday & Work Anniversary Celebration Scheduler ─────────────────────────
async function runCelebrationScheduler() {
  try {
    if (!isDubaiSendTime()) return;
    const { load, save } = require('../data/store');
    const mailerMod = require('./mailer');
    if (!mailerMod.isConfigured()) return;

    const cel  = load('celebration-settings.json', {});
    if (cel.enabled === false) return;

    const cfg  = load('hr-settings.json', {});
    const emps = load('hr-employees.json', []).filter(e => e.status !== 'terminated' && e.email);
    const log  = load('celebration-log.json', {});
    const today = dubaiDateStr();
    const todayMD = today.slice(5); // MM-DD
    const todayYear = today.slice(0,4);
    let changed = false;

    const DEFAULT_B_SUBJ = 'Happy Birthday, {{firstName}}! 🎂';
    const DEFAULT_A_SUBJ = 'Happy {{years}}-Year Work Anniversary, {{firstName}}! 🏆';

    const applyVars = (str, emp, extra) => {
      const vars = { firstName: emp.firstName||'', fullName:`${emp.firstName} ${emp.lastName}`.trim(), department:emp.department||'', position:emp.position||'', ...extra };
      return str.replace(/\{\{(\w+)\}\}/g, (_,k) => vars[k]!==undefined?vars[k]:`{{${k}}}`);
    };

    const advanceDays = Number(cel.advanceNoticeDays) || 3;

    for (const emp of emps) {

      // ── Birthday ──
      if (cel.birthdayEnabled !== false && emp.dob) {
        const dobMD = emp.dob.slice(5);

        // Actual birthday today → send celebration to employee
        if (dobMD === todayMD) {
          const logKey = `${todayYear}-${emp.id}-birthday`;
          if (!log[logKey]) {
            const subj = applyVars(cel.birthdaySubject || DEFAULT_B_SUBJ, emp);
            const html = _buildBirthdayCelebrationHtml(emp, cel);
            await mailerMod.sendMail({ to: emp.email, subject: subj, html }).catch(()=>{});
            if (cfg.hrEmail) {
              const hrHtml = _buildBirthdayReminderHtml(emp, 0);
              await mailerMod.sendMail({ to: cfg.hrEmail, subject: `🎂 Birthday Today: ${emp.firstName} ${emp.lastName}`, html: hrHtml }).catch(()=>{});
            }
            log[logKey] = today;
            changed = true;
          }
        }

        // Advance notice (X days before) → send to HR + employee
        if (advanceDays > 0) {
          const advanceDate = new Date(today + 'T00:00:00Z');
          advanceDate.setUTCDate(advanceDate.getUTCDate() + advanceDays);
          const advanceMD = `${String(advanceDate.getUTCMonth()+1).padStart(2,'0')}-${String(advanceDate.getUTCDate()).padStart(2,'0')}`;
          if (dobMD === advanceMD) {
            const logKey = `${todayYear}-${emp.id}-birthday-advance`;
            if (!log[logKey]) {
              // To employee
              if (cel.employeeAdvanceNoticeEnabled !== false) {
                const html = _buildBirthdayAdvanceHtml(emp, advanceDays);
                await mailerMod.sendMail({ to: emp.email, subject: `🎂 Your Birthday is in ${advanceDays} day${advanceDays!==1?'s':''}!`, html }).catch(()=>{});
              }
              // To HR
              if (cel.hrAdvanceNoticeEnabled !== false && cfg.hrEmail) {
                const hrHtml = _buildBirthdayReminderHtml(emp, advanceDays);
                await mailerMod.sendMail({ to: cfg.hrEmail, subject: `🎂 Upcoming Birthday in ${advanceDays} day${advanceDays!==1?'s':''}: ${emp.firstName} ${emp.lastName}`, html: hrHtml }).catch(()=>{});
              }
              log[logKey] = today;
              changed = true;
            }
          }
        }
      }

      // ── Work Anniversary ──
      if (cel.anniversaryEnabled !== false && emp.startDate) {
        const startMD   = emp.startDate.slice(5);
        const startYear = parseInt(emp.startDate.slice(0,4),10);

        if (startMD === todayMD) {
          const years = parseInt(todayYear,10) - startYear;
          if (years > 0) {
            const logKey = `${todayYear}-${emp.id}-anniversary`;
            if (!log[logKey]) {
              const extra  = { years: String(years), yearsPlural: years!==1?'s':'' };
              const subj   = applyVars(cel.anniversarySubject || DEFAULT_A_SUBJ, emp, extra);
              const html   = _buildAnniversaryCelebrationHtml(emp, years, cel);
              await mailerMod.sendMail({ to: emp.email, subject: subj, html }).catch(()=>{});
              if (cfg.hrEmail) {
                const hrHtml = _buildAnniversaryReminderHtml(emp, years, 0);
                await mailerMod.sendMail({ to: cfg.hrEmail, subject: `🏆 Work Anniversary Today: ${emp.firstName} ${emp.lastName} — ${years} Year${years!==1?'s':''}`, html: hrHtml }).catch(()=>{});
              }
              log[logKey] = today;
              changed = true;
            }
          }
        }

        if (advanceDays > 0) {
          const advanceDate = new Date(today + 'T00:00:00Z');
          advanceDate.setUTCDate(advanceDate.getUTCDate() + advanceDays);
          const advanceMD = `${String(advanceDate.getUTCMonth()+1).padStart(2,'0')}-${String(advanceDate.getUTCDate()).padStart(2,'0')}`;
          if (startMD === advanceMD) {
            const years = parseInt(todayYear,10) - startYear + (advanceDays > 0 ? 0 : 0); // anniversary will be in `advanceDays` days but in same year
            const futureYear = advanceDate.getUTCFullYear();
            const futureYears = futureYear - startYear;
            if (futureYears > 0) {
              const logKey = `${todayYear}-${emp.id}-anniversary-advance`;
              if (!log[logKey]) {
                if (cel.employeeAdvanceNoticeEnabled !== false) {
                  const html = _buildAnniversaryAdvanceHtml(emp, futureYears, advanceDays);
                  await mailerMod.sendMail({ to: emp.email, subject: `🏆 Your ${futureYears}-Year Work Anniversary is in ${advanceDays} day${advanceDays!==1?'s':''}!`, html }).catch(()=>{});
                }
                if (cel.hrAdvanceNoticeEnabled !== false && cfg.hrEmail) {
                  const hrHtml = _buildAnniversaryReminderHtml(emp, futureYears, advanceDays);
                  await mailerMod.sendMail({ to: cfg.hrEmail, subject: `🏆 Upcoming Anniversary in ${advanceDays} day${advanceDays!==1?'s':''}: ${emp.firstName} ${emp.lastName} — ${futureYears} Year${futureYears!==1?'s':''}`, html: hrHtml }).catch(()=>{});
                }
                log[logKey] = today;
                changed = true;
              }
            }
          }
        }
      }
    }

    if (changed) save('celebration-log.json', log);
  } catch(e) { console.error('Celebration scheduler error:', e.message); }
}

// Minimal inline HTML builders (avoid circular require with hr.js)
function _buildBirthdayCelebrationHtml(emp, cel) {
  const DEFAULT = { birthdayBody: 'Dear {{firstName}},\n\nHappy Birthday from all of us at Aladdin Finance! 🎂\n\nWarm regards,\nAladdin Finance HR Team' };
  const applyVars = (str, e) => str.replace(/\{\{(\w+)\}\}/g, (_,k) => ({firstName:e.firstName,fullName:`${e.firstName} ${e.lastName}`,department:e.department||'',position:e.position||''})[k]||'');
  const body = applyVars(cel.birthdayBody || DEFAULT.birthdayBody, emp).split('\n').map(l => l ? `<div style="font-size:14px;color:#374151;line-height:1.75;margin-bottom:8px">${l}</div>` : '<div style="margin-bottom:8px">&nbsp;</div>').join('');
  return `<!DOCTYPE html><html><body style="margin:0;background:#F4F6FA;font-family:sans-serif"><table width="100%" style="padding:40px 0"><tr><td align="center"><table width="600" style="border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.12)"><tr><td style="background:linear-gradient(135deg,#DB2777,#EC4899);padding:40px;text-align:center"><div style="font-size:10px;color:rgba(255,255,255,.7);text-transform:uppercase;letter-spacing:.1em;margin-bottom:12px">Aladdin Finance · Celebration</div><div style="font-size:52px;margin-bottom:10px">🎂</div><div style="font-size:24px;font-weight:800;color:#fff">Happy Birthday, ${emp.firstName}!</div></td></tr><tr><td style="background:#fff;padding:32px 40px">${body}</td></tr></table></td></tr></table></body></html>`;
}
function _buildAnniversaryCelebrationHtml(emp, years, cel) {
  const DEFAULT = { anniversaryBody: 'Dear {{firstName}},\n\nCongratulations on {{years}} year{{yearsPlural}} with Aladdin Finance! 🏆\n\nWarm regards,\nAladdin Finance HR Team' };
  const extra = { years:String(years), yearsPlural:years!==1?'s':'' };
  const vars  = { firstName:emp.firstName,fullName:`${emp.firstName} ${emp.lastName}`,department:emp.department||'',position:emp.position||'',...extra };
  const body  = (cel.anniversaryBody||DEFAULT.anniversaryBody).replace(/\{\{(\w+)\}\}/g,(_,k)=>vars[k]||'').split('\n').map(l=>l?`<div style="font-size:14px;color:#374151;line-height:1.75;margin-bottom:8px">${l}</div>`:'<div style="margin-bottom:8px">&nbsp;</div>').join('');
  return `<!DOCTYPE html><html><body style="margin:0;background:#F4F6FA;font-family:sans-serif"><table width="100%" style="padding:40px 0"><tr><td align="center"><table width="600" style="border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.12)"><tr><td style="background:linear-gradient(135deg,#0F766E,#14B8A6);padding:40px;text-align:center"><div style="font-size:10px;color:rgba(255,255,255,.7);text-transform:uppercase;letter-spacing:.1em;margin-bottom:12px">Aladdin Finance · Celebration</div><div style="font-size:52px;margin-bottom:10px">🏆</div><div style="font-size:24px;font-weight:800;color:#fff">Happy ${years}-Year Anniversary, ${emp.firstName}!</div></td></tr><tr><td style="background:#fff;padding:32px 40px">${body}</td></tr></table></td></tr></table></body></html>`;
}
function _buildBirthdayReminderHtml(emp, daysUntil) {
  const when = daysUntil === 0 ? 'TODAY' : daysUntil === 1 ? 'TOMORROW' : `IN ${daysUntil} DAYS`;
  return `<!DOCTYPE html><html><body style="margin:0;background:#F4F6FA;font-family:sans-serif"><table width="100%" style="padding:40px 0"><tr><td align="center"><table width="600" style="border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.12)"><tr><td style="background:linear-gradient(135deg,#DB2777,#EC4899);padding:36px 40px"><div style="font-size:10px;color:rgba(255,255,255,.7);text-transform:uppercase;letter-spacing:.1em;margin-bottom:10px">Aladdin Finance · HR Notification</div><div style="font-size:36px;margin-bottom:10px">🎂</div><div style="font-size:22px;font-weight:800;color:#fff">Birthday ${daysUntil===0?'Today':daysUntil===1?'Tomorrow':'in '+daysUntil+' Days'}: ${emp.firstName} ${emp.lastName}</div></td></tr><tr><td style="background:#fff;padding:28px 40px"><div style="font-size:13px;color:#374151">A celebration email has been ${daysUntil===0?'sent':'scheduled'} to <strong>${emp.firstName}</strong> ${daysUntil===0?'today':'in '+daysUntil+' days'}. You can intervene or customize before it goes out.</div></td></tr></table></td></tr></table></body></html>`;
}
function _buildAnniversaryReminderHtml(emp, years, daysUntil) {
  return `<!DOCTYPE html><html><body style="margin:0;background:#F4F6FA;font-family:sans-serif"><table width="100%" style="padding:40px 0"><tr><td align="center"><table width="600" style="border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.12)"><tr><td style="background:linear-gradient(135deg,#0F766E,#14B8A6);padding:36px 40px"><div style="font-size:10px;color:rgba(255,255,255,.7);text-transform:uppercase;letter-spacing:.1em;margin-bottom:10px">Aladdin Finance · HR Notification</div><div style="font-size:36px;margin-bottom:10px">🏆</div><div style="font-size:22px;font-weight:800;color:#fff">${years}-Year Anniversary ${daysUntil===0?'Today':'in '+daysUntil+' Days'}: ${emp.firstName} ${emp.lastName}</div></td></tr><tr><td style="background:#fff;padding:28px 40px"><div style="font-size:13px;color:#374151">A celebration email has been ${daysUntil===0?'sent':'scheduled'} to <strong>${emp.firstName}</strong> marking their <strong>${years}-year</strong> work anniversary${daysUntil===0?'':' in '+daysUntil+' days'}.</div></td></tr></table></td></tr></table></body></html>`;
}
function _buildBirthdayAdvanceHtml(emp, daysUntil) {
  const when = daysUntil === 1 ? 'tomorrow' : `in ${daysUntil} days`;
  return `<!DOCTYPE html><html><body style="margin:0;background:#F4F6FA;font-family:sans-serif"><table width="100%" style="padding:40px 0"><tr><td align="center"><table width="600" style="border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.12)"><tr><td style="background:linear-gradient(135deg,#DB2777,#EC4899);padding:36px 40px;text-align:center"><div style="font-size:10px;color:rgba(255,255,255,.7);text-transform:uppercase;letter-spacing:.1em;margin-bottom:10px">Aladdin Finance · Birthday Coming Up</div><div style="font-size:40px;margin-bottom:10px">🎂</div><div style="font-size:22px;font-weight:800;color:#fff">Your Birthday is ${when}, ${emp.firstName}!</div></td></tr><tr><td style="background:#fff;padding:28px 40px"><div style="font-size:14px;color:#374151;line-height:1.8">Dear <strong>${emp.firstName}</strong>,<br><br>Your birthday is <strong>${when}</strong>! The Aladdin Finance team is excited to celebrate with you. Look out for a special message on your big day.<br><br>Warm regards,<br><strong>Aladdin Finance HR Team</strong></div></td></tr></table></td></tr></table></body></html>`;
}
function _buildAnniversaryAdvanceHtml(emp, years, daysUntil) {
  const when = daysUntil === 1 ? 'tomorrow' : `in ${daysUntil} days`;
  return `<!DOCTYPE html><html><body style="margin:0;background:#F4F6FA;font-family:sans-serif"><table width="100%" style="padding:40px 0"><tr><td align="center"><table width="600" style="border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.12)"><tr><td style="background:linear-gradient(135deg,#0F766E,#14B8A6);padding:36px 40px;text-align:center"><div style="font-size:10px;color:rgba(255,255,255,.7);text-transform:uppercase;letter-spacing:.1em;margin-bottom:10px">Aladdin Finance · Work Anniversary Coming Up</div><div style="font-size:40px;margin-bottom:10px">🏆</div><div style="font-size:22px;font-weight:800;color:#fff">Your ${years}-Year Anniversary is ${when}!</div></td></tr><tr><td style="background:#fff;padding:28px 40px"><div style="font-size:14px;color:#374151;line-height:1.8">Dear <strong>${emp.firstName}</strong>,<br><br>Your <strong>${years}-year work anniversary</strong> at Aladdin Finance is <strong>${when}</strong>! Thank you for your dedication and contributions. We'll be celebrating with you soon.<br><br>Warm regards,<br><strong>Aladdin Finance HR Team</strong></div></td></tr></table></td></tr></table></body></html>`;
}

const INTERVAL_MS = 60 * 60 * 1000; // check every hour

function start(PORT) {
  // Run immediately on startup in case server restarted during the 7 AM window
  runReportScheduler(PORT);
  runReminderScheduler(PORT);
  runDigestScheduler(PORT);
  runPipelineDigestScheduler(PORT);
  runDailyBriefingScheduler(PORT);
  runStaleAlertScheduler(PORT);
  runSubscriptionRenewalScheduler();
  runAnnouncementReminderScheduler();
  runCelebrationScheduler();

  setInterval(() => runReportScheduler(PORT),              INTERVAL_MS);
  setInterval(() => runReminderScheduler(PORT),             INTERVAL_MS);
  setInterval(() => runDigestScheduler(PORT),               INTERVAL_MS);
  setInterval(() => runPipelineDigestScheduler(PORT),       INTERVAL_MS);
  setInterval(() => runDailyBriefingScheduler(PORT),        INTERVAL_MS);
  setInterval(() => runStaleAlertScheduler(PORT),           INTERVAL_MS);
  setInterval(() => runSubscriptionRenewalScheduler(),      INTERVAL_MS);
  setInterval(() => runAnnouncementReminderScheduler(),     INTERVAL_MS);
  setInterval(() => runCelebrationScheduler(),              INTERVAL_MS);
}

// Called by Cloud Scheduler (Firebase) — runs all hourly jobs once
async function runHourly(port) {
  const p = port || process.env.PORT || 3000;
  await Promise.allSettled([
    runReportScheduler(p),
    runReminderScheduler(p),
    runDigestScheduler(p),
    runPipelineDigestScheduler(p),
    runDailyBriefingScheduler(p),
    runStaleAlertScheduler(p),
    runSubscriptionRenewalScheduler(),
    runAnnouncementReminderScheduler(),
    runCelebrationScheduler(),
  ]);
}

module.exports = { start, runHourly, dubaiNow, dubaiDateStr };

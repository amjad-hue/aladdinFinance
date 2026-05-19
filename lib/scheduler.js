const { load, save } = require('../data/store');
const { EMAIL_LOG_MAX } = require('./constants');
const mailer = require('./mailer');

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
    const html    = reports.buildEmailHTML(d, `http://localhost:${PORT}`);

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
        await reports.sendReminderEmail(role, toEmail, `http://localhost:${PORT}`);
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
        await reports.sendSalespersonDigestEmail(d.owner, d.email, `http://localhost:${PORT}`);
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
    const baseUrl  = `http://localhost:${PORT}`;
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
    const baseUrl  = `http://localhost:${PORT}`;
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
    const baseUrl  = `http://localhost:${PORT}`;
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

const INTERVAL_MS = 60 * 60 * 1000; // check every hour

function start(PORT) {
  // Run immediately on startup in case server restarted during the 7 AM window
  runReportScheduler(PORT);
  runReminderScheduler(PORT);
  runDigestScheduler(PORT);
  runPipelineDigestScheduler(PORT);
  runDailyBriefingScheduler(PORT);
  runStaleAlertScheduler(PORT);

  setInterval(() => runReportScheduler(PORT),         INTERVAL_MS);
  setInterval(() => runReminderScheduler(PORT),        INTERVAL_MS);
  setInterval(() => runDigestScheduler(PORT),          INTERVAL_MS);
  setInterval(() => runPipelineDigestScheduler(PORT),  INTERVAL_MS);
  setInterval(() => runDailyBriefingScheduler(PORT),   INTERVAL_MS);
  setInterval(() => runStaleAlertScheduler(PORT),      INTERVAL_MS);
}

module.exports = { start, dubaiNow, dubaiDateStr };

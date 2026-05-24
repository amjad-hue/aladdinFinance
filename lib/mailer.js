const nodemailer = require('nodemailer');

function isSmtpConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function isGmailApiConfigured() {
  const { load } = require('../data/store');
  const tokens = load('gcal_tokens.json', null);
  if (!tokens?.refresh_token) return false;
  return (tokens.scope || '').includes('gmail');
}

function isConfigured() {
  return isSmtpConfigured() || isGmailApiConfigured();
}

function createTransport() {
  const port = Number(process.env.SMTP_PORT) || 587;
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST || 'smtp.gmail.com',
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

function fromAddress() {
  return process.env.SMTP_FROM || process.env.SMTP_USER;
}

async function sendViaGmailApi(options) {
  const { load, save } = require('../data/store');
  const { google } = require('googleapis');
  const tokens = load('gcal_tokens.json', null);
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/events/gcal/callback'
  );
  oauth2.setCredentials(tokens);
  oauth2.on('tokens', updated => save('gcal_tokens.json', { ...tokens, ...updated }));
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });

  const from = tokens._email || 'me';
  const to   = Array.isArray(options.to) ? options.to.join(', ') : options.to;
  const body = options.html || (options.text
    ? `<pre style="font-family:inherit;white-space:pre-wrap">${options.text}</pre>`
    : '');

  const icsAttachment = (options.attachments || []).find(a =>
    (a.contentType || '').includes('text/calendar')
  );

  let raw;
  if (icsAttachment) {
    const boundary = `cfogenie_${Date.now()}`;
    const icsContent = typeof icsAttachment.content === 'string'
      ? icsAttachment.content
      : icsAttachment.content.toString('utf8');
    raw = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: =?UTF-8?B?${Buffer.from(options.subject || '', 'utf8').toString('base64')}?=`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(body, 'utf8').toString('base64'),
      '',
      `--${boundary}`,
      'Content-Type: text/calendar; method=REQUEST; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      'Content-Disposition: attachment; filename="invite.ics"',
      '',
      Buffer.from(icsContent, 'utf8').toString('base64'),
      '',
      `--${boundary}--`
    ].join('\r\n');
  } else {
    raw = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: =?UTF-8?B?${Buffer.from(options.subject || '', 'utf8').toString('base64')}?=`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      '',
      body
    ].join('\r\n');
  }

  const encoded = Buffer.from(raw).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encoded } });
}

async function sendMail(options) {
  if (isSmtpConfigured()) {
    return createTransport().sendMail({ from: fromAddress(), ...options });
  }
  if (isGmailApiConfigured()) {
    return sendViaGmailApi(options);
  }
  throw new Error('No email method configured. Set SMTP credentials or connect Gmail in Settings.');
}

module.exports = { isConfigured, isSmtpConfigured, isGmailApiConfigured, createTransport, fromAddress, sendMail };

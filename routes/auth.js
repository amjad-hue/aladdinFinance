const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const { load, save }         = require('../data/store');
const { JWT_SECRET, JWT_EXPIRES } = require('../config');
const { validatePassword }   = require('../lib/validate');
const mailer                 = require('../lib/mailer');

function getUsers()    { return load('users.json', { users: [], invitations: [] }); }
function saveUsers(d)  { save('users.json', d); }

function ensureAdmin() {
  const db = getUsers();
  if (db.users.length === 0) {
    db.users.push({
      id: 1, email: 'Amjad@aladdinb2b.com',
      passwordHash: bcrypt.hashSync('Shak@Shak1998', 10),
      name: 'Amjad', role: 'admin',
      createdAt: new Date().toISOString(), lastLogin: null,
    });
    saveUsers(db);
  }
}
// In production (Firestore mode) the admin is seeded via data/migrate.js — skip here
if (process.env.NODE_ENV !== 'production') ensureAdmin();

function signToken(user) {
  return jwt.sign(
    { userId: user.id, email: user.email, name: user.name, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name, title: user.title || '', role: user.role };
}

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const db   = getUsers();
  const user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  user.lastLogin = new Date().toISOString();
  saveUsers(db);
  res.json({ token: signToken(user), user: publicUser(user) });
});

router.post('/invite', async (req, res) => {
  const { email, role, name } = req.body;
  if (!email || !role) return res.status(400).json({ error: 'Email and role required' });
  const db = getUsers();
  if (db.users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(409).json({ error: 'User already exists' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  const inv   = {
    id: Date.now(), email, role, name: name || '', token,
    createdAt:  new Date().toISOString(),
    expiresAt:  new Date(Date.now() + 7 * 86400000).toISOString(),
    usedAt: null,
  };
  db.invitations.push(inv);
  saveUsers(db);

  const link = `${process.env.APP_URL || 'http://localhost:3000'}/register?token=${token}`;

  if (mailer.isConfigured()) {
    const cfg       = load('app-settings.json', {});
    const brand     = cfg.emailTemplates?.brandName || 'CFO Genie';
    const accent    = cfg.emailTemplates?.accentColor || '#FF6600';
    const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
    const firstName = (name || email.split('@')[0]).split(' ')[0];

    const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F4F6FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F4F6FA;padding:40px 0">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%">

  <!-- Header -->
  <tr><td style="background:linear-gradient(135deg,${accent} 0%,${accent}CC 100%);border-radius:16px 16px 0 0;padding:32px 36px">
    <table width="100%"><tr>
      <td>
        <table cellpadding="0" cellspacing="0"><tr>
          <td style="width:42px;height:42px;background:rgba(255,255,255,0.2);border-radius:11px;text-align:center;vertical-align:middle">
            <span style="font-family:'Montserrat',Arial,sans-serif;font-size:18px;font-weight:900;color:#fff;line-height:42px;display:block">A</span>
          </td>
          <td style="padding-left:12px;vertical-align:middle">
            <div style="font-family:'Montserrat',Arial,sans-serif;font-size:16px;font-weight:800;color:#fff;letter-spacing:-.01em">${brand}</div>
            <div style="font-size:10px;color:rgba(255,255,255,0.7);margin-top:1px;letter-spacing:.08em;text-transform:uppercase">Finance Command Center</div>
          </td>
        </tr></table>
      </td>
      <td align="right">
        <span style="background:rgba(255,255,255,0.18);color:#fff;font-size:10px;font-weight:700;padding:4px 12px;border-radius:20px;text-transform:uppercase;letter-spacing:.06em">${roleLabel}</span>
      </td>
    </tr></table>
  </td></tr>

  <!-- Body -->
  <tr><td style="background:#ffffff;padding:36px 36px 28px">
    <div style="font-size:22px;font-weight:800;color:#111;margin-bottom:8px;font-family:'Montserrat',Arial,sans-serif">You're invited! 🎉</div>
    <div style="font-size:14px;color:#555;line-height:1.6;margin-bottom:24px">
      Hi ${firstName},<br><br>
      You've been invited to join <strong style="color:#111">${brand}</strong> as a <strong style="color:${accent}">${roleLabel}</strong>.
      Click the button below to set up your account and get access to the CFO Command Center.
    </div>

    <!-- CTA Button -->
    <table cellpadding="0" cellspacing="0" style="margin:0 auto 28px">
      <tr><td align="center" style="border-radius:10px;background:linear-gradient(135deg,${accent},${accent}CC)">
        <a href="${link}" style="display:inline-block;padding:14px 36px;color:#fff;text-decoration:none;font-weight:800;font-size:14px;font-family:'Montserrat',Arial,sans-serif;letter-spacing:.02em;border-radius:10px">
          Accept Invitation →
        </a>
      </td></tr>
    </table>

    <!-- What you'll get -->
    <div style="background:#F8F9FB;border-radius:12px;padding:20px 22px;margin-bottom:24px">
      <div style="font-size:11px;font-weight:700;color:#97A0AF;text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">What you'll have access to</div>
      ${[
        ['📊', 'Financial dashboards — cash, AR, liabilities & revenue'],
        ['📋', 'Task management with CEO & CPO reminders'],
        ['📈', 'Pipeline tracking & salesperson digests'],
        ['📧', 'Automated email reports & briefings'],
      ].map(([icon, text]) => `
      <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid #EEF0F4">
        <span style="font-size:16px;flex-shrink:0">${icon}</span>
        <span style="font-size:12px;color:#444;line-height:1.4">${text}</span>
      </div>`).join('')}
    </div>

    <!-- Link fallback -->
    <div style="background:#FFF7F5;border:1px solid #FFD4C0;border-radius:9px;padding:14px 16px;margin-bottom:8px">
      <div style="font-size:10px;font-weight:700;color:#97A0AF;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Or copy this link into your browser</div>
      <div style="font-size:11px;color:${accent};word-break:break-all;font-family:monospace">${link}</div>
    </div>

    <div style="font-size:11px;color:#BBB;margin-top:16px">This invitation expires in <strong>7 days</strong>. If you didn't expect this email, you can safely ignore it.</div>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#F4F6FA;padding:16px 36px;border-radius:0 0 16px 16px;text-align:center">
    <div style="font-size:10px;color:#BBB">${brand} · Powered by CFO Genie</div>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;

    mailer.sendMail({
      to:      email,
      subject: `You're invited to join ${brand}`,
      html,
    }).catch(err => console.error('[auth] invite email error:', err.message));
  }

  res.json({ invitation: { ...inv, token: undefined }, link: `/register?token=${token}`, emailSent: mailer.isConfigured() });
});

router.get('/invite/:token', (req, res) => {
  const db  = getUsers();
  const inv = db.invitations.find(i => i.token === req.params.token && !i.usedAt);
  if (!inv || new Date(inv.expiresAt) < new Date()) {
    return res.status(404).json({ error: 'Invalid or expired invitation' });
  }
  res.json({ email: inv.email, role: inv.role, name: inv.name });
});

router.post('/register', (req, res) => {
  const { token, password, name } = req.body;
  if (!token || !password || !name) return res.status(400).json({ error: 'All fields required' });
  if (name.trim().length < 2) return res.status(400).json({ error: 'Name must be at least 2 characters' });
  const pwErr = validatePassword(password);
  if (pwErr) return res.status(400).json({ error: pwErr });
  const db  = getUsers();
  const inv = db.invitations.find(i => i.token === token && !i.usedAt);
  if (!inv || new Date(inv.expiresAt) < new Date()) {
    return res.status(404).json({ error: 'Invalid or expired invitation' });
  }
  const user = {
    id: Date.now(), email: inv.email,
    passwordHash: bcrypt.hashSync(password, 10),
    name, role: inv.role,
    createdAt: new Date().toISOString(), lastLogin: null,
  };
  db.users.push(user);
  inv.usedAt = new Date().toISOString();
  saveUsers(db);
  res.json({ token: signToken(user), user: publicUser(user) });
});

router.get('/me', require('../middleware/auth'), (req, res) => {
  const db   = getUsers();
  const user = db.users.find(u => u.id === req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ id: user.id, email: user.email, name: user.name, title: user.title || '', role: user.role, lastLogin: user.lastLogin });
});

router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const db   = getUsers();
  const user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    user.resetToken       = token;
    user.resetTokenExpiry = new Date(Date.now() + 3600000).toISOString();
    saveUsers(db);
    if (mailer.isConfigured()) {
      const resetLink = `${process.env.APP_URL || 'http://localhost:3000'}/?reset=${token}`;
      mailer.sendMail({
        to:      user.email,
        subject: 'Reset your Aladdin Finance password',
        html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
          <h2 style="color:#FF681A;margin-bottom:12px">Password Reset</h2>
          <p style="color:#444;margin-bottom:20px">Click the button below to reset your password. This link expires in 1 hour.</p>
          <a href="${resetLink}" style="display:inline-block;padding:12px 24px;background:#FF681A;color:#fff;border-radius:8px;text-decoration:none;font-weight:700">Reset Password</a>
          <p style="color:#aaa;font-size:12px;margin-top:20px">If you didn't request this, ignore this email.</p>
        </div>`,
      }).catch(err => console.error('[auth] forgot-password email error:', err.message));
    }
  }
  res.json({ ok: true });
});

router.post('/reset-password', (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Token and password required' });
  const pwErr = validatePassword(password);
  if (pwErr) return res.status(400).json({ error: pwErr });
  const db   = getUsers();
  const user = db.users.find(u => u.resetToken === token && u.resetTokenExpiry && new Date(u.resetTokenExpiry) > new Date());
  if (!user) return res.status(400).json({ error: 'Invalid or expired reset link. Please request a new one.' });
  user.passwordHash = bcrypt.hashSync(password, 10);
  delete user.resetToken;
  delete user.resetTokenExpiry;
  saveUsers(db);
  res.json({ ok: true });
});

router.put('/profile', require('../middleware/auth'), (req, res) => {
  const { name, title } = req.body;
  const db   = getUsers();
  const user = db.users.find(u => u.id === req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (name && name.trim())     user.name  = name.trim();
  if (title !== undefined)     user.title = title.trim();
  saveUsers(db);
  res.json({ user: publicUser(user) });
});

router.post('/change-password', require('../middleware/auth'), (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
  const pwErr = validatePassword(newPassword);
  if (pwErr) return res.status(400).json({ error: pwErr });
  const db   = getUsers();
  const user = db.users.find(u => u.id === req.user.userId);
  if (!user || !bcrypt.compareSync(currentPassword, user.passwordHash)) {
    return res.status(401).json({ error: 'Current password incorrect' });
  }
  user.passwordHash = bcrypt.hashSync(newPassword, 10);
  saveUsers(db);
  res.json({ ok: true });
});

module.exports = router;

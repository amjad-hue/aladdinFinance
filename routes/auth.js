const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { load, save } = require('../data/store');

const JWT_SECRET = process.env.JWT_SECRET || 'aladdin-finance-secret-2026';
const JWT_EXPIRES = '24h';

function getUsers() { return load('users.json', { users: [], invitations: [] }); }
function saveUsers(d) { save('users.json', d); }

function ensureAdmin() {
  const db = getUsers();
  if (db.users.length === 0) {
    db.users.push({
      id: 1, email: 'admin@aladdinfinance.com',
      passwordHash: bcrypt.hashSync('Admin123!', 10),
      name: 'Admin', role: 'admin',
      createdAt: new Date().toISOString(), lastLogin: null
    });
    saveUsers(db);
  }
}
ensureAdmin();

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const db = getUsers();
  const user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  user.lastLogin = new Date().toISOString();
  saveUsers(db);
  const token = jwt.sign({ userId: user.id, email: user.email, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
  res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

router.post('/invite', (req, res) => {
  const { email, role, name } = req.body;
  if (!email || !role) return res.status(400).json({ error: 'Email and role required' });
  const db = getUsers();
  if (db.users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(409).json({ error: 'User already exists' });
  }
  const token = require('crypto').randomBytes(32).toString('hex');
  const inv = { id: Date.now(), email, role, name: name || '', token, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(), usedAt: null };
  db.invitations.push(inv);
  saveUsers(db);
  res.json({ invitation: inv, link: `/register?token=${token}` });
});

router.get('/invite/:token', (req, res) => {
  const db = getUsers();
  const inv = db.invitations.find(i => i.token === req.params.token && !i.usedAt);
  if (!inv || new Date(inv.expiresAt) < new Date()) return res.status(404).json({ error: 'Invalid or expired invitation' });
  res.json({ email: inv.email, role: inv.role, name: inv.name });
});

router.post('/register', (req, res) => {
  const { token, password, name } = req.body;
  if (!token || !password || !name) return res.status(400).json({ error: 'All fields required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const db = getUsers();
  const inv = db.invitations.find(i => i.token === token && !i.usedAt);
  if (!inv || new Date(inv.expiresAt) < new Date()) return res.status(404).json({ error: 'Invalid or expired invitation' });
  const user = { id: Date.now(), email: inv.email, passwordHash: bcrypt.hashSync(password, 10), name, role: inv.role, createdAt: new Date().toISOString(), lastLogin: null };
  db.users.push(user);
  inv.usedAt = new Date().toISOString();
  saveUsers(db);
  const jwtToken = jwt.sign({ userId: user.id, email: user.email, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
  res.json({ token: jwtToken, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

router.get('/me', require('../middleware/auth'), (req, res) => {
  const db = getUsers();
  const user = db.users.find(u => u.id === req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ id: user.id, email: user.email, name: user.name, role: user.role, lastLogin: user.lastLogin });
});

router.post('/change-password', require('../middleware/auth'), (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const db = getUsers();
  const user = db.users.find(u => u.id === req.user.userId);
  if (!user || !bcrypt.compareSync(currentPassword, user.passwordHash)) return res.status(401).json({ error: 'Current password incorrect' });
  user.passwordHash = bcrypt.hashSync(newPassword, 10);
  saveUsers(db);
  res.json({ ok: true });
});

module.exports = router;

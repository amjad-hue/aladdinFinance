const router = require('express').Router();
const { load, save } = require('../data/store');

function getUsers() { return load('users.json', { users: [], invitations: [] }); }
function saveUsers(d) { save('users.json', d); }

router.get('/', (req, res) => {
  const db    = getUsers();
  const isAdmin = req.user?.role === 'admin';
  const users = db.users.map(u => ({ id: u.id, email: u.email, name: u.name, role: u.role, createdAt: u.createdAt, lastLogin: u.lastLogin }));
  const invitations = db.invitations.map(i => ({
    id: i.id, email: i.email, role: i.role, name: i.name,
    createdAt: i.createdAt, expiresAt: i.expiresAt, usedAt: i.usedAt,
    ...(isAdmin ? { token: i.token } : {}),
  }));
  res.json({ users, invitations });
});

router.put('/:id', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const db = getUsers();
  const user = db.users.find(u => u.id === Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'Not found' });
  if (req.body.name) user.name = req.body.name;
  if (req.body.role) user.role = req.body.role;
  saveUsers(db);
  res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

router.delete('/:id', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const db = getUsers();
  if (Number(req.params.id) === req.user.userId) return res.status(400).json({ error: 'Cannot delete yourself' });
  db.users = db.users.filter(u => u.id !== Number(req.params.id));
  saveUsers(db);
  res.json({ ok: true });
});

router.delete('/invitations/:id', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const db = getUsers();
  db.invitations = db.invitations.filter(i => i.id !== Number(req.params.id));
  saveUsers(db);
  res.json({ ok: true });
});

// ── Per-user preferences (dashboard layout, etc.) ─────────────────────────────
router.get('/me/prefs', (req, res) => {
  const db = getUsers();
  const user = db.users.find(u => u.id === req.user.userId);
  res.json(user?.preferences || {});
});

router.put('/me/prefs', (req, res) => {
  const db = getUsers();
  const user = db.users.find(u => u.id === req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.preferences = { ...(user.preferences || {}), ...req.body };
  saveUsers(db);
  res.json({ ok: true });
});

module.exports = router;

// Role-based access control middleware.
//
// Usage:
//   router.post('/', requireRole('write'), handler)   — blocks viewer/sales on mutations
//   router.delete('/:id', requireRole('admin'), handler) — admin-only
//
// Role hierarchy:
//   admin   — full access (all operations)
//   cfo     — full access (all financial operations, cannot manage users)
//   finance — read + write financial data, no user/settings management
//   sales   — pipeline + settings only (enforced in frontend AND here)
//   viewer  — read-only across all modules

const WRITE_ROLES = ['admin', 'cfo', 'finance'];
const ADMIN_ROLES = ['admin'];

function requireRole(level) {
  return (req, res, next) => {
    const role = req.user?.role;
    if (!role) return res.status(401).json({ error: 'Unauthorized' });

    if (level === 'admin' && !ADMIN_ROLES.includes(role)) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    if (level === 'write' && !WRITE_ROLES.includes(role)) {
      return res.status(403).json({ error: 'Read-only access — your role does not permit modifications' });
    }
    if (level === 'finance' && !WRITE_ROLES.includes(role)) {
      return res.status(403).json({ error: 'Finance access required' });
    }
    next();
  };
}

module.exports = { requireRole };

function validatePassword(password) {
  if (!password || password.length < 8)    return 'Password must be at least 8 characters';
  if (!/[A-Z]/.test(password))             return 'Password must contain at least one uppercase letter';
  if (!/[0-9]/.test(password))             return 'Password must contain at least one number';
  return null;
}

function sanitizeStr(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/[\x00-\x1F\x7F]/g, '');
}

module.exports = { validatePassword, sanitizeStr };

// Central config — all sensitive values come from environment only.
// A missing JWT_SECRET in production is a critical security flaw.

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error('[FATAL] JWT_SECRET is not set. Set it in your .env file before running in production.');
    process.exit(1);
  } else {
    console.warn('\n⚠  WARNING: JWT_SECRET not set in .env — using insecure default. Set JWT_SECRET before going to production.\n');
  }
}

module.exports = {
  JWT_SECRET: JWT_SECRET || 'aladdin-finance-dev-secret-do-not-use-in-production',
  JWT_EXPIRES: '24h',
};

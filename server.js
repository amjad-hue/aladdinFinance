const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const path       = require('path');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Security middleware ───────────────────────────────────────────────────────
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`];

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

// ── Body parsing ──────────────────────────────────────────────────────────────
// Raw body for Stripe webhook (must be before express.json so signature can be verified)
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Static assets ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use('/media', express.static(path.join(__dirname, 'media')));

// ── Auth rate limiter (brute-force protection) ────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — please try again later' },
});

// ── Public routes (no JWT required) ──────────────────────────────────────────
app.use('/api/auth', authLimiter, require('./routes/auth'));
app.get('/api/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

const eventsRoute = require('./routes/events');
app.get('/api/events/gcal/auth',        eventsRoute.gcalAuth);
app.get('/api/events/gcal/callback',   eventsRoute.gcalCallback);
app.delete('/api/events/gcal/disconnect', eventsRoute.gcalDisconnect);

app.get('/api/tasks/complete-by-token/:token', require('./routes/tasks').completeByToken);

const stripeRoute = require('./routes/stripe');
app.post('/api/stripe/webhook', stripeRoute.webhookHandler);

const reportsRoute = require('./routes/reports');
app.get('/api/reports/preview',                      reportsRoute.previewHandler);
app.get('/api/reports/task-reminder-preview',        reportsRoute.taskReminderPreviewHandler);
app.get('/api/reports/daily-briefing-preview',       reportsRoute.dailyBriefingPreviewHandler);
app.get('/api/reports/project-report-preview/:id',   reportsRoute.projectReportPreviewHandler);

const requestsRoute = require('./routes/requests');
app.get('/api/requests/form/:token',          requestsRoute.publicFormHandler);
app.post('/api/requests/submit/:token',       requestsRoute.publicSubmitHandler);
app.get('/api/requests/respond/:token',       requestsRoute.publicRespondHandler);
app.post('/api/requests/respond/:token',      requestsRoute.publicRespondSubmitHandler);
app.get('/request/:token',          (_req, res) => res.sendFile(path.join(__dirname, 'public', 'request-form.html')));
app.get('/request-respond/:token',  (_req, res) => res.sendFile(path.join(__dirname, 'public', 'request-respond.html')));

const projectsRoute = require('./routes/projects');
app.get('/api/projects/petty/:token',            projectsRoute.pettyFormHandler);
app.post('/api/projects/petty/:token',           projectsRoute.pettySubmitHandler);
app.post('/api/projects/petty/:token/upload',    projectsRoute.pettyUploadHandler);
app.get('/petty-cash/:token', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'petty-cash.html')));

const hrRoute = require('./routes/hr');
app.post('/api/hr/portal/login',              hrRoute.portalLoginHandler);
app.post('/api/hr/portal/forgot-password',    (req, res) => { req._host = `${req.protocol}://${req.get('host')}`; hrRoute.portalForgotPasswordHandler(req, res); });
app.get('/api/hr/portal/:token',              hrRoute.portalGetHandler);
app.post('/api/hr/portal/:token/set-password', hrRoute.portalSetPasswordHandler);
app.post('/api/hr/portal/:token/time-off',    hrRoute.portalTimeOffHandler);
app.post('/api/hr/portal/:token/request',     hrRoute.portalRequestHandler);
app.post('/api/hr/portal/:token/sign-policy', hrRoute.portalSignPolicyHandler);
app.get('/api/hr/portal/:token/acknowledge/:annId', hrRoute.portalAcknowledgeHandler);
app.get('/employee-portal/:token', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'employee-portal.html')));
app.get('/employee-portal',        (_req, res) => res.sendFile(path.join(__dirname, 'public', 'employee-portal.html')));
app.get('/employee-login',         (_req, res) => res.redirect('/employee-portal'));

// ── Protected routes (JWT required) ──────────────────────────────────────────
const authMiddleware = require('./middleware/auth');
app.use('/api', authMiddleware);

app.use('/api/cash',         require('./routes/cash'));
app.use('/api/reserves',     require('./routes/reserves'));
app.use('/api/cashflow',     require('./routes/cashflow'));
app.use('/api/budget',       require('./routes/budget'));
app.use('/api/revenue',      require('./routes/revenue'));
app.use('/api/clients',      require('./routes/clients'));
app.use('/api/events',       require('./routes/events'));
app.use('/api/tasks',        require('./routes/tasks'));
app.use('/api/files',        require('./routes/files'));
app.use('/api/sync',         require('./routes/sync'));
app.use('/api/pipeline',     require('./routes/pipeline'));
app.use('/api/statements',   require('./routes/statements'));
app.use('/api/users',        require('./routes/users'));
app.use('/api/liabilities',  require('./routes/liabilities'));
app.use('/api/ar',           require('./routes/ar'));
app.use('/api/reports',      require('./routes/reports'));
app.use('/api/commissions',  require('./routes/commissions'));
app.use('/api/projects',     require('./routes/projects'));
app.use('/api/app-settings', require('./routes/settings'));
app.use('/api/requests',     require('./routes/requests'));
app.use('/api/hr',           require('./routes/hr'));
app.use('/api/subscriptions', require('./routes/subscriptions'));
app.use('/api/stripe',        stripeRoute.router);
app.use('/api/gmail',        require('./routes/gmail'));
app.use('/api',              require('./routes/admin'));

// ── SPA fallback ──────────────────────────────────────────────────────────────
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('Server error:', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('===================================================');
  console.log('  Aladdin Finance v2 — CFO Command Center');
  console.log('===================================================');
  console.log(`  Server:  http://localhost:${PORT}`);
  console.log('===================================================');
  console.log('');
});

require('./lib/scheduler').start(PORT);

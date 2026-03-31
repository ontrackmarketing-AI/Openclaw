import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import logger from './logger.js';
import { readMessages, sendMessage, getRecentContacts } from './imessage.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = Number(process.env.PORT) || 4000;
const BIND_ADDRESS = process.env.BIND_ADDRESS || '0.0.0.0';
const BRIDGE_SECRET = process.env.BRIDGE_SECRET;

if (!BRIDGE_SECRET) {
  logger.error('BRIDGE_SECRET is not set. Refusing to start without authentication.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '64kb' }));

// ---------------------------------------------------------------------------
// Auth middleware — every route except /health requires the shared secret
// ---------------------------------------------------------------------------

function authMiddleware(req, res, next) {
  // Allow unauthenticated health checks so load balancers / monitors work.
  if (req.path === '/health') return next();

  const token = req.headers['x-bridge-secret'];

  if (!token || token !== BRIDGE_SECRET) {
    logger.warn('Unauthorized request', { ip: req.ip, path: req.path });
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

app.use(authMiddleware);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET /health — lightweight liveness check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', platform: process.platform });
});

// GET /messages?contact=PHONE_OR_EMAIL&limit=20
app.get('/messages', (req, res) => {
  try {
    const { contact, limit } = req.query;

    if (!contact) {
      return res.status(400).json({ error: 'Missing required query parameter: contact' });
    }

    const messages = readMessages(contact, limit ? Number(limit) : 20);
    res.json({ messages });
  } catch (err) {
    logger.error('GET /messages failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// POST /send — send an iMessage
app.post('/send', (req, res) => {
  try {
    const { to, message } = req.body;

    if (!to || !message) {
      return res.status(400).json({ error: 'Missing required fields: to, message' });
    }

    sendMessage(to, message);
    res.json({ status: 'sent', to });
  } catch (err) {
    logger.error('POST /send failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// GET /contacts — list recent iMessage contacts
app.get('/contacts', (req, res) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const contacts = getRecentContacts(limit);
    res.json({ contacts });
  } catch (err) {
    logger.error('GET /contacts failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// Catch-all 404
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err, _req, res, _next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(PORT, BIND_ADDRESS, () => {
  logger.info(`iMessage bridge listening on ${BIND_ADDRESS}:${PORT}`);
  logger.info(`Platform: ${process.platform}`);
});

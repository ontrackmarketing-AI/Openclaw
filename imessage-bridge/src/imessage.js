import { execSync } from 'child_process';
import { homedir } from 'os';
import { existsSync } from 'fs';
import path from 'path';
import logger from './logger.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHAT_DB_PATH = path.join(homedir(), 'Library', 'Messages', 'chat.db');

// Whitelist: only allow alphanumeric, +, @, ., -, _, and space in contacts.
// This prevents SQL injection when building sqlite3 queries.
const CONTACT_PATTERN = /^[a-zA-Z0-9+@.\-_ ]+$/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Validate and sanitize a contact identifier (phone number or email).
 * Throws if the value contains disallowed characters.
 */
function sanitizeContact(contact) {
  if (!contact || typeof contact !== 'string') {
    throw new Error('Contact must be a non-empty string');
  }

  const trimmed = contact.trim();

  if (!CONTACT_PATTERN.test(trimmed)) {
    throw new Error(
      'Contact contains invalid characters. Allowed: alphanumeric, +, @, ., -, _, space'
    );
  }

  return trimmed;
}

/**
 * Validate that `limit` is a safe positive integer.
 */
function sanitizeLimit(limit) {
  const n = Number(limit);
  if (!Number.isInteger(n) || n < 1 || n > 500) {
    throw new Error('Limit must be an integer between 1 and 500');
  }
  return n;
}

/**
 * Escape a string for embedding inside an AppleScript double-quoted string.
 * AppleScript uses backslash-escapes inside double quotes.
 */
function escapeAppleScript(str) {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

/**
 * Run a sqlite3 query against chat.db and return the rows as JSON.
 * Uses the sqlite3 CLI's -json mode (available on macOS Ventura+).
 */
function queryDb(sql) {
  if (!existsSync(CHAT_DB_PATH)) {
    throw new Error(
      `iMessage database not found at ${CHAT_DB_PATH}. ` +
      'Make sure this is running on macOS with Full Disk Access granted.'
    );
  }

  try {
    const raw = execSync(
      `sqlite3 -json -readonly "${CHAT_DB_PATH}" "${sql.replace(/"/g, '\\"')}"`,
      { encoding: 'utf-8', timeout: 10_000 }
    );

    if (!raw.trim()) return [];
    return JSON.parse(raw);
  } catch (err) {
    logger.error('sqlite3 query failed', { error: err.message });
    throw new Error(`Database query failed: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read recent iMessages for a given contact (phone number or email).
 *
 * Returns an array of { text, is_from_me, date, handle } sorted newest-first.
 */
export function readMessages(contact, limit = 20) {
  const safeContact = sanitizeContact(contact);
  const safeLimit = sanitizeLimit(limit);

  // The LIKE pattern matches partial handles — e.g. "+1555" matches "+15551234567".
  const query = `
    SELECT
      m.text,
      m.is_from_me,
      datetime(m.date / 1000000000 + 978307200, 'unixepoch', 'localtime') AS date,
      h.id AS handle
    FROM message m
    LEFT JOIN handle h ON m.handle_id = h.ROWID
    LEFT JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
    LEFT JOIN chat c ON cmj.chat_id = c.ROWID
    WHERE h.id LIKE '%${safeContact}%'
      AND m.text IS NOT NULL
    ORDER BY m.date DESC
    LIMIT ${safeLimit};
  `;

  const rows = queryDb(query);

  return rows.map((row) => ({
    text: row.text,
    isFromMe: row.is_from_me === 1,
    date: row.date,
    handle: row.handle,
  }));
}

/**
 * Send an iMessage to the given recipient.
 *
 * @param {string} to    Phone number (e.g. "+15551234567") or Apple ID email.
 * @param {string} message  The message body.
 */
export function sendMessage(to, message) {
  const safeTo = sanitizeContact(to);

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    throw new Error('Message must be a non-empty string');
  }

  if (message.length > 10_000) {
    throw new Error('Message exceeds maximum length of 10 000 characters');
  }

  const escapedTo = escapeAppleScript(safeTo);
  const escapedMsg = escapeAppleScript(message);

  // Build the AppleScript.  We pass it via -e flags to osascript.
  // Using double-quoted AppleScript strings that we have already escaped.
  const script = [
    'tell application "Messages"',
    '  set targetService to 1st account whose service type = iMessage',
    `  set targetBuddy to participant "${escapedTo}" of targetService`,
    `  send "${escapedMsg}" to targetBuddy`,
    'end tell',
  ].join('\n');

  try {
    // Pass script via stdin to avoid shell-quoting issues.
    execSync('osascript', {
      input: script,
      encoding: 'utf-8',
      timeout: 30_000,
    });

    logger.info('Message sent', { to: safeTo, length: message.length });
  } catch (err) {
    logger.error('osascript send failed', { error: err.message, to: safeTo });
    throw new Error(`Failed to send iMessage: ${err.message}`);
  }
}

/**
 * Return a list of distinct recent contacts from the iMessage database.
 *
 * Each entry: { handle, displayName, lastMessageDate }
 */
export function getRecentContacts(limit = 50) {
  const safeLimit = sanitizeLimit(limit);

  const query = `
    SELECT
      h.id AS handle,
      COALESCE(h.uncanonicalized_id, h.id) AS display_name,
      datetime(MAX(m.date) / 1000000000 + 978307200, 'unixepoch', 'localtime') AS last_message_date,
      COUNT(m.ROWID) AS message_count
    FROM handle h
    JOIN message m ON m.handle_id = h.ROWID
    WHERE m.text IS NOT NULL
    GROUP BY h.id
    ORDER BY MAX(m.date) DESC
    LIMIT ${safeLimit};
  `;

  const rows = queryDb(query);

  return rows.map((row) => ({
    handle: row.handle,
    displayName: row.display_name,
    lastMessageDate: row.last_message_date,
    messageCount: row.message_count,
  }));
}

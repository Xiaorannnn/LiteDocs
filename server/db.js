const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(password, salt, 32).toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(password, salt, 32);
  return crypto.timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS shares (
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('editor','viewer')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (document_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents(owner_id);
CREATE INDEX IF NOT EXISTS idx_shares_user ON shares(user_id);
`;

const DEMO_PASSWORD = 'demo1234';
const DEMO_USERS = [
  ['alice@ajaia.test', 'Alice Chen'],
  ['bob@ajaia.test', 'Bob Martins'],
  ['carol@ajaia.test', 'Carol Reyes'],
];

const WELCOME_HTML =
  '<h1>Welcome to LiteDocs</h1>' +
  '<p>This document is owned by <strong>Alice</strong> and shared with <strong>Bob</strong> as an <em>editor</em>. ' +
  'Sign in as either user to see it under "My documents" or "Shared with me".</p>' +
  '<h2>Try these</h2>' +
  '<ul><li>Format text with the toolbar: <strong>bold</strong>, <em>italic</em>, <u>underline</u>.</li>' +
  '<li>Add headings and bulleted or numbered lists.</li>' +
  '<li>Upload a .txt, .md or .docx file from the home screen.</li></ul>';

function openDb(file = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  seed(db);
  return db;
}

function seed(db) {
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) return;
  const now = new Date().toISOString();
  const insertUser = db.prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)');
  const ids = DEMO_USERS.map(([email, name]) => insertUser.run(email, name, hashPassword(DEMO_PASSWORD)).lastInsertRowid);
  const doc = db
    .prepare('INSERT INTO documents (owner_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(ids[0], 'Welcome to LiteDocs', WELCOME_HTML, now, now);
  db.prepare('INSERT INTO shares (document_id, user_id, role, created_at) VALUES (?, ?, ?, ?)').run(doc.lastInsertRowid, ids[1], 'editor', now);
}

module.exports = { openDb, verifyPassword, hashPassword, DEMO_PASSWORD };

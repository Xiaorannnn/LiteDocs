const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const mammoth = require('mammoth');
const { marked } = require('marked');
const sanitizeHtml = require('sanitize-html');
const { verifyPassword } = require('./db');

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const MAX_CONTENT_CHARS = 1_000_000;
const ALLOWED_EXTENSIONS = ['.txt', '.md', '.docx'];
const ROLES = ['editor', 'viewer'];
const SESSION_MAX_AGE_S = 7 * 24 * 3600;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Whitelist matches what the editor (Quill 1.x) can produce, plus Quill's own ql-* classes (indent, alignment).
const SANITIZE_OPTIONS = {
  allowedTags: ['p', 'br', 'strong', 'em', 'u', 's', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'a', 'pre', 'code'],
  allowedAttributes: { a: ['href', 'target', 'rel'], '*': ['class'] },
  allowedClasses: { '*': ['ql-*'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }) },
};
const sanitize = (html) => sanitizeHtml(html, SANITIZE_OPTIONS);

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k] = decodeURIComponent(v.join('='));
  }
  return out;
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function cleanTitle(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, 'Title cannot be empty.');
  if (value.trim().length > 200) throw new HttpError(400, 'Title must be 200 characters or fewer.');
  return value.trim();
}

async function fileToHtml(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext === '.txt') {
    const text = file.buffer.toString('utf8').replace(/\r\n/g, '\n').trim();
    if (!text) return '<p><br></p>';
    return text
      .split(/\n{2,}/)
      .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
      .join('');
  }
  if (ext === '.md') return marked.parse(file.buffer.toString('utf8'));
  if (ext === '.docx') return (await mammoth.convertToHtml({ buffer: file.buffer })).value;
  throw new HttpError(400, 'Unsupported file type.');
}

function createApp(db) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '2mb' }));

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!ALLOWED_EXTENSIONS.includes(ext)) return cb(new HttpError(400, `Unsupported file type. Upload ${ALLOWED_EXTENSIONS.join(', ')}.`));
      cb(null, true);
    },
  });

  const q = {
    userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    userBySession: db.prepare('SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?'),
    createSession: db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
    owned: db.prepare(`SELECT d.id, d.title, d.updated_at, (SELECT COUNT(*) FROM shares s WHERE s.document_id = d.id) AS share_count
                       FROM documents d WHERE d.owner_id = ? ORDER BY d.updated_at DESC`),
    shared: db.prepare(`SELECT d.id, d.title, d.updated_at, s.role, u.name AS owner_name
                        FROM shares s JOIN documents d ON d.id = s.document_id JOIN users u ON u.id = d.owner_id
                        WHERE s.user_id = ? ORDER BY d.updated_at DESC`),
    doc: db.prepare('SELECT d.*, u.name AS owner_name FROM documents d JOIN users u ON u.id = d.owner_id WHERE d.id = ?'),
    shareRole: db.prepare('SELECT role FROM shares WHERE document_id = ? AND user_id = ?'),
    shareList: db.prepare(`SELECT u.id AS user_id, u.name, u.email, s.role FROM shares s JOIN users u ON u.id = s.user_id
                           WHERE s.document_id = ? ORDER BY u.name`),
    insertDoc: db.prepare('INSERT INTO documents (owner_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'),
    updateDoc: db.prepare('UPDATE documents SET title = ?, content = ?, version = ?, updated_at = ? WHERE id = ?'),
    deleteDoc: db.prepare('DELETE FROM documents WHERE id = ?'),
    upsertShare: db.prepare(`INSERT INTO shares (document_id, user_id, role, created_at) VALUES (?, ?, ?, ?)
                             ON CONFLICT(document_id, user_id) DO UPDATE SET role = excluded.role`),
    deleteShare: db.prepare('DELETE FROM shares WHERE document_id = ? AND user_id = ?'),
  };

  // ---------- auth ----------
  app.use((req, res, next) => {
    const token = parseCookies(req.headers.cookie).sid;
    req.sessionToken = token;
    req.user = token ? q.userBySession.get(token) || null : null;
    next();
  });
  const requireAuth = (req, res, next) => (req.user ? next() : next(new HttpError(401, 'Please sign in.')));

  app.get('/healthz', (req, res) => res.json({ ok: true }));

  app.post('/api/login', (req, res) => {
    const { email, password } = req.body || {};
    const user = typeof email === 'string' ? q.userByEmail.get(email.trim().toLowerCase()) : null;
    if (!user || typeof password !== 'string' || !verifyPassword(password, user.password_hash)) {
      throw new HttpError(401, 'Incorrect email or password.');
    }
    const token = crypto.randomBytes(24).toString('hex');
    q.createSession.run(token, user.id, new Date().toISOString());
    const secure = req.secure ? '; Secure' : '';
    res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_S}${secure}`);
    res.json({ user: { id: user.id, email: user.email, name: user.name } });
  });

  app.post('/api/logout', (req, res) => {
    if (req.sessionToken) q.deleteSession.run(req.sessionToken);
    res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    res.json({ ok: true });
  });

  app.get('/api/me', requireAuth, (req, res) => res.json({ user: req.user }));

  // ---------- access helper ----------
  // Returns 404 (not 403) when the user has no access so document existence is not leaked.
  function loadWithAccess(req, { need }) {
    const doc = q.doc.get(Number(req.params.id));
    if (!doc) throw new HttpError(404, 'Document not found.');
    let role = null;
    if (doc.owner_id === req.user.id) role = 'owner';
    else role = q.shareRole.get(doc.id, req.user.id)?.role || null;
    if (!role) throw new HttpError(404, 'Document not found.');
    const rank = { viewer: 1, editor: 2, owner: 3 };
    if (rank[role] < rank[need]) {
      throw new HttpError(403, need === 'owner' ? 'Only the owner can do that.' : 'You have view-only access to this document.');
    }
    return { doc, role };
  }

  // ---------- documents ----------
  app.get('/api/documents', requireAuth, (req, res) => {
    res.json({ owned: q.owned.all(req.user.id), shared: q.shared.all(req.user.id) });
  });

  app.post('/api/documents', requireAuth, (req, res) => {
    const title = cleanTitle(req.body?.title, 'Untitled document');
    const now = new Date().toISOString();
    const id = q.insertDoc.run(req.user.id, title, '<p><br></p>', now, now).lastInsertRowid;
    res.status(201).json({ id });
  });

  app.post(
    '/api/documents/import',
    requireAuth,
    upload.single('file'),
    wrap(async (req, res) => {
      if (!req.file) throw new HttpError(400, 'Choose a file to upload.');
      let html;
      try {
        html = sanitize(await fileToHtml(req.file));
      } catch (err) {
        if (err instanceof HttpError) throw err;
        throw new HttpError(422, 'We could not read that file. Check that it is a valid .txt, .md or .docx file.');
      }
      const base = path.basename(req.file.originalname, path.extname(req.file.originalname)).slice(0, 200).trim();
      const now = new Date().toISOString();
      const id = q.insertDoc.run(req.user.id, base || 'Imported document', html || '<p><br></p>', now, now).lastInsertRowid;
      res.status(201).json({ id });
    })
  );

  app.get('/api/documents/:id', requireAuth, (req, res) => {
    const { doc, role } = loadWithAccess(req, { need: 'viewer' });
    res.json({
      document: { id: doc.id, title: doc.title, content: doc.content, version: doc.version, updated_at: doc.updated_at, owner_name: doc.owner_name },
      role,
      shares: role === 'owner' ? q.shareList.all(doc.id) : undefined,
    });
  });

  app.patch('/api/documents/:id', requireAuth, (req, res) => {
    const { doc } = loadWithAccess(req, { need: 'editor' });
    const { title, content, baseVersion } = req.body || {};
    const newTitle = cleanTitle(title, doc.title);
    let newContent = doc.content;
    let version = doc.version;
    if (content !== undefined) {
      if (typeof content !== 'string') throw new HttpError(400, 'Content must be a string.');
      if (content.length > MAX_CONTENT_CHARS) throw new HttpError(413, 'Document is too large to save.');
      if (baseVersion !== undefined && baseVersion !== doc.version) {
        const err = new HttpError(409, 'Someone else saved a newer version of this document.');
        err.extra = { currentVersion: doc.version };
        throw err;
      }
      newContent = sanitize(content);
      version = doc.version + 1;
    }
    const now = new Date().toISOString();
    q.updateDoc.run(newTitle, newContent, version, now, doc.id);
    res.json({ version, updated_at: now, title: newTitle });
  });

  app.delete('/api/documents/:id', requireAuth, (req, res) => {
    const { doc } = loadWithAccess(req, { need: 'owner' });
    q.deleteDoc.run(doc.id);
    res.json({ ok: true });
  });

  // ---------- sharing ----------
  app.post('/api/documents/:id/shares', requireAuth, (req, res) => {
    const { doc } = loadWithAccess(req, { need: 'owner' });
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const role = req.body?.role || 'editor';
    if (!email) throw new HttpError(400, 'Enter an email address.');
    if (!ROLES.includes(role)) throw new HttpError(400, 'Role must be editor or viewer.');
    const target = q.userByEmail.get(email);
    if (!target) throw new HttpError(404, 'No user with that email. Try alice@, bob@ or carol@ajaia.test.');
    if (target.id === doc.owner_id) throw new HttpError(400, 'You already own this document.');
    q.upsertShare.run(doc.id, target.id, role, new Date().toISOString());
    res.status(201).json({ shares: q.shareList.all(doc.id) });
  });

  app.delete('/api/documents/:id/shares/:userId', requireAuth, (req, res) => {
    const { doc } = loadWithAccess(req, { need: 'owner' });
    q.deleteShare.run(doc.id, Number(req.params.userId));
    res.json({ shares: q.shareList.all(doc.id) });
  });

  // ---------- static + errors ----------
  app.use('/api', (req, res, next) => next(new HttpError(404, 'Not found.')));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      return res.status(tooBig ? 413 : 400).json({ error: tooBig ? 'That file is larger than 2 MB.' : 'Upload failed.' });
    }
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.' });
    const status = err.status || 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: status === 500 ? 'Something went wrong on our side.' : err.message, ...err.extra });
  });

  return app;
}

module.exports = { createApp, sanitize };

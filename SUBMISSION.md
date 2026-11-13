# Submission contents

## Links
- **Live product:** `<PASTE DEPLOYED URL>`
- **Walkthrough video:** see `VIDEO_URL.txt`

## Review credentials
All accounts use password `demo1234`: `alice@ajaia.test` (owner of seeded doc), `bob@ajaia.test` (editor on it), `carol@ajaia.test` (no access until shared).

## Files
| Path | Purpose |
|---|---|
| `README.md` | Setup, run, deploy, test accounts, review path, limitations |
| `ARCHITECTURE.md` | Architecture note: stack, data model, access model, decisions, cuts |
| `AI_WORKFLOW.md` | How AI tools were used and verified |
| `SUBMISSION.md` | This file |
| `VIDEO_URL.txt` | Walkthrough video URL |
| `package.json`, `package-lock.json` | Dependencies and scripts |
| `server/index.js` | Process entry point |
| `server/app.js` | Express app: auth, documents, sharing, import, sanitization, error handling |
| `server/db.js` | SQLite schema, seed data, password hashing |
| `public/index.html`, `public/app.js`, `public/styles.css` | Front end (login, home, editor, share dialog) |
| `test/api.test.js` | Automated API tests (`npm test`) |
| `Dockerfile`, `render.yaml` | Deployment config (Render) |
| `.gitignore` | Ignores `node_modules/` and `data/` |

## Not included (deliberately)
Real-time co-editing, email invites, version history, export, images/attachments. Rationale in `ARCHITECTURE.md`.

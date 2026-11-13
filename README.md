# Ajaia Docs

A lightweight collaborative document editor: rich-text editing, file import, and owner/editor/viewer sharing. Node + Express + SQLite on the back end, Quill on the front end (no build step).

**Live app:** `<PASTE DEPLOYED URL>`

## Test accounts (all share the password `demo1234`)

| User | Email | Notes |
|---|---|---|
| Alice | alice@ajaia.test | Owns the seeded "Welcome to Ajaia Docs" document |
| Bob | bob@ajaia.test | Has edit access to Alice's welcome document |
| Carol | carol@ajaia.test | Has no access to anything until someone shares with her |

The login screen has one-tap buttons for each user.

### 2-minute review path
1. Sign in as **Alice**, open the welcome doc, format some text, wait for "All changes saved", refresh the page: formatting persists.
2. Click **New document**, rename it in the title bar, write a heading and a list.
3. Click **Share**, add `carol@ajaia.test` as **View only**.
4. Sign out, sign in as **Carol**: the document appears under **Shared with me** with a "View only" badge, and the editor is read-only.
5. Back as Alice, change Carol to **Can edit**; as Carol, edit succeeds.
6. From the home screen click **Upload file** and choose a `.txt`, `.md` or `.docx` file: it becomes a new editable document.

## Run locally

Requires Node 20+.

```bash
npm install
npm start          # http://localhost:3000
npm test           # automated API tests (Node's built-in test runner)
```

Data is stored in `data/app.db` (SQLite, created and seeded on first start). Delete that file to reset. Environment variables: `PORT` (default 3000), `DB_PATH` (default `./data/app.db`).

## Supported features

- **Documents:** create, rename, edit, autosave (1.5 s debounce), reopen.
- **Formatting:** bold, italic, underline, Heading 1/2/3, bulleted and numbered lists, clear formatting.
- **File upload:** `.txt`, `.md`, `.docx`, max 2 MB. Each upload becomes a new document owned by the uploader. The supported types and size limit are stated on the home screen. `.docx` import keeps headings, bold/italic/underline, lists and links; images, tables and comments are dropped.
- **Sharing:** owner shares by email as *Can edit* or *View only*; owner can change or remove access. Home screen separates **My documents** from **Shared with me** with role badges.
- **Safety:** server-side HTML sanitization, input validation, 404 for documents you can't access, stale-save conflict detection (HTTP 409).

## Deploy (Render, free tier)

1. Push this folder to a GitHub repo.
2. In Render: New → Blueprint (or Web Service → Docker) → select the repo. `render.yaml` and `Dockerfile` are included.
3. Wait for the build; the health check is `/healthz`.

**Caveat:** Render's free tier has an ephemeral filesystem, so the SQLite file resets on redeploy or restart; the demo users and welcome document are re-seeded automatically. For durable data, attach a persistent disk (paid) and set `DB_PATH` to its mount path, or swap SQLite for Postgres (see ARCHITECTURE.md).

## Known limitations (deliberate)

See "What I cut" in ARCHITECTURE.md. In short: no real-time co-editing, no email invites, no version history, mocked-simple auth.

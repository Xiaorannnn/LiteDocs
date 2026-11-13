# Architecture note

## Goal and framing
Ship a coherent slice of "Google Docs for internal teams" that a reviewer can use in two minutes: create, format, save, upload, share. I optimised for a trustworthy core loop (what you type is what comes back, and only the right people can see it) over feature breadth.

## Stack and why
| Layer | Choice | Reason |
|---|---|---|
| Server | Node 20 + Express | Small, familiar, easy for reviewers to run |
| Storage | SQLite via `better-sqlite3` | Zero-config, relational (documents/shares need joins and constraints), synchronous API keeps handlers simple |
| Editor | Quill 1.3.7 from CDN | Mature rich-text editor; emits simple HTML (`<ul>`, `<h1>`, `<strong>`); no bundler needed, so the repo runs with `npm install && npm start` |
| Front end | Vanilla JS single page, hash routing | A framework would add a build step and more surface area than three screens justify |
| Import | `mammoth` (.docx), `marked` (.md), plain-text paragraphing | Covers the three most common draft formats |
| Tests | `node:test` | No test dependency |

## Data model
- `users(id, email, name, password_hash)`
- `sessions(token, user_id)`: opaque random token in an HttpOnly, SameSite=Lax cookie
- `documents(id, owner_id, title, content, version, timestamps)`: `content` is sanitized HTML
- `shares(document_id, user_id, role)`: role is `editor` or `viewer`; composite primary key makes re-sharing an upsert

## Access model
One function (`loadWithAccess`) resolves the caller's role (`owner > editor > viewer`) and enforces the minimum role each route needs. Users without any access get **404**, not 403, so document IDs don't leak. Viewers get 403 on writes. Only owners can share, unshare or delete.

## Key decisions
- **Store HTML, sanitize on write.** Simple and preserves formatting. Every save and import passes through `sanitize-html` with a whitelist matching the editor's output, so stored content can't carry scripts even if a client is malicious. Tradeoff: HTML is less structured than Quill Deltas or ProseMirror JSON, which would matter for real-time collaboration.
- **Autosave plus optimistic concurrency.** Each content save sends `baseVersion`; if another user saved in between, the server returns 409 and the UI blocks the overwrite and offers "Load latest version". This is a cheap, honest answer to concurrent editing without building OT/CRDT. Renames don't bump the version, so they never cause false conflicts.
- **Upload creates a new document.** It is the least ambiguous product behaviour (no merge UI) and makes the file feature immediately useful. Type and size are validated on the server and stated in the UI.
- **Seeded users + password login.** Meets the "simulate users" allowance while still exercising a real session cookie and real server-side authorization, rather than a client-side user switcher.
- **Passwords** are hashed with scrypt (Node built-in) so there is no native crypto dependency.

## What I cut, and why
- **Real-time co-editing / presence:** needs a CRDT (Yjs) or OT plus websockets; version-checked saves cover the safety need within the timebox.
- **Email invites and user directory:** sharing is by email among existing accounts; no signup flow.
- **Version history, comments, export:** valuable, but secondary to the core loop.
- **Attachments / images in documents:** import is text-and-structure only.
- **Rate limiting, CSRF tokens, password reset:** SameSite=Lax cookies and JSON bodies mitigate CSRF for this scope; the rest are production hardening.
- **UI tests:** I covered the server logic (where access and data integrity live) with automated tests and verified the UI by hand.

## Testing
`npm test` runs 9 API tests covering: auth required, bad login, create/rename/save/reopen with formatting intact, the full sharing lifecycle (no access, viewer read-only, owner-only sharing, upgrade to editor, revoke), share validation, HTML sanitization, stale-save 409, title validation, and file import (txt, md, rejected type).

## What I'd do next
1. Yjs + websockets for real-time collaboration and presence.
2. Postgres and a persistent deployment; per-user signup via magic link.
3. Version history (the `version` column is already the hook).
4. Export to .docx/.md and image support.
5. Playwright smoke tests for the editor flow.

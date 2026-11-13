# AI workflow note

## Tools used
Claude as a pair-programmer for scaffolding, drafting code, and drafting documentation. I ran, tested, and reviewed everything locally.

## How I used it
1. **Scoping first, by me.** I read the brief and decided the slice before generating anything: authenticated users, HTML documents, owner/editor/viewer sharing, import-as-new-document, SQLite. I used the AI to pressure-test the scope cuts, not to choose them.
2. **Generating boilerplate.** Express routes, SQLite schema, multer wiring, and the vanilla-JS views were drafted with AI, then read line by line.
3. **Tests as a check on generated code.** The AI-drafted test suite surfaced real problems immediately (for example, a test-runner invocation that failed on Node 22), which I fixed.
4. **Docs.** First drafts of README/architecture were AI-generated, then edited so every claim matches the code.

## Where I overrode or corrected the AI
<!-- EDIT THIS SECTION so it reflects what you actually changed. Examples to adapt only if true: -->
- Chose Quill 1.x over 2.x because 1.x emits `<ul><li>` lists that sanitize and round-trip cleanly; 2.x uses `<ol data-list>` markup.
- Returned 404 rather than 403 for inaccessible documents to avoid leaking existence.
- Moved sanitization to the server on every write instead of trusting the client editor.
- Rejected adding real-time collaboration (Yjs) as out of scope; used version-checked saves instead.
- Fixed a shell brace-expansion bug and a broken `npm test` script that the AI's first pass introduced.

## How I verified
- `npm test`: 9 passing API tests.
- Manual walkthrough of the two-user sharing flow (Alice → Bob/Carol), refresh persistence, and each upload type.
- Read the final diff for security-sensitive paths (auth, access checks, sanitization, upload validation).

## What I would not delegate
Scope decisions, the access-control rules, and the security posture. AI output was treated as a draft that had to pass tests and my review.

(() => {
  const $ = (sel) => document.querySelector(sel);
  const view = $('#view');
  const AUTOSAVE_MS = 1500;
  let user = null;
  let current = null; // { id, role, version, quill, dirty, saving }
  let saveTimer = null;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = (iso) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

  async function api(path, { method = 'GET', body } = {}) {
    const init = { method, credentials: 'same-origin', headers: {} };
    if (body instanceof FormData) init.body = body;
    else if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await fetch('/api' + path, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Request failed.');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  let toastTimer;
  function toast(message, isError = false) {
    const el = $('#toast');
    el.textContent = message;
    el.className = 'toast' + (isError ? ' error' : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 4000);
  }

  // ---------- routing ----------
  async function route() {
    clearTimeout(saveTimer);
    if (current && current.dirty) await flushSave();
    current = null;
    if (!user) {
      try {
        user = (await api('/me')).user;
      } catch {
        user = null;
      }
    }
    $('#topbar').hidden = !user;
    if (!user) return renderLogin();
    $('#whoName').textContent = user.name;
    const match = location.hash.match(/^#\/doc\/(\d+)$/);
    try {
      if (match) await renderEditor(Number(match[1]));
      else await renderHome();
    } catch (err) {
      if (err.status === 401) {
        user = null;
        return route();
      }
      if (match) {
        toast(err.message, true);
        location.hash = '#/';
      } else toast(err.message, true);
    }
  }

  // ---------- login ----------
  function renderLogin() {
    view.innerHTML = `
      <form class="login" id="loginForm">
        <h1>Sign in</h1>
        <p>LiteDocs is a shared workspace for drafting and reviewing documents.</p>
        <p class="error" id="loginError" role="alert"></p>
        <label>Email<input type="email" name="email" required autocomplete="username"></label>
        <label>Password<input type="password" name="password" required autocomplete="current-password"></label>
        <button class="primary" type="submit">Sign in</button>
        <div class="demo">
          <p>Reviewing this app? Sign in with one tap (password for all: <strong>demo1234</strong>).</p>
          <div class="row-btns">
            <button type="button" data-demo="alice@ajaia.test">Alice</button>
            <button type="button" data-demo="bob@ajaia.test">Bob</button>
            <button type="button" data-demo="carol@ajaia.test">Carol</button>
          </div>
        </div>
      </form>`;
    const form = $('#loginForm');
    const login = async (email, password) => {
      try {
        user = (await api('/login', { method: 'POST', body: { email, password } })).user;
        location.hash = '#/';
        route();
      } catch (err) {
        $('#loginError').textContent = err.message;
      }
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      login(form.email.value, form.password.value);
    });
    form.querySelectorAll('[data-demo]').forEach((b) => b.addEventListener('click', () => login(b.dataset.demo, 'demo1234')));
  }

  $('#logoutBtn').addEventListener('click', async () => {
    if (current && current.dirty) await flushSave();
    await api('/logout', { method: 'POST' }).catch(() => {});
    user = null;
    location.hash = '#/';
    route();
  });

  // ---------- home ----------
  function group(title, docs, emptyText, shared) {
    const rows = docs
      .map((d) => {
        const meta = shared
          ? `<span class="badge ${d.role}">${d.role === 'editor' ? 'Can edit' : 'View only'}</span><span>${esc(d.owner_name)}</span>`
          : d.share_count
            ? `<span class="badge">Shared with ${d.share_count}</span>`
            : '';
        return `<a class="row" href="#/doc/${d.id}"><span class="t">${esc(d.title)}</span><span class="meta">${meta}<span>${fmtDate(d.updated_at)}</span></span></a>`;
      })
      .join('');
    return `<section class="group"><h2>${title}</h2>${docs.length ? `<div class="list">${rows}</div>` : `<div class="empty">${emptyText}</div>`}</section>`;
  }

  async function renderHome() {
    const { owned, shared } = await api('/documents');
    view.innerHTML = `
      <section class="home">
        <div class="home-head">
          <h1>Documents</h1>
          <div class="actions">
            <label class="btn">Upload file<input id="uploadInput" type="file" accept=".txt,.md,.docx" hidden></label>
            <button id="newDoc" class="primary">New document</button>
          </div>
        </div>
        <p class="hint">Upload a .txt, .md or .docx file (up to 2 MB) to turn it into an editable document.</p>
        ${group('My documents', owned, 'You have no documents yet. Create one or upload a file.', false)}
        ${group('Shared with me', shared, 'Nothing has been shared with you yet.', true)}
      </section>`;
    $('#newDoc').addEventListener('click', async () => {
      try {
        const { id } = await api('/documents', { method: 'POST', body: {} });
        location.hash = `#/doc/${id}`;
      } catch (err) {
        toast(err.message, true);
      }
    });
    $('#uploadInput').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const form = new FormData();
      form.append('file', file);
      try {
        toast('Importing ' + file.name + '…');
        const { id } = await api('/documents/import', { method: 'POST', body: form });
        location.hash = `#/doc/${id}`;
      } catch (err) {
        toast(err.message, true);
      } finally {
        e.target.value = '';
      }
    });
  }

  // ---------- editor ----------
  const TOOLBAR = `
    <div id="toolbar">
      <span class="ql-formats">
        <select class="ql-header"><option value="1">Heading 1</option><option value="2">Heading 2</option><option value="3">Heading 3</option><option selected>Normal</option></select>
      </span>
      <span class="ql-formats"><button class="ql-bold" aria-label="Bold"></button><button class="ql-italic" aria-label="Italic"></button><button class="ql-underline" aria-label="Underline"></button></span>
      <span class="ql-formats"><button class="ql-list" value="ordered" aria-label="Numbered list"></button><button class="ql-list" value="bullet" aria-label="Bulleted list"></button></span>
      <span class="ql-formats"><button class="ql-clean" aria-label="Clear formatting"></button></span>
    </div>`;

  function setStatus(text, isError = false) {
    const el = $('#status');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('error-text', isError);
  }

  async function renderEditor(id) {
    const { document: doc, role, shares } = await api('/documents/' + id);
    const canEdit = role === 'owner' || role === 'editor';
    view.innerHTML = `
      <section class="editor">
        <div class="editor-bar">
          <a class="back" href="#/">&larr; All documents</a>
          <input id="title" type="text" maxlength="200" aria-label="Document title" ${canEdit ? '' : 'readonly'}>
          <span id="status" class="status" aria-live="polite"></span>
          ${role === 'owner' ? '<button id="shareBtn" class="primary">Share</button>' : ''}
          ${role === 'owner' ? '<button id="deleteBtn" class="danger">Delete</button>' : ''}
        </div>
        <div id="banner" class="banner" hidden></div>
        ${canEdit ? TOOLBAR : ''}
        <div class="desk"><div class="page"><div id="editor"></div></div></div>
      </section>`;
    $('#title').value = doc.title;
    if (!canEdit) {
      $('#banner').hidden = false;
      $('#banner').textContent = `You can view this document but not edit it. Owner: ${doc.owner_name}.`;
    } else if (role === 'editor') {
      $('#banner').hidden = false;
      $('#banner').textContent = `Shared with you by ${doc.owner_name}. You can edit.`;
      $('#banner').style.background = 'var(--accent-soft)';
      $('#banner').style.color = 'var(--accent)';
      $('#banner').style.borderColor = 'transparent';
    }

    const quill = new Quill('#editor', {
      theme: 'snow',
      readOnly: !canEdit,
      placeholder: 'Start writing…',
      modules: { toolbar: canEdit ? '#toolbar' : false },
      formats: ['header', 'bold', 'italic', 'underline', 'list', 'indent', 'link', 'strike', 'blockquote'],
    });
    quill.setContents(quill.clipboard.convert(doc.content));
    current = { id, role, version: doc.version, quill, dirty: false, saving: false, title: doc.title, shares };
    setStatus(canEdit ? 'All changes saved' : 'View only');

    if (canEdit) {
      quill.on('text-change', (delta, old, source) => {
        if (source !== 'user') return;
        current.dirty = true;
        setStatus('Unsaved changes…');
        clearTimeout(saveTimer);
        saveTimer = setTimeout(flushSave, AUTOSAVE_MS);
      });
      $('#title').addEventListener('change', renameDoc);
      $('#title').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.target.blur();
        }
      });
    }
    if (role === 'owner') {
      $('#shareBtn').addEventListener('click', openShareDialog);
      $('#deleteBtn').addEventListener('click', deleteDoc);
    }
  }

  async function renameDoc(e) {
    const title = e.target.value.trim();
    if (!title) {
      e.target.value = current.title;
      return toast('A document needs a title.', true);
    }
    try {
      await api('/documents/' + current.id, { method: 'PATCH', body: { title } });
      current.title = title;
      setStatus('Renamed');
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function flushSave() {
    const doc = current;
    if (!doc || !doc.dirty || doc.saving) return;
    clearTimeout(saveTimer);
    doc.saving = true;
    doc.dirty = false;
    setStatus('Saving…');
    try {
      const res = await api('/documents/' + doc.id, { method: 'PATCH', body: { content: doc.quill.root.innerHTML, baseVersion: doc.version } });
      doc.version = res.version;
      if (current === doc) setStatus(doc.dirty ? 'Unsaved changes…' : 'All changes saved');
    } catch (err) {
      doc.dirty = true;
      if (err.status === 409) showConflict();
      else setStatus('Save failed. Retrying…', true);
      if (err.status !== 409 && current === doc) saveTimer = setTimeout(flushSave, 5000);
      if (err.status !== 409) toast(err.message, true);
    } finally {
      doc.saving = false;
    }
    if (current === doc && doc.dirty && !$('#banner').dataset.conflict) saveTimer = setTimeout(flushSave, AUTOSAVE_MS);
  }

  function showConflict() {
    setStatus('Not saved: newer version exists', true);
    clearTimeout(saveTimer);
    const banner = $('#banner');
    banner.dataset.conflict = '1';
    banner.hidden = false;
    banner.style.background = '';
    banner.style.color = '';
    banner.innerHTML = 'Someone else saved a newer version of this document. Your latest changes were not saved. <button id="reloadBtn">Load latest version</button>';
    $('#reloadBtn').addEventListener('click', () => {
      current.dirty = false;
      route();
    });
  }

  async function deleteDoc() {
    if (!confirm('Delete this document for everyone it is shared with? This cannot be undone.')) return;
    try {
      current.dirty = false;
      await api('/documents/' + current.id, { method: 'DELETE' });
      location.hash = '#/';
    } catch (err) {
      toast(err.message, true);
    }
  }

  // ---------- sharing dialog ----------
  function renderShareDialog(message = '') {
    const dlg = $('#shareDialog');
    const items = current.shares
      .map(
        (s) => `<li data-user="${s.user_id}">
          <div class="who-cell">${esc(s.name)}<small>${esc(s.email)}</small></div>
          <select data-role aria-label="Access for ${esc(s.name)}"><option value="editor" ${s.role === 'editor' ? 'selected' : ''}>Can edit</option><option value="viewer" ${s.role === 'viewer' ? 'selected' : ''}>View only</option></select>
          <button data-remove class="quiet danger">Remove</button>
        </li>`
      )
      .join('');
    dlg.innerHTML = `
      <h2>Share this document</h2>
      <form class="share-add" id="shareForm">
        <input type="email" name="email" placeholder="Email, e.g. bob@ajaia.test" required aria-label="Email address">
        <select name="role" aria-label="Access level"><option value="editor">Can edit</option><option value="viewer">View only</option></select>
        <button class="primary" type="submit">Share</button>
      </form>
      <p class="error" role="alert">${esc(message)}</p>
      <ul class="share-list">${items || '<li><small>Only you can see this document.</small></li>'}</ul>
      <div class="dialog-foot"><button id="closeShare">Done</button></div>`;
    $('#closeShare').addEventListener('click', () => {
      dlg.close();
      renderAfterShare();
    });
    $('#shareForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const res = await api(`/documents/${current.id}/shares`, { method: 'POST', body: { email: e.target.email.value, role: e.target.role.value } });
        current.shares = res.shares;
        renderShareDialog();
      } catch (err) {
        renderShareDialog(err.message);
      }
    });
    dlg.querySelectorAll('li[data-user]').forEach((li) => {
      const uid = li.dataset.user;
      const s = current.shares.find((x) => String(x.user_id) === uid);
      li.querySelector('[data-role]').addEventListener('change', async (e) => {
        try {
          current.shares = (await api(`/documents/${current.id}/shares`, { method: 'POST', body: { email: s.email, role: e.target.value } })).shares;
          renderShareDialog();
        } catch (err) {
          renderShareDialog(err.message);
        }
      });
      li.querySelector('[data-remove]').addEventListener('click', async () => {
        try {
          current.shares = (await api(`/documents/${current.id}/shares/${uid}`, { method: 'DELETE' })).shares;
          renderShareDialog();
        } catch (err) {
          renderShareDialog(err.message);
        }
      });
    });
  }
  function renderAfterShare() {
    const n = current.shares.length;
    setStatus(n ? `Shared with ${n}` : 'Private');
  }
  function openShareDialog() {
    renderShareDialog();
    $('#shareDialog').showModal();
  }

  // Save before the tab is hidden; warn if leaving with unsaved edits.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSave();
  });
  window.addEventListener('beforeunload', (e) => {
    if (current && current.dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  window.addEventListener('hashchange', route);
  route();
})();

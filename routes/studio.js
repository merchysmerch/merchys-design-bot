// ================================================================
// DESIGN STUDIO v2 routes: the art director plugin flow.
// Mounted from server.js: require('./routes/studio')(app, deps)
// ================================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const director = require('../lib/director');
const gen = require('../lib/generate');
const Q = require('../lib/questions');

module.exports = function mountStudio(app, deps) {
  const { asanaFetch, searchProjectByPO, getProjectTasks, postDesignNotes, ASANA_WORKSPACE, ASANA_TOKEN, emailTransporter, uploadsDir, escapeHtml } = deps;
  gen.setUploadsDir(uploadsDir);

  const dataDir = path.join(__dirname, '..', 'data');
  const sessDir = path.join(dataDir, 'sessions');
  const libDir = path.join(dataDir, 'library');
  [sessDir, libDir].forEach(d => fs.mkdirSync(d, { recursive: true }));

  // ---- persistence ----
  const sessions = new Map();
  const sessPath = id => path.join(sessDir, `${id}.json`);
  function load(id) {
    if (sessions.has(id)) return sessions.get(id);
    try { const s = JSON.parse(fs.readFileSync(sessPath(id), 'utf8')); sessions.set(id, s); return s; } catch { return null; }
  }
  function save(s) { s.updatedAt = Date.now(); sessions.set(s.id, s); fs.writeFileSync(sessPath(s.id), JSON.stringify(s, null, 2)); return s; }
  const clientKey = c => (c?.id || c?.email || c?.business || 'anon').toString().toLowerCase().replace(/[^a-z0-9@._-]+/g, '_');
  const libPath = key => path.join(libDir, `${key}.json`);
  function loadLib(key) { try { return JSON.parse(fs.readFileSync(libPath(key), 'utf8')); } catch { return { clientKey: key, items: [] }; } }
  function saveLib(lib) { fs.writeFileSync(libPath(lib.clientKey), JSON.stringify(lib, null, 2)); }

  const absUrl = (req, u) => (!u || !u.startsWith('/')) ? u : (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '') + u;
  const publicView = (s) => s; // whole session is safe to return to its own client

  // ---- capabilities ----
  app.get('/api/studio/capabilities', (req, res) => {
    res.json({
      director: director.enabled, generation: gen.enabled, imageProvider: gen.provider, asana: !!ASANA_TOKEN, email: !!emailTransporter,
      calendly: !!(process.env.CALENDLY_URL || process.env.CALENDLY_TOKEN),
      styles: Object.entries(Q.STYLE_NAMES).map(([id, name]) => ({ id, name })),
      productTrees: Object.entries(Q.PRODUCT_TREES).map(([key, t]) => ({ key, label: t.label })),
      finalChecklist: Q.FINAL_CHECKLIST,
      moods: Q.MOOD_WORDS
    });
  });

  // ---- 1. create session from host payload ----
  app.post('/api/studio/session', (req, res) => {
    const { client = {}, context = {} } = req.body || {};
    const s = {
      id: crypto.randomBytes(8).toString('hex'), createdAt: Date.now(),
      client: { id: client.id, name: client.name, email: client.email, phone: client.phone, business: client.business, industry: client.industry, projectGid: client.projectGid, poNumber: client.poNumber },
      context: { mode: context.mode || (context.product ? 'product' : 'logo'), product: context.product, service: context.service, decoration: context.decoration, category: context.category, returnUrl: context.returnUrl },
      brief: { answers: {}, done: false, summary: '' },
      styles: [], board: { selections: [], dislikes: '' }, library: [], schedule: null, finalized: null
    };
    s.productTree = Q.detectProductTree(s.context)?.key || null;
    save(s);
    res.json({ session: publicView(s) });
  });

  app.post('/api/studio/session/:id/client', (req, res) => {
    const s = load(req.params.id);
    if (!s) return res.status(404).json({ error: 'Session not found' });
    const b = req.body || {};
    ['name', 'email', 'phone', 'business', 'industry'].forEach(k => { if (b[k] !== undefined) s.client[k] = b[k]; });
    save(s); res.json({ session: s });
  });

  app.get('/api/studio/session/:id', (req, res) => {
    const s = load(req.params.id);
    if (!s) return res.status(404).json({ error: 'Session not found' });
    res.json({ session: publicView(s) });
  });

  // ---- 2. director interview (brief) ----
  app.post('/api/studio/session/:id/brief', async (req, res) => {
    const s = load(req.params.id);
    if (!s) return res.status(404).json({ error: 'Session not found' });
    const { answers = {}, finish } = req.body || {};
    Object.assign(s.brief.answers, answers);
    if (finish) { s.brief.done = true; save(s); return res.json({ session: s, questions: [], done: true }); }
    const out = await director.briefQuestions(s);
    if (out.briefSummary) s.brief.summary = out.briefSummary;
    if (out.done) s.brief.done = true;
    save(s);
    res.json({ session: s, questions: out.questions, done: out.done, source: out.source });
  });

  // ---- 3. style selection: one image per style, generated in the background ----
  const styleQueues = new Map();
  function runStyleQueue(s) {
    if (styleQueues.get(s.id)) return;
    styleQueues.set(s.id, true);
    (async () => {
      let st;
      while ((st = (load(s.id) || s).styles.find(x => x.status === 'queued'))) {
        const cur = load(s.id);
        const item = cur.styles.find(x => x.id === st.id);
        item.status = 'generating'; save(cur);
        try {
          const prompt = director.buildPrompt(cur, item.id);
          const img = await gen.generateStyleImage(prompt, item.id, cur.id);
          const c2 = load(s.id); const it2 = c2.styles.find(x => x.id === item.id);
          it2.image = img; it2.status = 'ready'; save(c2);
        } catch (e) {
          const c2 = load(s.id); const it2 = c2.styles.find(x => x.id === item.id);
          it2.status = 'failed'; it2.error = e.message; save(c2);
        }
      }
      styleQueues.delete(s.id);
    })();
  }

  app.post('/api/studio/session/:id/styles', (req, res) => {
    const s = load(req.params.id);
    if (!s) return res.status(404).json({ error: 'Session not found' });
    const ids = (req.body?.styles || []).filter(id => Q.STYLE_NAMES[id]).slice(0, 20);
    if (!ids.length) return res.status(400).json({ error: 'Pick at least one style' });
    ids.forEach(id => { if (!s.styles.find(x => x.id === id)) s.styles.push({ id, name: Q.STYLE_NAMES[id], status: 'queued', image: null, liked: false, skipped: false, questions: null, refinement: null, refinements: [], refineStatus: 'idle' }); });
    s.styles = s.styles.filter(x => ids.includes(x.id));
    save(s); runStyleQueue(s);
    res.json({ session: s });
  });

  app.post('/api/studio/session/:id/style/:styleId/retry', (req, res) => {
    const s = load(req.params.id); const st = s?.styles.find(x => x.id === req.params.styleId);
    if (!st) return res.status(404).json({ error: 'Not found' });
    st.status = 'queued'; st.error = null; save(s); runStyleQueue(s); res.json({ session: s });
  });

  // ---- 4. like styles, get per-style questions ----
  app.post('/api/studio/session/:id/like', (req, res) => {
    const s = load(req.params.id);
    if (!s) return res.status(404).json({ error: 'Session not found' });
    const liked = new Set(req.body?.liked || []);
    s.styles.forEach(st => { st.liked = liked.has(st.id); });
    save(s); res.json({ session: s });
  });

  app.get('/api/studio/session/:id/style/:styleId/questions', async (req, res) => {
    const s = load(req.params.id); const st = s?.styles.find(x => x.id === req.params.styleId);
    if (!st) return res.status(404).json({ error: 'Not found' });
    if (!st.questions) { const out = await director.styleQuestions(s, st.id); st.questions = out.questions; save(s); }
    res.json({ questions: st.questions });
  });

  // ---- 5. refine (5 in background) or skip ----
  app.post('/api/studio/session/:id/style/:styleId/refine', (req, res) => {
    const s = load(req.params.id); const st = s?.styles.find(x => x.id === req.params.styleId);
    if (!st) return res.status(404).json({ error: 'Not found' });
    if (req.body?.skip) { st.skipped = true; st.liked = false; save(s); return res.json({ session: s }); }
    st.refinement = { answers: req.body?.answers || {}, notes: req.body?.notes || '' };
    st.refineStatus = 'generating'; st.refinements = []; save(s);
    const baseLocal = st.image?.url; const baseAbs = absUrl(req, st.image?.remoteUrl || st.image?.url);
    (async () => {
      try {
        const prompts = [0, 1, 2, 3, 4].map(v => director.buildPrompt(s, st.id, { ...st.refinement, variation: v }));
        const imgs = await gen.refineImage(baseLocal, prompts, st.id, s.id, baseAbs);
        const c = load(s.id); const it = c.styles.find(x => x.id === st.id);
        it.refinements = imgs; it.refineStatus = 'ready'; save(c);
      } catch (e) {
        const c = load(s.id); const it = c.styles.find(x => x.id === st.id);
        it.refineStatus = 'failed'; it.error = e.message; save(c);
      }
    })();
    res.json({ session: s });
  });

  // ---- 6. review board: selections with per-image notes, dislikes ----
  app.post('/api/studio/session/:id/board', (req, res) => {
    const s = load(req.params.id);
    if (!s) return res.status(404).json({ error: 'Session not found' });
    const { selections = [], dislikes = '' } = req.body || {};
    s.board = {
      selections: selections.map(sel => ({ styleId: sel.styleId, styleName: Q.STYLE_NAMES[sel.styleId] || sel.styleId, label: sel.label, url: absUrl(req, sel.url), notes: sel.notes || '', checks: sel.checks || [] })),
      dislikes
    };
    save(s); res.json({ session: s });
  });

  // ---- 7. logo library (independent; export for Merchy's Market) ----
  app.post('/api/studio/session/:id/library', (req, res) => {
    const s = load(req.params.id);
    if (!s) return res.status(404).json({ error: 'Session not found' });
    const key = clientKey(s.client); const lib = loadLib(key);
    (req.body?.items || []).forEach(it => {
      const url = absUrl(req, it.url);
      if (lib.items.find(x => x.url === url)) return;
      const item = { id: crypto.randomBytes(6).toString('hex'), url, styleId: it.styleId, styleName: Q.STYLE_NAMES[it.styleId] || it.styleId, label: it.label, sessionId: s.id, business: s.client.business, addedAt: Date.now(), status: 'concept' };
      lib.items.push(item); s.library.push(item.id);
    });
    saveLib(lib); save(s);
    res.json({ library: lib, session: s });
  });
  app.get('/api/studio/library/:clientKey', (req, res) => res.json(loadLib(clientKey({ id: req.params.clientKey }))));
  app.get('/api/studio/library', (req, res) => {
    // export for the Merchy's Market sync job: ?since=<ms>
    const since = Number(req.query.since || 0);
    const all = fs.readdirSync(libDir).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(libDir, f), 'utf8')));
    res.json({ libraries: all.map(l => ({ clientKey: l.clientKey, items: l.items.filter(i => i.addedAt > since) })).filter(l => l.items.length) });
  });

  // ---- 8. schedule a call with the artist ----
  app.get('/api/studio/session/:id/schedule-link', async (req, res) => {
    const s = load(req.params.id);
    if (!s) return res.status(404).json({ error: 'Session not found' });
    if (process.env.CALENDLY_TOKEN && process.env.CALENDLY_EVENT_TYPE) {
      try {
        const r = await fetch('https://api.calendly.com/scheduling_links', {
          method: 'POST', headers: { Authorization: `Bearer ${process.env.CALENDLY_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ max_event_count: 1, owner: process.env.CALENDLY_EVENT_TYPE, owner_type: 'EventType' })
        });
        const d = await r.json();
        if (d.resource?.booking_url) return res.json({ url: d.resource.booking_url, type: 'calendly_single_use' });
      } catch (e) { console.error('Calendly link error:', e.message); }
    }
    if (process.env.CALENDLY_URL) return res.json({ url: process.env.CALENDLY_URL, type: 'calendly' });
    res.json({ url: null, type: 'request', slots: nextSlots() });
  });
  function nextSlots() {
    const out = []; const d = new Date(); d.setHours(0, 0, 0, 0);
    while (out.length < 15) {
      d.setDate(d.getDate() + 1);
      if (d.getDay() === 0 || d.getDay() === 6) continue;
      ['10:00 AM', '1:00 PM', '3:30 PM'].forEach(t => out.push({ date: d.toISOString().slice(0, 10), time: t, label: `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} ${t}` }));
    }
    return out;
  }
  app.post('/api/studio/session/:id/schedule', (req, res) => {
    const s = load(req.params.id);
    if (!s) return res.status(404).json({ error: 'Session not found' });
    const { slot, calendlyBooked, scope } = req.body || {};
    s.schedule = { summary: calendlyBooked ? `Booked via Calendly (${scope || 'all designs'})` : slot ? `Requested ${slot.label} PT (${scope || 'all designs'})` : 'Not scheduled', slot: slot || null, calendlyBooked: !!calendlyBooked, scope: scope || 'all designs' };
    save(s); res.json({ session: s });
  });

  // ---- 9. finalize: Asana + email, approved designs only ----
  app.post('/api/studio/session/:id/finalize', async (req, res) => {
    const s = load(req.params.id);
    if (!s) return res.status(404).json({ error: 'Session not found' });
    const brief = director.finalBrief(s);
    const results = { asana: null, email: null };
    try {
      let taskGid = null, projectName = null;
      if (s.client.projectGid || s.client.poNumber) {
        let projectGid = s.client.projectGid;
        if (!projectGid && s.client.poNumber) { const sr = await searchProjectByPO(s.client.poNumber); projectGid = sr.projects?.[0]?.gid; projectName = sr.projects?.[0]?.name; }
        if (projectGid) {
          const tasks = await getProjectTasks(projectGid);
          const t = (Array.isArray(tasks) ? tasks : []).find(t => /graphic design|artwork/i.test(t.name)) || (Array.isArray(tasks) ? tasks.find(t => !t.completed) : null);
          if (t) taskGid = t.gid;
        }
      }
      if (taskGid) {
        const html = `<body>${escapeHtml(brief).replace(/(https?:\/\/\S+)/g, '<a href="$1">$1</a>')}</body>`;
        const r = await postDesignNotes(taskGid, html);
        results.asana = { success: !r.error, action: 'comment_posted', taskGid, projectName, error: r.error };
      } else if (ASANA_TOKEN) {
        const sr = await asanaFetch(`/workspaces/${ASANA_WORKSPACE}/typeahead?resource_type=project&query=Presale&opt_fields=name,gid&count=5`);
        const presale = process.env.ASANA_PRESALE_PROJECT_GID || (sr.data || []).find(p => /presale|pre-sale/i.test(p.name))?.gid;
        const r = await asanaFetch('/tasks', { method: 'POST', body: JSON.stringify({ data: { name: `${s.client.name || 'Client'} | ${s.client.business || 'New Client'} | Design Studio (${s.board.selections.length} approved)`, workspace: ASANA_WORKSPACE, ...(presale ? { projects: [presale] } : {}), notes: brief } }) });
        results.asana = { success: !r.error, action: 'presale_created', taskGid: r.data?.gid, error: r.error };
      } else results.asana = { success: false, error: 'Asana not configured' };
    } catch (e) { results.asana = { success: false, error: e.message }; }

    if (emailTransporter && s.client.email) {
      try {
        const imgs = s.board.selections.map((sel, i) => `<div style="display:inline-block;margin:6px;text-align:center;font-size:12px;color:#555"><img src="${escapeHtml(sel.url)}" style="width:140px;height:140px;object-fit:cover;border:1px solid #ddd;border-radius:6px"><br>#${i + 1} ${escapeHtml(sel.styleName)}</div>`).join('');
        await emailTransporter.sendMail({
          from: process.env.EMAIL_FROM || "Merchy's Design Studio <start@merchysmerch.com>", to: s.client.email,
          subject: `Your Design Studio brief - ${s.client.business || 'Merchy\'s'}`,
          html: `<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto"><div style="background:#111;padding:18px;text-align:center"><h1 style="color:#d4a017;margin:0;font-size:20px;letter-spacing:2px">MERCHY'S DESIGN STUDIO</h1></div><div style="padding:24px;background:#fff;color:#333"><p>${escapeHtml(s.client.name || '')}, here is what you approved. Our design team takes it from here.</p><div>${imgs}</div><pre style="white-space:pre-wrap;font-family:Arial;font-size:13px;background:#f6f6f6;padding:14px;border-radius:8px">${escapeHtml(brief)}</pre><p style="font-size:12px;color:#888">- Merchy's Team | 619-800-0949</p></div></div>`
        });
        results.email = { success: true };
      } catch (e) { results.email = { success: false, error: e.message }; }
    }
    s.finalized = { at: Date.now(), brief, results };
    save(s);
    fs.mkdirSync(path.join(__dirname, '..', 'submissions'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, '..', 'submissions', `studio-${s.id}.json`), JSON.stringify(s, null, 2));
    res.json({ success: true, brief, results, session: s });
  });
};

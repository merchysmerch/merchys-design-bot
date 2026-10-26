#!/usr/bin/env node
// ================================================================
// Build a server-free demo of the Design Studio plugin.
// Output: dist/index.html  (storefront + studio, everything client side)
//
// The studio's /api/studio/* calls are answered in the browser: the
// question bank, prompt builder and demo image generator from /lib are
// bundled, sessions live in memory, and "generation" is simulated with
// short delays so concepts arrive one at a time like the real thing.
// Run: node scripts/build-static-demo.js
// ================================================================
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

// ---- lib/questions.js as a browser const ----
const questionsSrc = read('lib/questions.js').replace(/module\.exports\s*=\s*\{[\s\S]*?\};?\s*$/, '');

// ---- director: buildPrompt, finalBrief, STYLE_DESCRIPTIONS, COLOR_RULES ----
const dirSrc = read('lib/director.js');
const grab = (src, start, end) => { const a = src.indexOf(start); const b = src.indexOf(end, a); if (a < 0 || b < 0) throw new Error('marker: ' + start); return src.slice(a, b); };
const directorPart = grab(dirSrc, 'const COLOR_RULES', 'module.exports').replace(/Q\./g, '');

// ---- generate: demoImage as data URL ----
const genSrc = read('lib/generate.js');
let demoPart = grab(genSrc, '// ---- Demo SVG previews', 'module.exports');
demoPart = demoPart.replace(/const file = `demo-[^`]*`;\s*fs\.writeFileSync\([^;]*\);\s*return \{ url: `\/uploads\/\$\{file\}`, source: 'demo', prompt \};/,
  "const u = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); return { url: u, remoteUrl: u, source: 'demo', prompt };");
if (!/data:image\/svg\+xml/.test(demoPart)) throw new Error('demoImage return did not match');

const shim = `
// ---- STATIC DEMO SHIM: answers /api/studio/* in the browser ----
(function(){
${questionsSrc}
${directorPart}
${demoPart}
const PRODUCT_TREE_LIST = Object.entries(PRODUCT_TREES).map(([key, t]) => ({ key, label: t.label }));
const sessions = {};
const rid = () => Math.random().toString(16).slice(2, 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const json = obj => new Response(JSON.stringify(obj), { status: 200, headers: { 'Content-Type': 'application/json' } });
const err = (msg, code) => new Response(JSON.stringify({ error: msg }), { status: code || 400, headers: { 'Content-Type': 'application/json' } });

function styleQueue(s) {
  if (s._q) return; s._q = true;
  (async () => {
    let st;
    while ((st = s.styles.find(x => x.status === 'queued'))) {
      st.status = 'generating'; await sleep(1400);
      st.image = demoImage(buildPrompt(s, st.id), st.id, 0, s.id); st.status = 'ready';
    }
    s._q = false;
  })();
}
function finalBriefText(s) { return finalBrief(s).replace(/data:image\\/svg\\+xml[^\\s]*/g, '[preview image attached]'); }

const realFetch = window.fetch.bind(window);
window.fetch = async function(url, opts) {
  const u = String(url); const i = u.indexOf('/api/');
  if (i < 0) return realFetch(url, opts);
  const route = u.slice(i).split('?')[0];
  const body = opts && opts.body ? JSON.parse(opts.body) : {};
  const m = route.match(/^\\/api\\/studio\\/session\\/([^/]+)(?:\\/(.*))?$/);
  if (route === '/api/studio/capabilities') return json({ director: false, generation: false, asana: false, email: false, calendly: false, styles: Object.entries(STYLE_NAMES).map(([id, name]) => ({ id, name })), productTrees: PRODUCT_TREE_LIST, finalChecklist: FINAL_CHECKLIST, moods: MOOD_WORDS });
  if (route === '/api/studio/session') {
    const client = body.client || {}, context = body.context || {};
    const s = { id: rid(), client, context: { mode: context.mode || (context.product ? 'product' : 'logo'), product: context.product, decoration: context.decoration, service: context.service, category: context.category }, brief: { answers: {}, done: false, summary: '' }, styles: [], board: { selections: [], dislikes: '' }, library: [], schedule: null, finalized: null };
    s.productTree = (detectProductTree(s.context) || {}).key || null;
    sessions[s.id] = s; return json({ session: s });
  }
  if (!m) return json({});
  const s = sessions[m[1]]; if (!s) return err('Session not found', 404);
  const sub = m[2] || '';
  if (!sub) return json({ session: s });
  if (sub === 'client') { Object.assign(s.client, body); return json({ session: s }); }
  if (sub === 'brief') {
    Object.assign(s.brief.answers, body.answers || {});
    if (body.finish) { s.brief.done = true; return json({ session: s, questions: [], done: true }); }
    const base = briefQuestions(s.context); const remaining = base.filter(q => !(q.id in s.brief.answers));
    await sleep(350);
    if (!remaining.length) s.brief.done = true;
    return json({ session: s, questions: remaining.slice(0, 3), done: !remaining.length, source: 'bank' });
  }
  if (sub === 'styles') {
    const ids = (body.styles || []).filter(id => STYLE_NAMES[id]).slice(0, 20);
    ids.forEach(id => { if (!s.styles.find(x => x.id === id)) s.styles.push({ id, name: STYLE_NAMES[id], status: 'queued', image: null, liked: false, skipped: false, questions: null, refinement: null, refinements: [], refineStatus: 'idle' }); });
    s.styles = s.styles.filter(x => ids.includes(x.id)); styleQueue(s); return json({ session: s });
  }
  if (sub === 'like') { const liked = new Set(body.liked || []); s.styles.forEach(st => st.liked = liked.has(st.id)); return json({ session: s }); }
  let sm = sub.match(/^style\\/([^/]+)\\/(questions|refine|retry)$/);
  if (sm) {
    const st = s.styles.find(x => x.id === sm[1]); if (!st) return err('Not found', 404);
    if (sm[2] === 'questions') { await sleep(300); return json({ questions: styleQuestions(st.id) }); }
    if (sm[2] === 'retry') { st.status = 'queued'; styleQueue(s); return json({ session: s }); }
    if (body.skip) { st.skipped = true; st.liked = false; return json({ session: s }); }
    st.refinement = { answers: body.answers || {}, notes: body.notes || '' }; st.refineStatus = 'generating'; st.refinements = [];
    (async () => { await sleep(2500); st.refinements = [0,1,2,3,4].map(v => demoImage(buildPrompt(s, st.id, { ...st.refinement, variation: v }), st.id, v + 1, s.id)); st.refineStatus = 'ready'; })();
    return json({ session: s });
  }
  if (sub === 'board') { s.board = { selections: (body.selections || []).map(sel => ({ styleId: sel.styleId, styleName: STYLE_NAMES[sel.styleId] || sel.styleId, label: sel.label, url: sel.url, notes: sel.notes || '', checks: sel.checks || [] })), dislikes: body.dislikes || '' }; return json({ session: s }); }
  if (sub === 'library') { (body.items || []).forEach(it => s.library.push(rid())); return json({ session: s, library: { items: s.library } }); }
  if (sub === 'schedule-link') {
    const out = []; const d = new Date(); d.setHours(0,0,0,0);
    while (out.length < 15) { d.setDate(d.getDate() + 1); if (d.getDay() === 0 || d.getDay() === 6) continue; ['10:00 AM','1:00 PM','3:30 PM'].forEach(t => out.push({ date: d.toISOString().slice(0,10), time: t, label: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + ' ' + t })); }
    return json({ url: null, type: 'request', slots: out });
  }
  if (sub === 'schedule') { s.schedule = { summary: body.slot ? 'Requested ' + body.slot.label + ' PT (' + (body.scope || 'all designs') + ')' : 'Not scheduled', slot: body.slot || null, scope: body.scope }; return json({ session: s }); }
  if (sub === 'finalize') { await sleep(700); const brief = finalBriefText(s); s.finalized = { brief }; return json({ success: true, brief, results: { asana: { success: true, action: 'demo' } }, session: s }); }
  return json({});
};
})();
`;

const studio = read('public/studio.html');
const marker = '<script>\nconst API_BASE';
if (!studio.includes(marker)) throw new Error('studio script marker not found');
const studioDemo = studio.replace(marker, '<script>' + shim + '\nconst API_BASE');

const page = read('scripts/static-demo-page.html').replace('<!--WIDGET_TEMPLATE-->', studioDemo);
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'index.html'), page);
console.log('Built dist/index.html (' + Math.round(page.length / 1024) + ' KB)');

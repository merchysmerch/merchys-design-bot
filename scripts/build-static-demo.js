#!/usr/bin/env node
// ================================================================
// Build a server-free demo of the Design Studio.
// Output: dist/index.html  (storefront page + widget, all client side)
//
// The widget's /api/* calls are intercepted in the browser and answered
// locally: the service catalog is embedded, the 6 designs are the same
// black and white layout previews server.js serves in demo mode, and
// submissions are acknowledged without leaving the page.
// Run: node scripts/build-static-demo.js
// ================================================================
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const widgetHtml = fs.readFileSync(path.join(root, 'public', 'widget.html'), 'utf8');

function slice(src, startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  if (a < 0) throw new Error('marker not found: ' + startMarker);
  const b = src.indexOf(endMarker, a + startMarker.length);
  if (b < 0) throw new Error('end marker not found: ' + endMarker);
  return src.slice(a, b);
}

// ---- Pull catalog + config straight out of server.js ----
const catalogSrc = slice(server, 'const SERVICE_CATEGORIES = [', '// Services catalog route');
const configBody = slice(server, "    styles: [\n      { id: 'badge'", "    company:");
const designFns = slice(server, '// ---- Local demo designs (no API needed) ----', '// Vectorize using Recraft');
const promptFn = slice(server, 'function buildDesignPrompt(formData, variation) {', 'const DESIGN_COUNT');

// Demo designs in the browser: return data URLs instead of writing files
const browserDesignFns = designFns
  .replace(/const filename = `demo-\$\{stamp\}-\$\{i\}\.svg`;\s*fs\.writeFileSync\(path\.join\(uploadsDir, filename\), svg\);\s*return \{ url: `\/uploads\/\$\{filename\}`,/,
    "const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);\n    return { url: dataUrl, remoteUrl: dataUrl,");
if (browserDesignFns === designFns) throw new Error('demo design return statement did not match');

const shim = `
// ---- STATIC DEMO SHIM: answers /api/* locally ----
(function(){
${catalogSrc}
const WIDGET_CONFIG = {
  services: SERVICES_CATALOG,
  categories: SERVICE_CATEGORIES,
${configBody}
  company: { name: "Merchy's Merch", phone: '619-800-0949', email: 'start@merchysmerch.com' },
  stripeEnabled: false,
  recraftEnabled: false,
  demoMode: true
};
${promptFn.replace(/^function buildDesignPrompt/, 'function buildDesignPrompt')}
${browserDesignFns}
const json = (obj) => new Response(JSON.stringify(obj), { status: 200, headers: { 'Content-Type': 'application/json' } });
const realFetch = window.fetch.bind(window);
window.fetch = async function(url, opts) {
  const u = String(url);
  const i = u.indexOf('/api/');
  if (i < 0) return realFetch(url, opts);
  const route = u.slice(i);
  if (route.startsWith('/api/widget-config')) return json(WIDGET_CONFIG);
  if (route.startsWith('/api/generate')) {
    const body = opts && opts.body ? JSON.parse(opts.body) : {};
    await new Promise(r => setTimeout(r, 1800));
    return json({ designs: buildDemoDesigns(body), demo: true, notice: 'Demo build: these are layout previews. The live version generates 6 AI concepts from your brief.' });
  }
  if (route.startsWith('/api/upload')) return json({ files: [] });
  if (route.startsWith('/api/submit')) {
    await new Promise(r => setTimeout(r, 600));
    return json({ success: true, results: { asana: { success: true, action: 'demo' } } });
  }
  if (route.startsWith('/api/create-checkout')) return json({ error: 'Payments are off in this demo. Call 619-800-0949.' });
  return json({});
};
})();
`;

// Inject shim as the first thing inside the widget's <script>
const marker = '<script>\nconst API_BASE';
if (!widgetHtml.includes(marker)) throw new Error('widget script marker not found');
let widgetDemo = widgetHtml.replace(marker, '<script>' + shim + '\nconst API_BASE');
// Uploads do nothing here; keep the preview but say so
widgetDemo = widgetDemo.replace("if(d.files?.length) uploadedFileUrl = d.files[0].url;", "if(d.files?.length) uploadedFileUrl = d.files[0].url; else uploadedFileUrl = null;");

const page = fs.readFileSync(path.join(__dirname, 'static-demo-page.html'), 'utf8')
  .replace('<!--WIDGET_TEMPLATE-->', widgetDemo);

const outDir = path.join(root, 'dist');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'index.html'), page);
console.log('Built dist/index.html (' + Math.round(page.length / 1024) + ' KB)');

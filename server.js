// ================================================================
// MERCHY'S DESIGN BOT — Backend Server
// Express.js + Recraft AI + Asana Integration
// ================================================================

require('dotenv').config();

// Treat empty values and .env.example placeholders ("your_xxx_here") as unset,
// so a copied-but-unfilled .env does not make the app think a service is live.
for (const [k, v] of Object.entries(process.env)) {
  if (typeof v === 'string' && (/^your_.*_here$/i.test(v.trim()) || v.trim() === '')) delete process.env[k];
}

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

// ---- Stripe (optional) ----
let stripe = null;
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
if (STRIPE_SECRET) {
  try { stripe = require('stripe')(STRIPE_SECRET); } catch (e) { console.log('Stripe module not installed'); }
}

// ---- Middleware ----
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:5173', 'https://merchysmarket.com', 'https://www.merchysmarket.com'],
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
// Static files served inline (no /public folder needed)

// File uploads for reference images
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB max

// Serve uploaded files
app.use('/uploads', express.static(uploadsDir));

// ---- Email transporter ----
let emailTransporter = null;
if (process.env.SMTP_USER && process.env.SMTP_PASS) {
  emailTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

// ================================================================
// ASANA INTEGRATION
// ================================================================

const ASANA_BASE = 'https://app.asana.com/api/1.0';
const ASANA_TOKEN = process.env.ASANA_ACCESS_TOKEN;
const ASANA_WORKSPACE = process.env.ASANA_WORKSPACE_GID || '1210933746792503';

async function asanaFetch(endpoint, options = {}) {
  if (!ASANA_TOKEN) return { error: 'No Asana token configured' };

  const url = `${ASANA_BASE}${endpoint}`;
  const headers = {
    'Authorization': `Bearer ${ASANA_TOKEN}`,
    'Content-Type': 'application/json',
    ...options.headers
  };

  try {
    const resp = await fetch(url, { ...options, headers });
    const data = await resp.json();
    if (!resp.ok) return { error: data.errors?.[0]?.message || `HTTP ${resp.status}` };
    return data;
  } catch (err) {
    return { error: err.message };
  }
}

// Search Asana projects by PO number
async function searchProjectByPO(poNumber) {
  const data = await asanaFetch(
    `/workspaces/${ASANA_WORKSPACE}/typeahead?resource_type=project&query=${encodeURIComponent(poNumber)}&opt_fields=name,gid&count=10`
  );
  if (data.error) return { error: data.error };

  // Filter to projects that contain the PO number
  const matches = (data.data || []).filter(p =>
    p.name.includes(poNumber) || p.name.startsWith(poNumber)
  );
  return { projects: matches };
}

// Search Asana projects by client name or email
async function searchProjectByClient(query) {
  const data = await asanaFetch(
    `/workspaces/${ASANA_WORKSPACE}/typeahead?resource_type=project&query=${encodeURIComponent(query)}&opt_fields=name,gid&count=15`
  );
  if (data.error) return { error: data.error };
  return { projects: data.data || [] };
}

// Get tasks within a project (to find Graphic Design task)
async function getProjectTasks(projectGid) {
  const data = await asanaFetch(
    `/projects/${projectGid}/tasks?opt_fields=name,gid,completed&limit=20`
  );
  if (data.error) return { error: data.error };
  return data.data || [];
}

// Post a comment (design notes) on a task
async function postDesignNotes(taskGid, htmlBody) {
  const data = await asanaFetch(`/tasks/${taskGid}/stories`, {
    method: 'POST',
    body: JSON.stringify({ data: { html_text: htmlBody } })
  });
  return data;
}

// Create a presale task for new clients
async function createPresaleTask(formData) {
  // Find the Presale project
  const searchResult = await asanaFetch(
    `/workspaces/${ASANA_WORKSPACE}/typeahead?resource_type=project&query=Presale&opt_fields=name,gid&count=5`
  );

  let presaleProjectGid = process.env.ASANA_PRESALE_PROJECT_GID || null;
  if (!presaleProjectGid && searchResult.data) {
    const presaleProject = searchResult.data.find(p =>
      p.name.toLowerCase().includes('presale') || p.name.toLowerCase().includes('pre-sale')
    );
    if (presaleProject) presaleProjectGid = presaleProject.gid;
  }

  const taskName = `${formData.name || 'Unknown'} | ${formData.business || 'New Client'} | ${serviceLabel(formData)} ${actionLabel(formData)}`;

  const taskData = {
    data: {
      name: taskName,
      workspace: ASANA_WORKSPACE,
      ...(presaleProjectGid ? { projects: [presaleProjectGid] } : {}),
      notes: buildPlainTextNotes(formData)
    }
  };

  const result = await asanaFetch('/tasks', {
    method: 'POST',
    body: JSON.stringify(taskData)
  });

  return result;
}

// ---- Submission formatting helpers ----
// The widget sends: name, email, business, text, desc, service, serviceName,
// styles[], locations{ id: {position, instructions} }, designUrls[], selectedDesigns[],
// action ('save_for_later' | 'add_to_product' | 'vector_request'), productType, saveEmail.
// Older fields (serviceType, products, placements, pins, qty, deadline) are still read if present.

function serviceLabel(f) {
  return f.serviceName || f.serviceType || f.decoration || 'Custom Design';
}

function actionLabel(f) {
  const map = {
    save_for_later: '(Saved Designs)',
    add_to_product: `(Add to Product: ${f.productType || 'TBD'})`,
    vector_request: '(Vector File Request)'
  };
  return map[f.action] || '(Design Request)';
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
}

function locationLines(f) {
  const locs = f.locations && typeof f.locations === 'object' && !Array.isArray(f.locations) ? f.locations : {};
  const lines = Object.entries(locs).map(([id, v]) => {
    const name = id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const parts = [v?.position, v?.instructions].filter(Boolean).join(' - ');
    return `${name}${parts ? ': ' + parts : ''}`;
  });
  // legacy placements: { product: [locs] }
  Object.entries(f.placements || {}).forEach(([prod, l]) => lines.push(`${prod}: ${(l || []).join(', ')}`));
  return lines;
}

function designLines(f) {
  return (f.designUrls || []).filter(Boolean).map((u, i) => `Design ${i + 1}: ${u}`);
}

// Fields for both the Asana comment and the plain text task description.
function submissionFields(f) {
  const styles = Array.isArray(f.styles) && f.styles.length ? f.styles.join(', ') : (f.style || 'N/A');
  const products = Array.isArray(f.products) && f.products.length ? f.products.join(', ') : null;
  return [
    ['Client', f.name],
    ['Business', f.business],
    ['Email', f.email],
    ['Phone', f.phone],
    ['Service', serviceLabel(f)],
    ['Request type', actionLabel(f).replace(/[()]/g, '')],
    ['Product type', f.productType],
    ['Products', products],
    ['Styles', styles],
    ['Quantity', f.qty],
    ['Deadline', f.deadline],
    ['Garment colors', f.gcol],
    ['Design colors', f.dcol || 'B&W first'],
    ['Account email', f.saveEmail]
  ].filter(([, v]) => v !== undefined && v !== null && v !== '');
}

// Build design notes for an Asana comment (html_text). Plain labels, no bold, per house rules.
function buildDesignNotesHTML(f) {
  const fields = submissionFields(f).map(([k, v]) => `${k}: ${escapeHtml(v)}`).join('\n');
  const locs = locationLines(f).map(escapeHtml).join('\n');
  const designs = designLines(f).map(l => {
    const [lbl, url] = l.split(': ');
    return `${lbl}: <a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`;
  }).join('\n');
  const pins = (f.pins || []).filter(p => p.note || p.n).map((p, i) => `Pin ${i + 1} (${p.region || p.r}): ${p.note || p.n}`).join('\n');

  return `<body>AI Design Studio submission

${fields}

Placements:
${locs || 'N/A'}

Design text (spell exactly):
${escapeHtml(f.text) || 'N/A'}

Design description:
${escapeHtml(f.desc) || 'N/A'}

Selected designs:
${designs || 'None selected'}
${f.referenceImage ? `\nReference image: <a href="${escapeHtml(f.referenceImage)}">${escapeHtml(f.referenceImage)}</a>` : ''}
${pins ? `\nClient annotation notes:\n${escapeHtml(pins)}` : ''}
Special instructions:
${escapeHtml(f.notes) || 'None'}

Submitted via AI Design Studio on ${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PT</body>`;
}

function buildPlainTextNotes(f) {
  const fields = submissionFields(f).map(([k, v]) => `${k}: ${v}`).join('\n');
  return `AI Design Studio submission

${fields}

Placements:
${locationLines(f).join('\n') || 'N/A'}

Design text: ${f.text || 'N/A'}
Description: ${f.desc || 'N/A'}

Selected designs:
${designLines(f).join('\n') || 'None selected'}
${f.referenceImage ? `\nReference image: ${f.referenceImage}` : ''}
Special instructions: ${f.notes || 'None'}

Submitted via AI Design Studio on ${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PT`;
}


// ================================================================
// RECRAFT AI INTEGRATION
// ================================================================

const RECRAFT_API_KEY = process.env.RECRAFT_API_KEY;
const RECRAFT_BASE = 'https://external.api.recraft.ai/v1';

// Merchy's design rules — production-first, sellable, print-ready
function buildDesignPrompt(formData, variation) {
  const decorationType = formData.decoration || 'DTF';
  const style = formData.style || 'badge';
  const text = formData.text || '';
  const desc = formData.desc || '';
  const business = formData.business || '';

  // Core production rules from Merchy's standards
  const merchyRules = [
    'STRICT: Black and white ONLY. No color, no gray tones, no halftones.',
    'Vector-first: bold outlines, solid fills, clean separations between every element.',
    'No gradients, no soft shading, no fine hairline detail, no messy textures, no watercolor effects.',
    'Strong silhouette that is instantly recognizable from 20 feet away.',
    'Centered and balanced composition with clear visual hierarchy: focal point > supporting elements > text.',
    'Typography must be INTEGRATED into the design structure using arches, banners, ribbons, or embedded layouts. Text is never floating or slapped on top.',
    'Every element must serve a purpose. Remove anything unnecessary. Simplicity over complexity.',
    'Bold consistent outer strokes. No inconsistent stroke weights. No thin lines that will not print.',
    `Built for real ${decorationType} production: must screen print clean, embroider well, and scale from 3 inches to 14 inches without losing detail.`,
    'This must look like something people would actually wear. Sellable, wearable, professional merchandise.'
  ].join(' ');

  const styleMap = {
    badge: 'Classic circular shield or emblem crest. Top arc text crowns the design, bold center icon as focal point, bottom text anchors. The most versatile merchandise layout.',
    icon_logo: 'Single powerful scalable icon or logo mark. One strong symbol that works alone. Minimal or no text. Must be recognizable at thumbnail size on a hat or chest logo.',
    typography: 'Typography-driven design where bold stacked or arched lettering IS the design. Minimal supporting graphics. Text hierarchy creates the visual structure.',
    mascot: 'Custom illustrated character or mascot as the hero element. Bold outlines, simple shapes, expressive but clean. Character drives the identity with supporting text around it.',
    scene: 'Full illustrated scene with foreground action, background environment, and text woven into the composition. Simplified for print: no tiny details, strong contrast between elements.',
    badge_scene: 'Illustrated scene contained inside a circular or shield badge frame. Text wraps the outer edge. Combines the structure of a badge with the storytelling of a scene.',
    diagram: 'Technical structured layout like butcher cut charts, mechanical blueprints, or labeled anatomy diagrams. Main object in center with clean segmented sections and precise labels.',
    vintage_script: 'Retro travel postcard or vintage greeting card style. Flowing script headline with a supporting scene or simple icon. Nostalgic feel that reads as premium and wearable.',
    streetwear: 'Bold aggressive high-contrast graphic. Modern street style with oversized central element and minimal text. Trend-forward, graphic-heavy, designed for the front or back of a tee.',
    trade_tools: 'Crossed tools, industrial icons, or trade symbols as the centerpiece. Wrench, hammer, saw, or industry-specific equipment arranged symmetrically with supporting trade text.',
    corporate_seal: 'Professional polished corporate emblem. Clean geometric icon centered with balanced serif or sans-serif text. Structured, trustworthy, suitable for polos and business uniforms.',
    pattern: 'Repeating icons or shapes arranged in a structured grid or all-over scattered pattern. Each element is simple and bold. Designed for fashion prints, packaging, or branded wrapping.',
    monogram: 'Bold oversized initials, numbers, or monogram letters as the dominant visual. Thick block or serif letterforms. Minimal supporting elements. Team jersey or varsity style.',
    collage: 'Multiple bold elements composed together in a controlled layered arrangement. Organized visual energy with clear boundaries between each element. High impact but not chaotic.',
    product_focus: 'Clean illustration of the actual product or item centered as the hero. Bold outline rendering with supporting text below or around. Literal and clear about what is being sold.',
    humor: 'Concept-driven funny visual with a clear punchline built into the design. Simple clean illustration that delivers the joke at a glance. Must still be production-printable.',
    heritage: 'Established legacy feel with founding dates, classic serif typography, and a simple timeless icon. Feels like the brand has been around for decades. Clean and dignified.',
    line_art: 'Controlled continuous line art with intentional negative space. Every line is deliberate with consistent medium-weight strokes. Premium minimalist aesthetic that still prints bold.',
    patch_first: 'Designed specifically for embroidered patches: thick simplified shapes, bold merrowed border edge, limited detail inside, maximum 5-6 distinct areas. Built for stitching on hats and jackets.',
    event_series: 'Template-based layout designed to be reused annually. Consistent frame structure with designated swap zones for year, date, or event-specific text. Systematic and brandable.'
  };

  // Support multiple styles (up to 3) - combine their descriptions
  const styles = Array.isArray(formData.styles) ? formData.styles : [style];
  const styleDescs = styles.map(s => styleMap[s]).filter(Boolean);
  const styleDesc = styleDescs.length > 0 ? styleDescs.join(' ALSO BLEND IN: ') : styleMap.badge;

  // 6 variations - each targets a different composition approach
  const variations = [
    'LAYOUT A: Classic centered symmetrical composition. The icon or main visual sits dead center with text arching above and below. Most traditional merchandise layout.',
    'LAYOUT B: Typography-forward composition. The text and lettering drive the visual weight. Supporting icon or graphic is secondary, integrated into or behind the text structure.',
    'LAYOUT C: Illustration-forward composition. The graphic, character, or scene is the dominant element taking up 60-70% of the design. Text is compact and positioned below or integrated.',
    'LAYOUT D: Horizontal wide composition. Elements spread across the width. Text and icon side by side or in a landscape banner arrangement. Great for back-of-shirt prints.',
    'LAYOUT E: Stacked vertical composition. Elements stacked top to bottom: icon on top, text centered below, supporting details at bottom. Clean column layout.',
    'LAYOUT F: Asymmetric bold composition. Main element pushed to one side with text balanced on the opposite side. Dynamic and modern with intentional visual tension.'
  ];

  const prompt = `Create a production-ready custom merchandise design.

STYLE: ${styleDesc}

PRODUCTION RULES: ${merchyRules}

${desc ? `CONCEPT: ${desc}` : ''}
${text ? `TEXT TO INCLUDE (spell exactly): ${text}` : ''}
${business ? `BRAND: ${business}` : ''}

${variations[variation] || variations[0]}

FINAL CHECK: Would someone buy a shirt with this on it? Is it readable from across the room? Can it be screen printed in one color with zero issues? If yes to all three, this design is correct.`;

  return prompt;
}

const DESIGN_COUNT = 6;
const RECRAFT_MODEL = process.env.RECRAFT_MODEL || 'recraftv3';
const RECRAFT_STYLE = process.env.RECRAFT_STYLE || 'vector_illustration';
const RECRAFT_TIMEOUT_MS = 90000;

// Generate one design via Recraft. Throws on failure.
async function generateOneDesign(formData, i) {
  const prompt = buildDesignPrompt(formData, i);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RECRAFT_TIMEOUT_MS);

  try {
    const response = await fetch(`${RECRAFT_BASE}/images/generations`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${RECRAFT_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt: prompt,
        model: RECRAFT_MODEL,
        style: RECRAFT_STYLE,
        size: '1024x1024',
        n: 1,
        response_format: 'url',
        controls: {
          colors: [{ rgb: [0, 0, 0] }, { rgb: [255, 255, 255] }],
          background_color: { rgb: [255, 255, 255] }
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Recraft ${response.status}: ${errText.slice(0, 200)}`);
    }

    const data = await response.json();
    const imageUrl = data.data?.[0]?.url;
    if (!imageUrl) throw new Error('No image URL in Recraft response');

    // Download and save locally (Recraft URLs expire after ~24h)
    const imgResponse = await fetch(imageUrl, { signal: controller.signal });
    if (!imgResponse.ok) throw new Error(`Image download failed: ${imgResponse.status}`);
    const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());
    const filename = `design-${Date.now()}-${i}.png`;
    fs.writeFileSync(path.join(uploadsDir, filename), imgBuffer);

    return { url: `/uploads/${filename}`, remoteUrl: imageUrl, variation: i, prompt, source: 'recraft' };
  } finally {
    clearTimeout(timer);
  }
}

// Generate all designs. Runs in parallel. Falls back to local demo designs
// when Recraft is not configured or every generation fails, so the client
// flow always completes end to end.
async function generateDesigns(formData) {
  if (!RECRAFT_API_KEY) {
    console.log('No Recraft API key - serving demo designs');
    return { designs: buildDemoDesigns(formData), demo: true, notice: 'Preview mode: AI generation is not connected yet. These are layout previews.' };
  }

  const settled = await Promise.allSettled(
    Array.from({ length: DESIGN_COUNT }, (_, i) => generateOneDesign(formData, i))
  );

  const designs = settled.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    console.error(`Recraft generation ${i} failed:`, r.reason?.message || r.reason);
    return { error: r.reason?.message || 'Generation failed', variation: i };
  });

  const okCount = designs.filter(d => !d.error).length;
  if (okCount === 0) {
    const firstErr = designs[0]?.error || 'unknown error';
    console.error('All Recraft generations failed, serving demo designs. First error:', firstErr);
    return { designs: buildDemoDesigns(formData), demo: true, notice: 'Preview mode: AI generation is temporarily unavailable. These are layout previews.', error: firstErr };
  }

  // Backfill any individual failures with demo layouts so the grid is always full
  const demo = buildDemoDesigns(formData);
  const finalDesigns = designs.map((d, i) => d.error ? { ...demo[i], fallback: true } : d);
  return { designs: finalDesigns, demo: false, partial: okCount < DESIGN_COUNT };
}

// ---- Local demo designs (no API needed) ----
// Produces 6 black and white SVG layout previews using the client's own text,
// written to /uploads so they behave exactly like generated PNGs downstream.
function escapeXml(s) {
  return String(s || '').replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

function splitWords(text, maxPerLine) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxPerLine && cur) { lines.push(cur); cur = w; }
    else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

// Shrink a font size so `text` fits within maxWidth px (approx. 0.7em per char for heavy sans)
function fitSize(text, maxWidth, base, charW = 0.7) {
  const len = Math.max(1, String(text || '').length);
  return Math.max(28, Math.min(base, Math.floor(maxWidth / (len * charW))));
}

function buildDemoDesigns(formData) {
  const business = (formData.business || formData.name || "MERCHY'S").toUpperCase();
  const rawText = (formData.text || '').replace(/^(front|back|sleeve|hat)\s*:/gim, '').trim();
  const line = (rawText || formData.desc || 'CUSTOM DONE RIGHT').toUpperCase();
  const words = splitWords(line, 16);
  const styleName = (formData.styles && formData.styles[0]) || formData.style || 'badge';
  const B = escapeXml(business);
  const L1 = escapeXml(words[0] || '');
  const L2 = escapeXml(words[1] || '');
  const year = new Date().getFullYear();

  const font = `font-family="Arial Black, Impact, Helvetica, sans-serif" font-weight="900"`;
  const defs = `<defs><path id="arcTop" d="M 112 512 A 400 400 0 0 1 912 512"/><path id="arcBot" d="M 132 512 A 380 380 0 0 0 892 512"/></defs>`;
  const bg = `<rect width="1024" height="1024" fill="#fff"/>`;
  const label = (n) => `<text x="992" y="1004" text-anchor="end" font-family="Arial, sans-serif" font-size="22" fill="#999">LAYOUT ${n} PREVIEW</text>`;

  // Simple generic center marks per layout (bold shapes that print in one color)
  const starMark = `<path d="M512 330 L556 440 L674 448 L582 522 L616 638 L512 572 L408 638 L442 522 L350 448 L468 440 Z" fill="#000"/>`;
  const boltMark = `<path d="M560 300 L420 540 L510 540 L470 740 L620 470 L530 470 Z" fill="#000"/>`;
  const shieldMark = `<path d="M512 300 L660 350 L640 560 Q600 660 512 720 Q424 660 384 560 L364 350 Z" fill="none" stroke="#000" stroke-width="28"/><path d="M460 520 L500 560 L580 460" fill="none" stroke="#000" stroke-width="28" stroke-linecap="round" stroke-linejoin="round"/>`;
  const toolsMark = `<g stroke="#000" stroke-width="40" stroke-linecap="round"><line x1="380" y1="360" x2="644" y2="624"/><line x1="644" y1="360" x2="380" y2="624"/></g><circle cx="512" cy="492" r="70" fill="#fff" stroke="#000" stroke-width="28"/>`;
  const mountMark = `<path d="M300 660 L440 420 L520 540 L580 450 L724 660 Z" fill="#000"/><circle cx="660" cy="380" r="40" fill="#000"/>`;
  const monoMark = `<text x="512" y="600" text-anchor="middle" ${font} font-size="360" fill="#000">${escapeXml(business.charAt(0) || 'M')}</text>`;

  const layouts = [
    // A: classic badge, arc text
    `${defs}${bg}<circle cx="512" cy="512" r="440" fill="none" stroke="#000" stroke-width="30"/><circle cx="512" cy="512" r="380" fill="none" stroke="#000" stroke-width="8"/>
     <text ${font} font-size="76" fill="#000" letter-spacing="6"><textPath href="#arcTop" startOffset="50%" text-anchor="middle">${B}</textPath></text>
     ${starMark}
     <text ${font} font-size="58" fill="#000" letter-spacing="4"><textPath href="#arcBot" startOffset="50%" text-anchor="middle">${L1 || 'EST. ' + year}</textPath></text>${label('A')}`,
    // B: typography-forward stacked block
    `${bg}<rect x="92" y="92" width="840" height="840" fill="none" stroke="#000" stroke-width="22"/>
     <text x="512" y="380" text-anchor="middle" ${font} font-size="${fitSize(business.split(' ')[0] || 'MERCH', 760, 150)}" fill="#000">${escapeXml(business.split(' ')[0] || 'MERCH')}</text>
     <rect x="160" y="420" width="704" height="110" fill="#000"/>
     <text x="512" y="500" text-anchor="middle" ${font} font-size="${fitSize(words[0] || business, 640, 68)}" fill="#fff" letter-spacing="4">${L1 || B}</text>
     <text x="512" y="660" text-anchor="middle" ${font} font-size="${fitSize(words[1] || business.split(' ').slice(1).join(' ') || 'EST. 2000', 760, 64)}" fill="#000" letter-spacing="4">${L2 || escapeXml(business.split(' ').slice(1).join(' ') || 'EST. ' + year)}</text>
     <text x="512" y="800" text-anchor="middle" font-family="Arial, sans-serif" font-size="40" fill="#000" letter-spacing="12">${escapeXml((formData.decoration || 'CUSTOM').toUpperCase())}</text>${label('B')}`,
    // C: illustration-forward with compact text
    `${bg}${mountMark}<rect x="200" y="700" width="624" height="16" fill="#000"/>
     <text x="512" y="800" text-anchor="middle" ${font} font-size="${fitSize(business, 860, 84)}" fill="#000" letter-spacing="4">${B}</text>
     <text x="512" y="880" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="42" fill="#000" letter-spacing="10">${L1 || 'EST. ' + year}</text>${label('C')}`,
    // D: horizontal banner (back of shirt)
    `${bg}<rect x="60" y="380" width="904" height="264" fill="#000"/>
     <text x="512" y="490" text-anchor="middle" ${font} font-size="${fitSize(business, 840, 110)}" fill="#fff" letter-spacing="2">${B}</text>
     <text x="512" y="590" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="${fitSize(words[0] || 'CUSTOM DONE RIGHT', 820, 54, 0.75)}" fill="#fff" letter-spacing="6">${L1 || 'CUSTOM DONE RIGHT'}</text>
     <g transform="translate(0,-220) scale(0.55) translate(420,180)">${boltMark}</g>
     <g transform="translate(0,370) scale(0.55) translate(420,180)">${boltMark}</g>${label('D')}`,
    // E: stacked vertical column
    `${bg}<g transform="translate(0,-150)">${shieldMark}</g>
     <text x="512" y="700" text-anchor="middle" ${font} font-size="${fitSize(business, 880, 96)}" fill="#000" letter-spacing="2">${B}</text>
     <line x1="300" y1="740" x2="724" y2="740" stroke="#000" stroke-width="10"/>
     <text x="512" y="820" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="46" fill="#000" letter-spacing="8">${L1 || 'EST. ' + year}</text>
     <text x="512" y="890" text-anchor="middle" font-family="Arial, sans-serif" font-size="36" fill="#000" letter-spacing="6">${L2 || escapeXml('SAN DIEGO, CA')}</text>${label('E')}`,
    // F: asymmetric bold
    `${bg}<g transform="translate(-290,-20) scale(0.95) translate(0,40)">${styleName === 'trade_tools' ? toolsMark : monoMark}</g>
     <text x="560" y="420" ${font} font-size="${fitSize(business.split(' ')[0] || 'MERCH', 420, 100)}" fill="#000">${escapeXml(business.split(' ')[0] || 'MERCH')}</text>
     <text x="560" y="520" ${font} font-size="${fitSize(business.split(' ').slice(1).join(' ') || 'MERCH', 420, 100)}" fill="#000">${escapeXml(business.split(' ').slice(1).join(' ') || 'MERCH')}</text>
     <rect x="560" y="560" width="380" height="14" fill="#000"/>
     <text x="560" y="640" font-family="Arial, sans-serif" font-weight="700" font-size="${fitSize(words[0] || 'EST. 2000', 400, 44, 0.75)}" fill="#000" letter-spacing="4">${L1 || 'EST. ' + year}</text>${label('F')}`
  ];

  const stamp = Date.now();
  return layouts.map((inner, i) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">${inner}</svg>`;
    const filename = `demo-${stamp}-${i}.svg`;
    fs.writeFileSync(path.join(uploadsDir, filename), svg);
    return { url: `/uploads/${filename}`, variation: i, source: 'demo', prompt: buildDesignPrompt(formData, i) };
  });
}

// Vectorize using Recraft's vectorize endpoint
async function vectorizeDesign(imageUrl) {
  if (!RECRAFT_API_KEY) return { error: 'Vectorizing is not connected yet. Call 619-800-0949 and we will send your vector file.' };
  if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) return { error: 'A public image URL is required to vectorize.' };

  try {
    const response = await fetch(`${RECRAFT_BASE}/images/vectorize`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RECRAFT_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ image_url: imageUrl, response_format: 'url' })
    });

    if (!response.ok) {
      const errText = await response.text();
      return { error: `Vectorize failed: ${response.status} ${errText.slice(0, 120)}` };
    }
    const data = await response.json();
    const svgUrl = data.image?.url || data.data?.[0]?.url;
    if (!svgUrl) return { error: 'No SVG URL in vectorize response' };
    return { svg_url: svgUrl };
  } catch (err) {
    return { error: err.message };
  }
}


// ================================================================
// API ROUTES
// ================================================================

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    demoMode: !RECRAFT_API_KEY,
    asana: !!ASANA_TOKEN,
    recraft: !!RECRAFT_API_KEY,
    email: !!emailTransporter,
    stripe: !!stripe
  });
});

// Upload reference images
app.post('/api/upload', upload.array('files', 10), (req, res) => {
  const files = (req.files || []).map(f => ({
    filename: f.filename,
    url: `/uploads/${f.filename}`,
    originalName: f.originalname,
    size: f.size
  }));
  res.json({ files });
});

// Search Asana projects (Smart Lookup)
app.get('/api/projects/search', async (req, res) => {
  const { query, type } = req.query;
  if (!query) return res.json({ projects: [] });

  let result;
  if (type === 'po') {
    result = await searchProjectByPO(query);
  } else {
    result = await searchProjectByClient(query);
  }

  if (result.error) return res.status(500).json(result);
  res.json(result);
});

// Generate AI designs
app.post('/api/generate', async (req, res) => {
  const formData = req.body;
  console.log('Generate request for:', formData.name, formData.business);

  const result = await generateDesigns(formData);
  res.json(result);
});

// Vectorize a design
app.post('/api/vectorize', async (req, res) => {
  const { imageUrl } = req.body;
  const result = await vectorizeDesign(imageUrl);
  res.json(result);
});

// Submit final design request (routes to Asana)
app.post('/api/submit', async (req, res) => {
  const formData = req.body || {};
  if (!formData.name && !formData.email) return res.status(400).json({ success: false, error: 'Name or email is required' });

  // Make relative /uploads paths absolute so Asana and email links work
  const base = (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const abs = (u) => (u && u.startsWith('/')) ? base + u : u;
  formData.designUrls = (formData.designUrls || []).map(abs).filter(Boolean);
  formData.referenceImage = abs(formData.referenceImage);
  console.log('=== DESIGN SUBMISSION ===');
  console.log('Client:', formData.name, '|', formData.business);
  console.log('PO:', formData.poNumber || 'None');
  console.log('Project GID:', formData.projectGid || 'None');

  const results = { asana: null, email: null };

  // ---- Route to Asana ----
  try {
    if (formData.projectGid) {
      // We have a specific project - find the Graphic Design task and comment
      const tasks = await getProjectTasks(formData.projectGid);
      const designTask = tasks.find(t =>
        t.name.toLowerCase().includes('graphic design') ||
        t.name.toLowerCase().includes('artwork') ||
        t.name.toLowerCase().includes('design')
      );

      if (designTask) {
        const html = buildDesignNotesHTML(formData);
        const commentResult = await postDesignNotes(designTask.gid, html);
        results.asana = {
          success: !commentResult.error,
          action: 'comment_posted',
          taskGid: designTask.gid,
          taskName: designTask.name,
          error: commentResult.error
        };
      } else {
        // No design task found - comment on the first incomplete task
        const firstTask = tasks.find(t => !t.completed) || tasks[0];
        if (firstTask) {
          const html = buildDesignNotesHTML(formData);
          const commentResult = await postDesignNotes(firstTask.gid, html);
          results.asana = {
            success: !commentResult.error,
            action: 'comment_posted_first_task',
            taskGid: firstTask.gid,
            taskName: firstTask.name,
            error: commentResult.error
          };
        }
      }
    } else if (formData.poNumber) {
      // Search by PO number
      const search = await searchProjectByPO(formData.poNumber);
      if (search.projects && search.projects.length > 0) {
        const project = search.projects[0];
        const tasks = await getProjectTasks(project.gid);
        const designTask = tasks.find(t =>
          t.name.toLowerCase().includes('graphic design') ||
          t.name.toLowerCase().includes('artwork')
        ) || tasks.find(t => !t.completed) || tasks[0];

        if (designTask) {
          const html = buildDesignNotesHTML(formData);
          const commentResult = await postDesignNotes(designTask.gid, html);
          results.asana = {
            success: !commentResult.error,
            action: 'po_matched',
            projectName: project.name,
            taskGid: designTask.gid,
            error: commentResult.error
          };
        }
      } else {
        // PO not found - create presale task
        const presaleResult = await createPresaleTask(formData);
        results.asana = {
          success: !presaleResult.error,
          action: 'presale_created',
          taskGid: presaleResult.data?.gid,
          error: presaleResult.error
        };
      }
    } else {
      // No PO, no project - create presale task
      const presaleResult = await createPresaleTask(formData);
      results.asana = {
        success: !presaleResult.error,
        action: 'presale_created',
        taskGid: presaleResult.data?.gid,
        error: presaleResult.error
      };
    }
  } catch (err) {
    console.error('Asana error:', err);
    results.asana = { success: false, error: err.message };
  }

  // ---- Send email confirmation ----
  if (emailTransporter && formData.email) {
    try {
      const designImgs = (formData.designUrls || []).map(u => `<img src="${escapeHtml(u)}" style="width:120px;height:120px;object-fit:cover;border:1px solid #ddd;border-radius:6px;margin:4px">`).join('');
      const requestType = actionLabel(formData).replace(/[()]/g, '');
      await emailTransporter.sendMail({
        from: process.env.EMAIL_FROM || 'Merchy\'s Design Studio <start@merchysmerch.com>',
        to: formData.email,
        subject: `Design Request Received - ${formData.business || formData.name || 'Merchy\'s'}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #111; padding: 20px; text-align: center;">
              <h1 style="color: #d4a017; margin: 0; font-size: 22px; letter-spacing: 2px;">MERCHY'S DESIGN STUDIO</h1>
            </div>
            <div style="padding: 30px; background: #fff;">
              <h2 style="color: #111; font-size: 18px;">We got your design request.</h2>
              <p style="color: #555; line-height: 1.6;">
                ${formData.name}, thanks for submitting your design through our AI Design Studio.
                Our team is reviewing your request and will follow up within 24 hours.
              </p>
              <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 20px 0;">
                <p style="margin: 4px 0; font-size: 14px;"><strong>Service:</strong> ${escapeHtml(serviceLabel(formData))}</p>
                <p style="margin: 4px 0; font-size: 14px;"><strong>Request:</strong> ${escapeHtml(requestType)}</p>
                ${formData.productType ? `<p style="margin: 4px 0; font-size: 14px;"><strong>Product:</strong> ${escapeHtml(formData.productType)}</p>` : ''}
                ${formData.text ? `<p style="margin: 4px 0; font-size: 14px;"><strong>Design text:</strong> ${escapeHtml(formData.text)}</p>` : ''}
                ${formData.poNumber ? `<p style="margin: 4px 0; font-size: 14px;"><strong>PO #:</strong> ${escapeHtml(formData.poNumber)}</p>` : ''}
              </div>
              ${designImgs ? `<p style="color: #555; font-size: 14px; margin-bottom: 4px;">Your selected designs:</p><div>${designImgs}</div>` : ''}
              <p style="color: #555; line-height: 1.6;">
                If you have any questions, reply to this email or text us at 619-800-0949.
              </p>
              <p style="color: #888; font-size: 12px; margin-top: 20px;">- Merchy's Team</p>
            </div>
          </div>
        `
      });
      results.email = { success: true };
    } catch (err) {
      console.error('Email error:', err);
      results.email = { success: false, error: err.message };
    }
  }

  // ---- Save submission locally as backup ----
  try {
    const backupDir = path.join(__dirname, 'submissions');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    const backupFile = path.join(backupDir, `submission-${Date.now()}.json`);
    fs.writeFileSync(backupFile, JSON.stringify(formData, null, 2));
  } catch (err) {
    console.error('Backup save error:', err);
  }

  console.log('Submission results:', results);
  res.json({ success: true, results });
});


// ================================================================
// SERVICES CATALOG (65 services across 6 categories)
// ================================================================

const SERVICE_CATEGORIES = [
  { id: 'apparel_decoration', name: 'Apparel Decoration', icon: 'shirt' },
  { id: 'signs_banners', name: 'Signs & Banners', icon: 'sign' },
  { id: 'business_print', name: 'Business Printing', icon: 'file' },
  { id: 'promo_products', name: 'Promo Products', icon: 'gift' },
  { id: 'specialty', name: 'Specialty', icon: 'star' },
  { id: 'design_services', name: 'Design Services', icon: 'palette' }
];

const SERVICES_CATALOG = [
  // ---- Apparel Decoration ----
  { id: 'dtf-printing', name: 'DTF Printing', priceRange: '$8-$15/piece', category: 'apparel_decoration', desc: 'Full-color transfers on any fabric. No minimums, 5 business day turnaround.' },
  { id: 'screen-printing', name: 'Screen Printing', priceRange: '$5-$12/piece', category: 'apparel_decoration', desc: 'Up to 13 colors, best for 48+ pieces. 10 business day turnaround.' },
  { id: 'embroidery', name: 'Embroidery', priceRange: '$8-$20/piece', category: 'apparel_decoration', desc: 'Stitched logos on polos, jackets, and hats. Professional and durable.' },
  { id: 'dtg-printing', name: 'DTG Printing', priceRange: '$10-$18/piece', category: 'apparel_decoration', desc: 'Direct-to-garment for detailed photo prints. Great for small runs.' },
  { id: 'heat-transfer', name: 'Heat Transfer', priceRange: '$6-$12/piece', category: 'apparel_decoration', desc: 'Vinyl and heat-applied graphics for names, numbers, and logos.' },
  { id: 'sublimation-apparel', name: 'Sublimation (Apparel)', priceRange: '$12-$25/piece', category: 'apparel_decoration', desc: 'All-over prints on polyester garments. Vibrant edge-to-edge color.' },
  // ---- Signs & Banners ----
  { id: 'vinyl-banners', name: 'Vinyl Banners', priceRange: '$3-$8/sqft', category: 'signs_banners', desc: 'Indoor and outdoor banners for events, storefronts, and promotions.' },
  { id: 'retractable-banners', name: 'Retractable Banners', priceRange: '$75-$200', category: 'signs_banners', desc: 'Portable pull-up displays for trade shows and events.' },
  { id: 'yard-signs', name: 'Yard Signs', priceRange: '$8-$20/each', category: 'signs_banners', desc: 'Corrugated plastic signs for real estate, elections, and events.' },
  { id: 'window-graphics', name: 'Window Graphics', priceRange: '$5-$15/sqft', category: 'signs_banners', desc: 'Vinyl lettering, perforated film, and frosted glass for storefronts.' },
  { id: 'wall-wraps', name: 'Wall Wraps & Murals', priceRange: '$10-$25/sqft', category: 'signs_banners', desc: 'Large format wall graphics for offices, restaurants, and retail.' },
  { id: 'car-wraps', name: 'Vehicle Wraps', priceRange: '$200-$500+', category: 'signs_banners', desc: 'Partial and full vehicle wraps for cars, trucks, and vans.' },
  { id: 'a-frame-signs', name: 'A-Frame Signs', priceRange: '$40-$100', category: 'signs_banners', desc: 'Sidewalk signs for restaurants, salons, and retail storefronts.' },
  { id: 'acrylic-signs', name: 'Acrylic & Metal Signs', priceRange: '$50-$300', category: 'signs_banners', desc: 'Premium lobby signs, wayfinding, and office signage.' },
  // ---- Business Printing ----
  { id: 'business-cards', name: 'Business Cards', priceRange: '$25-$75', category: 'business_print', desc: 'Standard, premium, and specialty finishes. Multiple paper stocks.' },
  { id: 'flyers', name: 'Flyers & Handouts', priceRange: '$0.10-$0.50/each', category: 'business_print', desc: 'Single and double-sided flyers for promotions and events.' },
  { id: 'brochures', name: 'Brochures', priceRange: '$0.25-$1.00/each', category: 'business_print', desc: 'Bi-fold and tri-fold brochures for services and product lines.' },
  { id: 'postcards', name: 'Postcards & Mailers', priceRange: '$0.15-$0.75/each', category: 'business_print', desc: 'Direct mail postcards for marketing campaigns.' },
  { id: 'menus', name: 'Menus', priceRange: '$2-$10/each', category: 'business_print', desc: 'Restaurant, cafe, and event menus. Laminated or cardstock.' },
  { id: 'ncr-forms', name: 'NCR Forms', priceRange: '$0.50-$2.00/each', category: 'business_print', desc: 'Carbonless copy forms for invoices, receipts, and work orders.' },
  { id: 'booklets', name: 'Booklets & Catalogs', priceRange: '$3-$15/each', category: 'business_print', desc: 'Saddle-stitched and perfect-bound booklets for product lines.' },
  { id: 'letterhead', name: 'Letterhead & Envelopes', priceRange: '$0.15-$0.50/each', category: 'business_print', desc: 'Professional branded stationery for your business.' },
  { id: 'door-hangers', name: 'Door Hangers', priceRange: '$0.20-$0.75/each', category: 'business_print', desc: 'Die-cut door hangers for local marketing and promotions.' },
  // ---- Promo Products ----
  { id: 'drinkware', name: 'Drinkware', priceRange: '$5-$25/each', category: 'promo_products', desc: 'Custom mugs, tumblers, water bottles, and koozies.' },
  { id: 'tote-bags', name: 'Tote Bags', priceRange: '$3-$15/each', category: 'promo_products', desc: 'Canvas and non-woven bags with your logo for events and retail.' },
  { id: 'pens', name: 'Pens & Writing', priceRange: '$1-$5/each', category: 'promo_products', desc: 'Branded pens, pencils, and highlighters for offices and events.' },
  { id: 'tech-accessories', name: 'Tech Accessories', priceRange: '$5-$30/each', category: 'promo_products', desc: 'Phone cases, chargers, USB drives, and earbuds with your brand.' },
  { id: 'trade-show-displays', name: 'Trade Show Displays', priceRange: '$100-$500+', category: 'promo_products', desc: 'Tablecloths, backdrops, tents, and booth setups.' },
  { id: 'lanyards', name: 'Lanyards & Badges', priceRange: '$2-$8/each', category: 'promo_products', desc: 'Custom lanyards, badge holders, and event credentials.' },
  { id: 'stickers-labels', name: 'Stickers & Labels', priceRange: '$0.25-$3/each', category: 'promo_products', desc: 'Die-cut stickers, vinyl decals, product labels, and bumper stickers.' },
  { id: 'keychains', name: 'Keychains & Accessories', priceRange: '$2-$10/each', category: 'promo_products', desc: 'Custom keychains, pins, magnets, and small branded items.' },
  { id: 'packaging', name: 'Custom Packaging', priceRange: '$1-$10/each', category: 'promo_products', desc: 'Branded boxes, poly mailers, tissue paper, and tape.' },
  { id: 'food-wellness', name: 'Food & Wellness Items', priceRange: '$3-$15/each', category: 'promo_products', desc: 'Branded snacks, mints, lip balm, hand sanitizer, and wellness kits.' },
  { id: 'outdoor-leisure', name: 'Outdoor & Leisure', priceRange: '$5-$50/each', category: 'promo_products', desc: 'Umbrellas, coolers, blankets, and sports equipment with your logo.' },
  { id: 'awards', name: 'Awards & Recognition', priceRange: '$10-$75/each', category: 'promo_products', desc: 'Trophies, plaques, medals, and crystal awards for achievements.' },
  { id: 'pet-supplies', name: 'Pet Supplies', priceRange: '$5-$20/each', category: 'promo_products', desc: 'Custom pet bowls, bandanas, leashes, and toys for pet brands.' },
  { id: 'auto-accessories', name: 'Auto Accessories', priceRange: '$5-$25/each', category: 'promo_products', desc: 'Car air fresheners, license plate frames, and seat covers.' },
  // ---- Specialty ----
  { id: 'uv-printing', name: 'UV Printing', priceRange: '$5-$50/piece', category: 'specialty', desc: 'Print directly on rigid surfaces: wood, metal, glass, acrylic, and more.' },
  { id: 'sublimation', name: 'Sublimation (Products)', priceRange: '$8-$30/piece', category: 'specialty', desc: 'Vibrant full-color prints on mugs, mousepads, phone cases, and more.' },
  { id: 'laser-engraving', name: 'Laser Engraving', priceRange: '$5-$40/piece', category: 'specialty', desc: 'Precision engraving on wood, metal, leather, glass, and acrylic.' },
  { id: 'patches', name: 'Patches', priceRange: '$3-$15/each', category: 'specialty', desc: 'Embroidered, woven, PVC, and chenille patches for uniforms and merch.' },
  { id: 'embroidered-patches', name: 'Embroidered Patches', priceRange: '$3-$10/each', category: 'specialty', desc: 'Classic thread patches with merrowed borders for hats and jackets.' },
  { id: 'pvc-patches', name: 'PVC Patches', priceRange: '$3-$12/each', category: 'specialty', desc: 'Durable rubber patches for tactical, outdoor, and streetwear.' },
  { id: 'chenille-patches', name: 'Chenille Patches', priceRange: '$5-$15/each', category: 'specialty', desc: 'Varsity-style fuzzy patches for letterman jackets and retro designs.' },
  // ---- Design Services ----
  { id: 'logo-design', name: 'Logo Design', priceRange: '$50-$200', category: 'design_services', desc: 'Custom logo creation with multiple concepts and revisions.' },
  { id: 'vectorizing', name: 'Vectorizing', priceRange: '$10-$50', category: 'design_services', desc: 'Convert any image to a scalable vector file for production.' },
  { id: 'mockups', name: 'Mockups', priceRange: '$10/Free with order', category: 'design_services', desc: 'See your design on the actual product before production.' },
  { id: 'brand-identity', name: 'Brand Identity Package', priceRange: '$200-$500', category: 'design_services', desc: 'Full brand kit: logo, colors, fonts, business cards, and social templates.' },
  { id: 'social-media-graphics', name: 'Social Media Graphics', priceRange: '$25-$100', category: 'design_services', desc: 'Custom graphics for Instagram, Facebook, TikTok, and more.' },
  { id: 'illustration', name: 'Custom Illustration', priceRange: '$75-$300', category: 'design_services', desc: 'Hand-drawn and digital illustrations, mascots, and characters.' },
  { id: 'photo-editing', name: 'Photo Editing', priceRange: '$15-$75', category: 'design_services', desc: 'Background removal, retouching, and product photo cleanup.' },
  { id: 'shirt-design', name: 'Shirt & Apparel Design', priceRange: '$25-$200', category: 'design_services', desc: 'Custom artwork created specifically for t-shirts and apparel.' },
  { id: 'packaging-design', name: 'Packaging Design', priceRange: '$75-$250', category: 'design_services', desc: 'Custom box, bag, and packaging artwork for your products.' },
  { id: 'digitizing', name: 'Digitizing (DST)', priceRange: '$30-$75', category: 'design_services', desc: 'Convert artwork to embroidery-ready DST files for production.' }
];

// Services catalog route
app.get('/api/services', (req, res) => {
  const { category } = req.query;
  let services = SERVICES_CATALOG;
  if (category) services = services.filter(s => s.category === category);
  res.json({ services, total: services.length });
});

// Widget config route
app.get('/api/widget-config', (req, res) => {
  res.json({
    services: SERVICES_CATALOG,
    categories: SERVICE_CATEGORIES,
    styles: [
      { id: 'badge', name: 'Badge / Crest', icon: 'shield', desc: 'Circular emblem with arc text and center icon' },
      { id: 'icon_logo', name: 'Icon / Logo Mark', icon: 'target', desc: 'Clean minimal scalable symbol' },
      { id: 'typography', name: 'Typography', icon: 'type', desc: 'Bold dominant lettering as the hero' },
      { id: 'mascot', name: 'Mascot / Character', icon: 'smile', desc: 'Illustrated character or mascot' },
      { id: 'scene', name: 'Scene / Environment', icon: 'image', desc: 'Full illustration with story elements' },
      { id: 'badge_scene', name: 'Badge + Scene', icon: 'globe', desc: 'Scene contained inside a badge frame' },
      { id: 'diagram', name: 'Diagram / Technical', icon: 'grid', desc: 'Labeled blueprints or butcher-cut style' },
      { id: 'vintage_script', name: 'Vintage Script', icon: 'feather', desc: 'Retro postcard style with script text' },
      { id: 'streetwear', name: 'Bold Streetwear', icon: 'zap', desc: 'Aggressive modern high-contrast graphic' },
      { id: 'trade_tools', name: 'Trade / Tools', icon: 'tool', desc: 'Crossed tools or industry symbols' },
      { id: 'corporate_seal', name: 'Corporate Seal', icon: 'award', desc: 'Professional structured minimal emblem' },
      { id: 'pattern', name: 'Pattern / Repeat', icon: 'layers', desc: 'Repeating icons or shapes grid' },
      { id: 'monogram', name: 'Monogram / Number', icon: 'hash', desc: 'Bold initials or numbers centered' },
      { id: 'collage', name: 'Mashup / Collage', icon: 'layout', desc: 'Multiple elements in controlled chaos' },
      { id: 'product_focus', name: 'Product-Focused', icon: 'box', desc: 'Illustration of the product itself' },
      { id: 'humor', name: 'Humor / Novelty', icon: 'smile', desc: 'Funny concept-driven visual' },
      { id: 'heritage', name: 'Heritage / Legacy', icon: 'bookmark', desc: 'Old-school established classic feel' },
      { id: 'line_art', name: 'Minimal Line Art', icon: 'pen-tool', desc: 'Clean thin outlines, negative space' },
      { id: 'patch_first', name: 'Patch / Embroidery', icon: 'hexagon', desc: 'Bold shapes built for stitching' },
      { id: 'event_series', name: 'Event Series', icon: 'calendar', desc: 'Template-based scalable layout' }
    ],
    locations: [
      { id: 'front', name: 'Front', positions: ['Full Front', 'Chest Logo', 'Pocket Logo', 'Oversized'] },
      { id: 'back', name: 'Back', positions: ['Full Back', 'Oversized'] },
      { id: 'left-sleeve', name: 'Left Sleeve' },
      { id: 'right-sleeve', name: 'Right Sleeve' },
      { id: 'neck-label', name: 'Neck Label' },
      { id: 'hat', name: 'Hat' }
    ],
    company: { name: "Merchy's Merch", phone: '619-800-0949', email: 'start@merchysmerch.com' },
    stripeEnabled: !!stripe,
    recraftEnabled: !!RECRAFT_API_KEY,
    demoMode: !RECRAFT_API_KEY
  });
});

// ================================================================
// STRIPE PAYMENT ROUTES (for vectorize paywall)
// ================================================================

// Create Stripe checkout session for vector file purchase
app.post('/api/create-checkout', async (req, res) => {
  if (!stripe) return res.status(501).json({ error: 'Payment not configured. Contact us at 619-800-0949 to purchase.' });

  const { tier, designUrl, email } = req.body;
  const tiers = {
    basic: { amount: 1000, name: 'Basic Vector File', desc: 'Single-element vector (SVG)' },
    detailed: { amount: 2500, name: 'Detailed Vector File', desc: 'Multi-element production-ready vector' },
    complex: { amount: 5000, name: 'Complex Vector Package', desc: 'Full vector package with all variations' }
  };
  const selected = tiers[tier] || tiers.basic;

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price_data: { currency: 'usd', product_data: { name: selected.name, description: selected.desc }, unit_amount: selected.amount }, quantity: 1 }],
      mode: 'payment',
      customer_email: email || undefined,
      success_url: `${req.protocol}://${req.get('host')}/api/vectorize-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.protocol}://${req.get('host')}/?cancelled=true`,
      metadata: { designUrl: designUrl || '', tier }
    });
    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('Stripe checkout error:', err.message);
    res.status(500).json({ error: 'Checkout failed' });
  }
});

// Vectorize with payment verification
app.post('/api/vectorize-paid', async (req, res) => {
  const { imageUrl, paymentToken } = req.body;
  if (!paymentToken) return res.status(402).json({ error: 'Payment required to download vector files. Use /api/create-checkout first.' });

  // Verify payment if Stripe is configured
  if (stripe) {
    try {
      const session = await stripe.checkout.sessions.retrieve(paymentToken);
      if (session.payment_status !== 'paid') return res.status(402).json({ error: 'Payment not completed' });
    } catch (err) {
      return res.status(402).json({ error: 'Invalid payment token' });
    }
  }

  const result = await vectorizeDesign(imageUrl);
  res.json(result);
});

// Vectorize success redirect
app.get('/api/vectorize-success', async (req, res) => {
  const { session_id } = req.query;
  res.redirect(`/?payment=success&session=${session_id}`);
});


// ---- Design Studio v2 (art director plugin) ----
require('./routes/studio')(app, { asanaFetch, searchProjectByPO, getProjectTasks, postDesignNotes, ASANA_WORKSPACE, ASANA_TOKEN, emailTransporter, uploadsDir, escapeHtml });

// ---- Serve frontend from /public ----
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'studio.html')));
app.get('/legacy', (req, res) => res.sendFile(path.join(__dirname, 'public', 'widget.html')));

// ---- Start server ----
app.listen(PORT, () => {
  console.log(`\n  Merchy's Design Bot running on http://localhost:${PORT}`);
  console.log(`  Asana:   ${ASANA_TOKEN ? 'Connected' : 'Not configured'}`);
  console.log(`  Recraft: ${RECRAFT_API_KEY ? 'Connected' : 'Not configured (using placeholders)'}`);
  console.log(`  Email:   ${emailTransporter ? 'Connected' : 'Not configured'}`);
  console.log(`  Stripe:  ${stripe ? 'Connected' : 'Not configured (vector paywall disabled)'}`);
  console.log(`  Director: ${process.env.ANTHROPIC_API_KEY ? 'Anthropic model' : 'Built-in question bank (set ANTHROPIC_API_KEY)'}\n`);
});

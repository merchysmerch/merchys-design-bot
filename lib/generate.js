// ================================================================
// Image generation: Recraft when configured, local SVG previews otherwise.
// ================================================================
const fs = require('fs');
const path = require('path');
const { STYLE_NAMES } = require('./questions');

const RECRAFT_API_KEY = process.env.RECRAFT_API_KEY;
const RECRAFT_BASE = 'https://external.api.recraft.ai/v1';
const RECRAFT_MODEL = process.env.RECRAFT_MODEL || 'recraftv3';
const RECRAFT_STYLE = process.env.RECRAFT_STYLE || 'vector_illustration';
const TIMEOUT = 120000;

let uploadsDir = path.join(__dirname, '..', 'uploads');
function setUploadsDir(d) { uploadsDir = d; }

async function saveRemote(url, name) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(path.join(uploadsDir, name), buf);
  return `/uploads/${name}`;
}

async function recraft(endpoint, body) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const r = await fetch(`${RECRAFT_BASE}${endpoint}`, {
      method: 'POST', signal: ctrl.signal,
      headers: { Authorization: `Bearer ${RECRAFT_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error(`Recraft ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return r.json();
  } finally { clearTimeout(t); }
}

// One image for one style
async function generateStyleImage(prompt, styleId, tag) {
  if (!RECRAFT_API_KEY) return demoImage(prompt, styleId, 0, tag);
  const data = await recraft('/images/generations', {
    prompt, model: RECRAFT_MODEL, style: RECRAFT_STYLE, size: '1024x1024', n: 1, response_format: 'url',
    controls: { background_color: { rgb: [255, 255, 255] } }
  });
  const url = data.data?.[0]?.url;
  if (!url) throw new Error('No image in response');
  const local = await saveRemote(url, `style-${tag}-${styleId}-${Date.now()}.png`);
  return { url: local, remoteUrl: url, source: 'recraft', prompt };
}

// Five refinements of one image
async function refineImage(baseAbsUrl, prompts, styleId, tag) {
  if (!RECRAFT_API_KEY) return prompts.map((p, i) => demoImage(p, styleId, i + 1, tag));
  const out = [];
  const settled = await Promise.allSettled(prompts.map((prompt, i) =>
    recraft('/images/imageToImage', {
      image_url: baseAbsUrl, prompt, strength: 0.45 + (i % 3) * 0.1, model: RECRAFT_MODEL, style: RECRAFT_STYLE, n: 1, response_format: 'url'
    }).then(async data => {
      const url = data.data?.[0]?.url;
      if (!url) throw new Error('No image');
      const local = await saveRemote(url, `refine-${tag}-${styleId}-${i}-${Date.now()}.png`);
      return { url: local, remoteUrl: url, source: 'recraft', prompt };
    })
  ));
  settled.forEach((s, i) => out.push(s.status === 'fulfilled' ? s.value : { ...demoImage(prompts[i], styleId, i + 1, tag), fallback: true, error: s.reason?.message }));
  return out;
}

// ---- Demo SVG previews (full color, style-aware) ----
const PALETTES = [
  ['#1f2a44', '#e9b44c', '#f4f1ea'], ['#1b4332', '#d8f3dc', '#f0a202'], ['#7a1f1f', '#f3e9d2', '#1c1c1c'],
  ['#0b3954', '#ff6663', '#fefffe'], ['#2d2a32', '#f2c14e', '#7fb7be'], ['#3a2e39', '#e3b23c', '#edf2f4']
];
const esc = s => String(s || '').replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
const fit = (text, maxW, base, cw = 0.68) => Math.max(26, Math.min(base, Math.floor(maxW / (Math.max(1, String(text || '').length) * cw))));

function demoImage(prompt, styleId, variant, tag) {
  const textMatch = prompt.match(/TEXT \(spell exactly\): ([^\n.]*)/);
  const text = (textMatch ? textMatch[1] : 'MERCHYS').trim().toUpperCase() || "MERCHY'S";
  const words = text.split(/\s+/);
  const first = words[0], rest = words.slice(1).join(' ');
  const [ink, accent, paper] = PALETTES[(Object.keys(STYLE_NAMES).indexOf(styleId) + variant) % PALETTES.length];
  const F = 'font-family="Arial Black, Impact, Helvetica, sans-serif" font-weight="900"';
  const name = STYLE_NAMES[styleId] || styleId;
  const sub = variant ? `REFINEMENT ${variant}` : 'CONCEPT';
  const label = `<text x="992" y="1004" text-anchor="end" font-family="Arial, sans-serif" font-size="22" fill="#999">${esc(name)} ${sub} PREVIEW</text>`;
  const bg = `<rect width="1024" height="1024" fill="#fff"/>`;
  const rot = (variant * 7) % 21 - 10;
  let body;
  switch (styleId) {
    case 'typography': case 'monogram': case 'streetwear':
      body = `<rect x="92" y="92" width="840" height="840" rx="${variant * 20}" fill="${paper}" stroke="${ink}" stroke-width="22"/>
        <text x="512" y="430" text-anchor="middle" ${F} font-size="${fit(first, 760, 170)}" fill="${ink}" transform="rotate(${rot} 512 430)">${esc(first)}</text>
        <rect x="160" y="470" width="704" height="100" fill="${accent}"/>
        <text x="512" y="542" text-anchor="middle" ${F} font-size="${fit(rest || 'EST 2026', 640, 60)}" fill="${ink}">${esc(rest || 'EST. 2026')}</text>`;
      break;
    case 'mascot': case 'humor':
      body = `<circle cx="512" cy="400" r="${230 + variant * 10}" fill="${accent}" stroke="${ink}" stroke-width="20"/>
        <circle cx="440" cy="370" r="34" fill="${ink}"/><circle cx="584" cy="370" r="34" fill="${ink}"/>
        <path d="M400 480 Q512 ${560 + variant * 15} 624 480" stroke="${ink}" stroke-width="22" fill="none" stroke-linecap="round"/>
        <text x="512" y="780" text-anchor="middle" ${F} font-size="${fit(text, 880, 90)}" fill="${ink}">${esc(text)}</text>`;
      break;
    case 'scene': case 'badge_scene': case 'line_art':
      body = `<rect x="112" y="160" width="800" height="520" rx="${styleId === 'badge_scene' ? 400 : 16}" fill="${paper}" stroke="${ink}" stroke-width="20"/>
        <circle cx="${700 - variant * 30}" cy="300" r="60" fill="${accent}"/>
        <path d="M160 620 L360 ${380 + variant * 20} L470 520 L560 440 L860 620 Z" fill="${ink}"/>
        <text x="512" y="800" text-anchor="middle" ${F} font-size="${fit(text, 860, 84)}" fill="${ink}">${esc(text)}</text>`;
      break;
    case 'trade_tools': case 'diagram': case 'corporate_seal':
      body = `<g stroke="${ink}" stroke-width="44" stroke-linecap="round" transform="rotate(${rot} 512 430)"><line x1="360" y1="280" x2="664" y2="584"/><line x1="664" y1="280" x2="360" y2="584"/></g>
        <circle cx="512" cy="432" r="90" fill="${accent}" stroke="${ink}" stroke-width="24"/>
        <text x="512" y="760" text-anchor="middle" ${F} font-size="${fit(text, 880, 90)}" fill="${ink}">${esc(text)}</text>
        <text x="512" y="840" text-anchor="middle" font-family="Arial" font-weight="700" font-size="40" fill="${ink}" letter-spacing="10">SAN DIEGO, CA</text>`;
      break;
    default: // badge and the rest
      body = `<defs><path id="a${variant}" d="M 132 512 A 380 380 0 0 1 892 512"/><path id="b${variant}" d="M 152 512 A 360 360 0 0 0 872 512"/></defs>
        <circle cx="512" cy="512" r="440" fill="${paper}" stroke="${ink}" stroke-width="30"/><circle cx="512" cy="512" r="300" fill="${accent}"/>
        <path d="M512 380 L548 470 L644 476 L570 536 L596 630 L512 578 L428 630 L454 536 L380 476 L476 470 Z" fill="${ink}" transform="rotate(${rot} 512 512)"/>
        <text ${F} font-size="${fit(text, 1100, 74)}" fill="${ink}" letter-spacing="4"><textPath href="#a${variant}" startOffset="50%" text-anchor="middle">${esc(text)}</textPath></text>
        <text ${F} font-size="52" fill="${ink}" letter-spacing="4"><textPath href="#b${variant}" startOffset="50%" text-anchor="middle">EST. 2026</textPath></text>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">${bg}${body}${label}</svg>`;
  const file = `demo-${tag}-${styleId}-${variant}-${Date.now()}.svg`;
  fs.writeFileSync(path.join(uploadsDir, file), svg);
  return { url: `/uploads/${file}`, source: 'demo', prompt };
}

module.exports = { generateStyleImage, refineImage, setUploadsDir, enabled: !!RECRAFT_API_KEY };

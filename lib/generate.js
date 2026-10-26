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
      image_url: baseAbsUrl, prompt, strength: [0.75, 0.85, 0.7, 0.8, 0.9][i % 5], model: RECRAFT_MODEL, style: RECRAFT_STYLE, n: 1, response_format: 'url'
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

// Marks: simple one-color symbols, rotated through so refinements never share a picture
const MARKS = {
  star: (c) => `<path d="M512 330 L556 440 L674 448 L582 522 L616 638 L512 572 L408 638 L442 522 L350 448 L468 440 Z" fill="${c}"/>`,
  bolt: (c) => `<path d="M560 300 L420 540 L510 540 L470 740 L620 470 L530 470 Z" fill="${c}"/>`,
  mountains: (c) => `<path d="M300 660 L440 420 L520 540 L580 450 L724 660 Z" fill="${c}"/><circle cx="660" cy="380" r="40" fill="${c}"/>`,
  tools: (c) => `<g stroke="${c}" stroke-width="40" stroke-linecap="round"><line x1="380" y1="360" x2="644" y2="624"/><line x1="644" y1="360" x2="380" y2="624"/></g><circle cx="512" cy="492" r="60" fill="${c}"/>`,
  shield: (c) => `<path d="M512 300 L660 350 L640 560 Q600 660 512 720 Q424 660 384 560 L364 350 Z" fill="none" stroke="${c}" stroke-width="28"/><path d="M460 520 L500 560 L580 460" fill="none" stroke="${c}" stroke-width="28" stroke-linecap="round" stroke-linejoin="round"/>`,
  gear: (c) => `<circle cx="512" cy="500" r="120" fill="none" stroke="${c}" stroke-width="40" stroke-dasharray="40 24"/><circle cx="512" cy="500" r="50" fill="${c}"/>`,
  wave: (c) => `<path d="M320 560 Q400 460 480 560 T640 560 T800 560" fill="none" stroke="${c}" stroke-width="36" stroke-linecap="round"/><circle cx="700" cy="400" r="46" fill="${c}"/>`,
  leaf: (c) => `<path d="M512 320 Q700 400 620 620 Q512 700 404 620 Q324 400 512 320 Z" fill="${c}"/><line x1="512" y1="360" x2="512" y2="660" stroke="#fff" stroke-width="16"/>`,
  house: (c) => `<path d="M352 520 L512 380 L672 520 V700 H352 Z" fill="${c}"/><rect x="480" y="600" width="64" height="100" fill="#fff"/>`,
  cup: (c) => `<path d="M400 380 H620 L600 680 H420 Z" fill="${c}"/><path d="M620 430 H690 V530 H610" fill="none" stroke="${c}" stroke-width="28"/>`
};
const MARK_KEYS = Object.keys(MARKS);

// Characters: five different mascots, not one face in five colors
const CHARACTERS = [
  (ink, acc, paper) => `<circle cx="512" cy="400" r="200" fill="${acc}" stroke="${ink}" stroke-width="18"/><circle cx="450" cy="370" r="28" fill="${ink}"/><circle cx="574" cy="370" r="28" fill="${ink}"/><path d="M420 470 Q512 560 604 470" stroke="${ink}" stroke-width="20" fill="none" stroke-linecap="round"/><path d="M340 300 L512 180 L684 300 Z" fill="${ink}"/>`,
  (ink, acc, paper) => `<ellipse cx="512" cy="430" rx="190" ry="160" fill="${ink}"/><circle cx="380" cy="300" r="60" fill="${ink}"/><circle cx="644" cy="300" r="60" fill="${ink}"/><ellipse cx="512" cy="480" rx="90" ry="70" fill="${paper}"/><circle cx="470" cy="400" r="18" fill="${paper}"/><circle cx="554" cy="400" r="18" fill="${paper}"/><ellipse cx="512" cy="460" rx="26" ry="18" fill="${acc}"/>`,
  (ink, acc, paper) => `<rect x="352" y="280" width="320" height="280" rx="30" fill="${acc}" stroke="${ink}" stroke-width="18"/><rect x="410" y="350" width="70" height="60" rx="8" fill="${ink}"/><rect x="544" y="350" width="70" height="60" rx="8" fill="${ink}"/><rect x="430" y="460" width="164" height="30" rx="8" fill="${ink}"/><line x1="512" y1="200" x2="512" y2="280" stroke="${ink}" stroke-width="18"/><circle cx="512" cy="190" r="22" fill="${ink}"/>`,
  (ink, acc, paper) => `<ellipse cx="512" cy="440" rx="170" ry="190" fill="${acc}" stroke="${ink}" stroke-width="18"/><circle cx="560" cy="380" r="30" fill="${paper}" stroke="${ink}" stroke-width="10"/><circle cx="566" cy="384" r="10" fill="${ink}"/><path d="M640 420 L740 450 L640 480 Z" fill="${ink}"/><path d="M360 520 Q300 600 380 640" stroke="${ink}" stroke-width="18" fill="none"/>`,
  (ink, acc, paper) => `<path d="M512 240 L700 330 L700 520 Q700 640 512 700 Q324 640 324 520 L324 330 Z" fill="${acc}" stroke="${ink}" stroke-width="18"/><rect x="420" y="400" width="184" height="48" rx="10" fill="${ink}"/><path d="M440 530 Q512 600 584 530" stroke="${ink}" stroke-width="18" fill="none" stroke-linecap="round"/><path d="M400 300 L512 220 L624 300" fill="none" stroke="${ink}" stroke-width="18"/>`
];

function demoImage(prompt, styleId, variant, tag) {
  const textMatch = prompt.match(/TEXT \(spell exactly\): ([^\n]*)/);
  const text = (textMatch ? textMatch[1] : 'MERCHYS').replace(/\.$/, '').split('|')[0].trim().toUpperCase() || "MERCHY'S";
  const words = text.split(/\s+/);
  const first = words[0], rest = words.slice(1).join(' ');
  const styleIdx = Object.keys(STYLE_NAMES).indexOf(styleId);
  const [ink, accent, paper] = PALETTES[(styleIdx + variant) % PALETTES.length];
  const F = 'font-family="Arial Black, Impact, Helvetica, sans-serif" font-weight="900"';
  const S = 'font-family="Georgia, Times New Roman, serif" font-weight="700"';
  const name = STYLE_NAMES[styleId] || styleId;
  const sub = variant ? `REFINEMENT ${variant}` : 'CONCEPT';
  const label = `<text x="992" y="1004" text-anchor="end" font-family="Arial, sans-serif" font-size="22" fill="#999">${esc(name)} ${sub} PREVIEW</text>`;
  const bg = `<rect width="1024" height="1024" fill="#fff"/>`;
  const mark = MARKS[MARK_KEYS[(styleIdx * 3 + variant * 2) % MARK_KEYS.length]];
  const typeFace = variant % 2 ? S : F;
  let body;

  if (styleId === 'mascot' || styleId === 'humor') {
    const ch = CHARACTERS[variant % CHARACTERS.length](ink, accent, paper);
    body = `${ch}<rect x="212" y="720" width="600" height="110" rx="12" fill="${ink}"/><text x="512" y="795" text-anchor="middle" ${typeFace} font-size="${fit(text, 560, 64)}" fill="${paper}">${esc(text)}</text>`;
  } else {
    // layouts rotate per variant so refinements differ in structure, not just hue
    const layout = variant === 0 ? ['badge', 'typography', 'scene', 'plaque', 'stacked'][styleIdx % 5] : ['plaque', 'stacked', 'banner', 'badge', 'split'][(variant - 1) % 5];
    const forceType = ['typography', 'monogram', 'streetwear'].includes(styleId) && variant === 0;
    if (forceType) {
      body = `<rect x="92" y="92" width="840" height="840" fill="${paper}" stroke="${ink}" stroke-width="22"/><text x="512" y="430" text-anchor="middle" ${F} font-size="${fit(first, 760, 170)}" fill="${ink}">${esc(first)}</text><rect x="160" y="470" width="704" height="100" fill="${accent}"/><text x="512" y="542" text-anchor="middle" ${F} font-size="${fit(rest || 'EST 2026', 640, 60)}" fill="${ink}">${esc(rest || 'EST. 2026')}</text>`;
    } else if (layout === 'badge') {
      body = `<defs><path id="a${tag}${variant}" d="M 132 512 A 380 380 0 0 1 892 512"/><path id="b${tag}${variant}" d="M 152 512 A 360 360 0 0 0 872 512"/></defs><circle cx="512" cy="512" r="440" fill="${paper}" stroke="${ink}" stroke-width="30"/><circle cx="512" cy="512" r="290" fill="${accent}"/>${mark(ink)}<text ${typeFace} font-size="${fit(text, 1100, 74)}" fill="${ink}" letter-spacing="4"><textPath href="#a${tag}${variant}" startOffset="50%" text-anchor="middle">${esc(text)}</textPath></text><text ${F} font-size="46" fill="${ink}" letter-spacing="4"><textPath href="#b${tag}${variant}" startOffset="50%" text-anchor="middle">EST. 2026</textPath></text>`;
    } else if (layout === 'plaque') {
      body = `<rect x="112" y="200" width="800" height="624" rx="24" fill="${paper}" stroke="${ink}" stroke-width="24"/><rect x="140" y="228" width="744" height="568" rx="14" fill="none" stroke="${ink}" stroke-width="6"/><g transform="translate(0,-110) scale(0.8) translate(128,120)">${mark(accent)}</g><text x="512" y="700" text-anchor="middle" ${typeFace} font-size="${fit(text, 700, 80)}" fill="${ink}">${esc(text)}</text><text x="512" y="760" text-anchor="middle" font-family="Arial" font-weight="700" font-size="30" fill="${ink}" letter-spacing="8">SAN DIEGO, CA</text>`;
    } else if (layout === 'stacked') {
      body = `<g transform="translate(0,-170)">${mark(ink)}</g><text x="512" y="640" text-anchor="middle" ${typeFace} font-size="${fit(first, 860, 130)}" fill="${ink}">${esc(first)}</text><text x="512" y="740" text-anchor="middle" ${F} font-size="${fit(rest || 'EST. 2026', 860, 64)}" fill="${accent}" letter-spacing="4">${esc(rest || 'EST. 2026')}</text><line x1="300" y1="790" x2="724" y2="790" stroke="${ink}" stroke-width="10"/>`;
    } else if (layout === 'banner') {
      body = `<rect x="60" y="380" width="904" height="264" fill="${ink}"/><g transform="translate(-300,-330) scale(0.55) translate(300,300)">${mark(accent)}</g><text x="560" y="490" text-anchor="middle" ${typeFace} font-size="${fit(text, 620, 90)}" fill="${paper}">${esc(text)}</text><text x="560" y="580" text-anchor="middle" font-family="Arial" font-weight="700" font-size="40" fill="${accent}" letter-spacing="8">CUSTOM DONE RIGHT</text>`;
    } else if (layout === 'scene') {
      body = `<rect x="112" y="160" width="800" height="520" rx="16" fill="${paper}" stroke="${ink}" stroke-width="20"/><circle cx="700" cy="300" r="60" fill="${accent}"/><path d="M160 620 L360 400 L470 520 L560 440 L860 620 Z" fill="${ink}"/><text x="512" y="800" text-anchor="middle" ${typeFace} font-size="${fit(text, 860, 84)}" fill="${ink}">${esc(text)}</text>`;
    } else { // split
      body = `<rect x="80" y="160" width="430" height="704" fill="${ink}"/><g transform="translate(-220,0) scale(0.9) translate(60,60)">${mark(paper)}</g><text x="540" y="470" ${typeFace} font-size="${fit(first, 400, 110)}" fill="${ink}">${esc(first)}</text><text x="540" y="570" ${F} font-size="${fit(rest || 'EST 2026', 400, 70)}" fill="${accent}">${esc(rest || 'EST. 2026')}</text><rect x="540" y="600" width="300" height="12" fill="${ink}"/>`;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">${bg}${body}${label}</svg>`;
  const file = `demo-${tag}-${styleId}-${variant}-${Date.now()}.svg`;
  fs.writeFileSync(path.join(uploadsDir, file), svg);
  return { url: `/uploads/${file}`, source: 'demo', prompt };
}

module.exports = { generateStyleImage, refineImage, setUploadsDir, enabled: !!RECRAFT_API_KEY };

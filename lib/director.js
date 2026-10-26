// ================================================================
// Art director: turns the client's answers into questions and prompts.
// Question model: Anthropic (ANTHROPIC_API_KEY) or OpenAI (OPENAI_API_KEY),
// in that order; otherwise the static question bank. Image prompts are
// written from lib/knowledge.js in the structure GPT Image reads best.
// ================================================================
const Q = require('./questions');
const K = require('./knowledge');

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const OPENAI_CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-6-astra';
const DIRECTOR = process.env.DIRECTOR_PROVIDER || (ANTHROPIC_KEY ? 'anthropic' : OPENAI_KEY ? 'openai' : 'bank');

// The interviewer's standing instructions, built from the knowledge base
const SYSTEM = `You are the art director at Merchy's. ${K.COMPANY}

THE OUTCOME WE NEED: ${K.OUTCOME}

THE PROCESS YOU ARE PART OF: ${K.PROCESS}

HOW YOU WORK: You interview clients who usually cannot describe what they want. You steer them toward one tailored, producible design with the fewest sharp questions. Ask only what changes the design. Never ask for name, email, phone, or business name; the shop already has them. Plain English, no jargon, short questions, tappable options whenever possible. When an answer conflicts with production limits, say so in one line and offer the fix. Never use em dashes. Return only JSON, nothing else.

NEVER LET A DESIGN INCLUDE: ${K.NEVER.join('; ')}.`;

async function callModel(userContent, maxTokens = 1400) {
  if (DIRECTOR === 'anthropic') {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: maxTokens, system: SYSTEM, messages: [{ role: 'user', content: userContent }] })
    });
    if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    const data = await resp.json();
    return parseJson((data.content || []).map(c => c.text || '').join(''));
  }
  if (DIRECTOR === 'openai') {
    const resp = await fetch(`${OPENAI_BASE}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OPENAI_CHAT_MODEL, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: userContent }], response_format: { type: 'json_object' } })
    });
    if (!resp.ok) throw new Error(`OpenAI ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    const data = await resp.json();
    return parseJson(data.choices?.[0]?.message?.content || '');
  }
  throw new Error('No director model configured');
}
function parseJson(text) { const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/); return JSON.parse(m ? m[0] : text); }

function sessionSummary(session) {
  const { client = {}, context = {}, brief = {} } = session;
  return `Client business: ${client.business || 'unknown'}. Context: ${context.mode === 'logo' ? 'logo / artwork' : 'product: ' + (context.product || context.service || 'unspecified')}. Decoration: ${context.decoration || 'unspecified'}.
Brief answers so far: ${JSON.stringify(brief.answers || {})}.`;
}

// Stage 1: questions before any image exists. Returns { questions, done, briefSummary }
async function briefQuestions(session) {
  const base = Q.briefQuestions(session.context);
  const answered = session.brief?.answers || {};
  const remaining = base.filter(q => !(q.id in answered));
  if (DIRECTOR === 'bank') {
    return { questions: remaining.slice(0, 3), done: remaining.length === 0, source: 'bank' };
  }
  try {
    const stage = K.STAGES.brief;
    const out = await callModel(`${sessionSummary(session)}
STAGE: brief. GOAL: ${stage.goal} MUST LEARN: ${stage.mustLearn.join('; ')}. GUIDANCE: ${stage.guidance}
Production limits that apply: ${K.contextBlocks({ decoration: session.context?.decoration, product: session.context?.product, productTree: session.productTree }).join(' ') || 'none stated yet'}
Base question bank (adapt, reorder, drop what is already answered or implied, add at most 2 of your own that matter for this product; keep ids from the bank when you reuse a question): ${JSON.stringify(base.map(({ id, q, type, options, multi }) => ({ id, q, type, options, multi })))}
Return JSON: {"questions":[{"id":"snake_case","q":"...","type":"chips|text|chips+text","multi":false,"options":["..."],"why":"one line"}], "done": boolean, "briefSummary": "two sentences describing the design direction so far"}
Question types allowed: chips, text, chips+text, moods (the feel-word tiles, id must be "mood"), colors (brand color picker, id must be "palette"). Return at most 3 questions per turn. Set done=true when every MUST LEARN item is covered or reasonably implied.`);
    return { questions: out.questions || [], done: !!out.done, briefSummary: out.briefSummary, source: 'model' };
  } catch (e) {
    console.error('Director brief fallback:', e.message);
    return { questions: remaining.slice(0, 3), done: remaining.length === 0, source: 'bank', error: e.message };
  }
}

// Stage 2: questions about one generated style image before refining it
async function styleQuestions(session, styleId) {
  const bank = Q.styleQuestions(styleId);
  if (DIRECTOR === 'bank') return { questions: bank, source: 'bank' };
  try {
    const stage = K.STAGES.style; const st = K.STYLES[styleId];
    const out = await callModel(`${sessionSummary(session)}
STAGE: style refinement for "${Q.STYLE_NAMES[styleId] || styleId}". ${st ? 'This style is: ' + st.is + ' Must: ' + st.must + ' Avoid: ' + st.avoid : ''}
GOAL: ${stage.goal} MUST LEARN: ${stage.mustLearn.join('; ')}. GUIDANCE: ${stage.guidance}
The concept prompt that produced the image the client liked: ${JSON.stringify((session.styles || []).find(x => x.id === styleId)?.image?.prompt || '')}
Base questions: ${JSON.stringify(bank)}
Return JSON {"questions":[{"id":"snake_case","q":"...","type":"chips|text|chips+text","multi":false,"options":["..."],"why":"one line"}]} with 3 to 5 questions that will most improve the next five refinements.`);
    return { questions: out.questions || bank, source: 'model' };
  } catch (e) {
    return { questions: bank, source: 'bank', error: e.message };
  }
}

// Build the generation prompt for one style from the brief (and optional refinement answers)
const COLOR_RULES = 'Flat solid colors only, a limited palette of 2 to 5 colors, crisp clean edges, no gradients, no shading, no photographic texture, no tiny detail. Built to be vectorized and printed. White background. Balanced centered composition, text integrated into the structure of the design, every word spelled exactly as given.';

const STYLE_DESCRIPTIONS = {
  badge: 'Classic circular shield or emblem crest. Top arc text crowns the design, bold center icon as focal point, bottom text anchors.',
  icon_logo: 'Single powerful scalable icon or logo mark. One strong symbol. Minimal text. Recognizable at thumbnail size.',
  typography: 'Typography-driven design where bold stacked or arched lettering IS the design. Minimal supporting graphics.',
  mascot: 'Custom illustrated character or mascot as the hero. Bold outlines, simple shapes, expressive but clean.',
  scene: 'Full illustrated scene with foreground, background, and text woven into the composition. Simplified for print.',
  badge_scene: 'Illustrated scene contained inside a circular or shield badge frame with text wrapping the edge.',
  diagram: 'Technical structured layout like a cut chart or labeled blueprint. Main object centered with clean labeled sections.',
  vintage_script: 'Retro travel postcard style. Flowing script headline with a supporting scene or simple icon.',
  streetwear: 'Bold high-contrast modern street graphic. Oversized central element, minimal text.',
  trade_tools: 'Crossed tools or industry symbols as the centerpiece, arranged symmetrically with trade text.',
  corporate_seal: 'Professional polished emblem. Clean geometric icon centered with balanced typography.',
  pattern: 'Repeating icons arranged in a structured grid or scattered all-over pattern. Simple bold elements.',
  monogram: 'Bold oversized initials or numbers as the dominant visual. Thick letterforms, varsity feel.',
  collage: 'Multiple bold elements composed in a controlled layered arrangement with clear boundaries.',
  product_focus: 'Clean illustration of the actual product or item centered as the hero with supporting text.',
  humor: 'Concept-driven funny visual with a clear punchline at a glance. Simple clean illustration.',
  heritage: 'Established legacy feel: founding dates, classic serif typography, simple timeless icon.',
  line_art: 'Controlled continuous line art with intentional negative space and consistent stroke weight.',
  patch_first: 'Designed for an embroidered patch: thick simplified shapes, bold border edge, limited detail, 5 to 6 color areas.',
  event_series: 'Reusable annual layout with a consistent frame and designated zones for year, date, or event text.'
};

// Five distinct directions per refinement round. Each is a different concept, never a recolor.
const GENERIC_VARIATIONS = [
  'Variation 1 of 5: new composition. Rebuild the layout from scratch (stacked, horizontal, or asymmetric), keep the same central subject.',
  'Variation 2 of 5: new central image. Replace the main icon with a different symbol from the same world, keep the layout structure.',
  'Variation 3 of 5: new lettering. Different type style for the main words (condensed, slab, script, or hand lettered) and text arrangement.',
  'Variation 4 of 5: simplified. Half the elements, one dominant shape, maximum readability at 3 inches.',
  'Variation 5 of 5: richer. Add one supporting illustrated element and a frame or banner that ties the text to the picture.'
];
const VARIATION_PLANS = {
  mascot: [
    'Variation 1 of 5: a completely different character: a person who does this work, head and shoulders, with a prop from the trade.',
    'Variation 2 of 5: a completely different character: an animal that fits the brand, full body, in action.',
    'Variation 3 of 5: a completely different character: an everyday object from this industry given a face, arms, and attitude.',
    'Variation 4 of 5: a completely different character: a retro 1950s-style cartoon figure with exaggerated features and a big smile.',
    'Variation 5 of 5: a completely different character: a tough, heroic figure or creature in a dramatic pose with a strong silhouette.'
  ],
  icon_logo: [
    'Variation 1 of 5: a geometric abstract mark built from the initials.',
    'Variation 2 of 5: a pictorial mark: one literal object from the industry, simplified to its silhouette.',
    'Variation 3 of 5: a negative-space mark that hides a second shape inside the first.',
    'Variation 4 of 5: a monoline mark drawn with one continuous stroke.',
    'Variation 5 of 5: a mark inside a simple container shape (circle, hexagon, or shield) with the name beside it.'
  ],
  typography: [
    'Variation 1 of 5: stacked block lettering, three tiers, first word largest.',
    'Variation 2 of 5: arched top line with a straight bottom line and a small ornament between.',
    'Variation 3 of 5: hand-lettered script for the main word, small caps for the rest.',
    'Variation 4 of 5: condensed sans-serif in a tall vertical lockup with rules above and below.',
    'Variation 5 of 5: letters with dimensional drop shadow and an inline detail, 1970s poster feel.'
  ],
  scene: [
    'Variation 1 of 5: dawn landscape, wide horizon, subject small in the foreground.',
    'Variation 2 of 5: close-up action scene, subject fills the frame.',
    'Variation 3 of 5: night scene with a single light source and strong silhouettes.',
    'Variation 4 of 5: scene framed inside a circle with the text wrapping the frame.',
    'Variation 5 of 5: scene with layered depth: foreground object, mid-ground action, background shape.'
  ],
  badge: [
    'Variation 1 of 5: shield-shaped badge with a chevron split and a ribbon banner.',
    'Variation 2 of 5: rectangular plaque badge with corner ornaments and a small icon.',
    'Variation 3 of 5: round seal with a rope or rivet border and a different central icon.',
    'Variation 4 of 5: hexagon badge with text on straight lines, modern feel.',
    'Variation 5 of 5: two-layer badge: a circle behind a horizontal banner that carries the name.'
  ]
};
VARIATION_PLANS.humor = VARIATION_PLANS.mascot;
VARIATION_PLANS.badge_scene = VARIATION_PLANS.scene;
VARIATION_PLANS.corporate_seal = VARIATION_PLANS.badge;
VARIATION_PLANS.patch_first = VARIATION_PLANS.badge;

// Spell a brand name letter by letter so the image model renders it exactly
function spelled(text) {
  return String(text || '').split(/\s*\|\s*/).map(seg => seg.trim()).filter(Boolean)
    .map(seg => `"${seg}" (spelled ${seg.replace(/\s+/g, ' ').split('').map(c => c === ' ' ? 'space' : c.toUpperCase()).join('-')})`).join(', then ');
}
const list = v => [].concat(v).filter(Boolean).join(', ');

// Build the image prompt. Structure follows what GPT Image reads best:
// intended use, subject, key details, text spec, color, constraints, exclusions.
function buildPrompt(session, styleId, refinement) {
  const a = session.brief?.answers || {};
  const client = session.client || {};
  const ctx = session.context || {};
  const styleName = Q.STYLE_NAMES[styleId] || styleId;
  const st = K.STYLES[styleId];
  const isProduct = ctx.mode === 'product' && ctx.product;
  const text = a.exact_text || client.business || '';
  const industry = a.industry || client.industry || '';
  const parts = [];

  parts.push(`INTENDED USE: ${isProduct ? 'artwork for ' + (/^[aeiou]/i.test(ctx.product) ? 'an ' : 'a ') + ctx.product : 'a logo and merchandise graphic'} for ${client.business || 'a business'}${industry ? ' (' + industry + ')' : ''}, produced by Merchy's, a custom print and embroidery shop. This is finished vector-style artwork for production, not a mockup.`);

  parts.push(`STYLE: ${styleName}. ${st ? st.is + ' Must: ' + st.must + ' Avoid: ' + st.avoid : STYLE_DESCRIPTIONS[styleId] || ''}`);

  // subject
  const subj = list(a.subject);
  if (/icon from my industry/i.test(subj)) parts.push(`MAIN IMAGE: the single most recognizable symbol of the ${industry || 'client\'s'} trade${subj.replace(/an icon from my industry[;,]?\s*/i, '').trim() ? ': ' + subj.replace(/an icon from my industry[;,]?\s*/i, '').trim() : ''}. One object, drawn simply, strong silhouette.`);
  else if (/just letters/i.test(subj)) parts.push('MAIN IMAGE: none. The lettering is the design.');
  else if (/surprise/i.test(subj)) parts.push(`MAIN IMAGE: choose one symbol that an owner of a ${industry || 'business like this'} would be proud to wear. One object, strong silhouette.`);
  else if (subj) parts.push(`MAIN IMAGE: ${subj}. One subject, strong silhouette, simple internal detail.`);

  if (a.mood) parts.push(`FEEL: ${list(a.mood)}. Let these words drive the letterforms, line weight, and palette.`);

  // text spec
  if (text) parts.push(`TEXT TO RENDER, verbatim, each exactly once, no extra words: ${spelled(text)}. Integrate the text into the structure of the design (arc, banner, block, or under the mark). Bold, legible lettering sized to be read at 3 inches.`);

  // color
  const brand = list(a.brand_colors);
  const pal = list(a.palette);
  if (brand) parts.push(`COLORS: use this brand palette and nothing else: ${brand}, plus white if needed.`);
  else if (/one color/i.test(pal)) parts.push('COLORS: one ink color on white. Black unless the feel calls for another single color.');
  else if (/two colors/i.test(pal)) parts.push('COLORS: exactly two flat colors on white.');
  else parts.push('COLORS: propose a palette of 3 to 4 flat colors that fit the feel and the trade. Name them in your head before drawing and use only those.');

  if (a.references) parts.push(`REFERENCE POINTS (spirit, not copying): ${a.references}.`);

  // production and product knowledge
  K.contextBlocks({ decoration: ctx.decoration, product: ctx.product, productTree: session.productTree, styleId: null }).forEach(b => parts.push(b));
  Object.entries(a).forEach(([k, v]) => {
    if (!['exact_text', 'industry', 'subject', 'mood', 'palette', 'brand_colors', 'references', 'avoid'].includes(k) && v) parts.push(`${k.replace(/_/g, ' ').toUpperCase()}: ${list(v)}.`);
  });

  // refinement round
  if (refinement) {
    const keep = list(refinement.answers?.keep);
    const change = list(refinement.answers?.change);
    parts.push('EDIT INSTRUCTIONS FOR THIS ROUND:');
    if (keep) parts.push(`Keep: ${keep}. Preserve the overall style, palette family, and the text content.`);
    Object.entries(refinement.answers || {}).forEach(([k, v]) => { if (!['keep', 'change'].includes(k) && v) parts.push(`${k.replace(/_/g, ' ')}: ${list(v)}.`); });
    if (change) parts.push(`Change: ${change}.`);
    if (refinement.notes) parts.push(`Client notes: ${refinement.notes}.`);
    if (refinement.variation !== undefined) parts.push(VARIATION_PLANS[styleId] ? VARIATION_PLANS[styleId][refinement.variation % 5] : GENERIC_VARIATIONS[refinement.variation % 5]);
    parts.push('This must read as a different concept from the other refinements, not a recolor: change the composition, the central image, or the lettering treatment as instructed. Keep everything the client asked to keep.');
  }

  parts.push(`UNIVERSAL RULES: ${K.UNIVERSAL}`);
  const avoid = [a.avoid, session.board?.dislikes].filter(Boolean).join('; ');
  parts.push(`DO NOT INCLUDE: ${K.NEVER.join('; ')}${avoid ? '; ' + avoid : ''}.`);
  return parts.filter(Boolean).join('\n');
}

// Final brief for the design team: approved designs, notes per image, dislikes
function finalBrief(session) {
  const a = session.brief?.answers || {};
  const lines = [];
  lines.push(`Design Studio brief for ${session.client?.business || session.client?.name || 'client'}`);
  lines.push(`Context: ${session.context?.mode === 'logo' || !session.context?.product ? 'Logo / artwork' : 'Product: ' + session.context.product}${session.context?.decoration ? ' | ' + session.context.decoration : ''}`);
  lines.push('');
  lines.push('Brief answers:');
  Object.entries(a).forEach(([k, v]) => lines.push(`- ${k.replace(/_/g, ' ')}: ${[].concat(v).join(', ')}`));
  lines.push('');
  lines.push('Approved designs (reference images with client notes):');
  (session.board?.selections || []).forEach((sel, i) => {
    lines.push(`${i + 1}. ${sel.styleName} ${sel.label}: ${sel.url}`);
    if (sel.checks?.length) lines.push(`   Needs attention: ${sel.checks.join(', ')}`);
    if (sel.notes) lines.push(`   Notes: ${sel.notes}`);
  });
  if (session.board?.dislikes) { lines.push(''); lines.push(`What the client does NOT want: ${session.board.dislikes}`); }
  const skipped = (session.styles || []).filter(s => s.skipped).map(s => s.name);
  if (skipped.length) lines.push(`Styles the client passed on: ${skipped.join(', ')}`);
  if (session.schedule) { lines.push(''); lines.push(`Artist call: ${session.schedule.summary}`); }
  return lines.join('\n');
}

module.exports = { briefQuestions, styleQuestions, buildPrompt, finalBrief, STYLE_DESCRIPTIONS, enabled: DIRECTOR !== 'bank', provider: DIRECTOR };

// ================================================================
// Art director: turns the client's answers into questions and prompts.
// Uses the Anthropic API when ANTHROPIC_API_KEY is set; otherwise falls
// back to the static question bank so the flow still runs.
// ================================================================
const Q = require('./questions');

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';

const SYSTEM = `You are the art director at Merchy's, a custom merchandise and print shop in San Diego. You interview clients who often cannot describe what they want, and you steer them to a tailored, production-ready design. You know print: DTF, screen print, embroidery, patches, banners, drinkware, promo, business printing. Designs must be flat color (no gradients, no photo textures), limited palette, clean edges, easy to vectorize, and readable at the real finished size.
Rules: ask only what changes the design. Never ask for name, email, phone, or business name; the shop already has them. Short questions, plain English, no jargon. Offer tappable options where you can. Never use em dashes. Return only JSON.`;

async function callModel(messages, maxTokens = 1200) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: maxTokens, system: SYSTEM, messages })
  });
  if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  const text = (data.content || []).map(c => c.text || '').join('');
  const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  return JSON.parse(m ? m[0] : text);
}

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
  if (!ANTHROPIC_KEY) {
    return { questions: remaining.slice(0, 3), done: remaining.length === 0, source: 'bank' };
  }
  try {
    const out = await callModel([{ role: 'user', content: `${sessionSummary(session)}
Base question bank (adapt, reorder, drop what is already answered or implied, add at most 2 of your own that matter for this product): ${JSON.stringify(base)}
Return JSON: {"questions":[{"id":"snake_case","q":"...","type":"chips|text|chips+text","multi":false,"options":["..."],"why":"one line"}], "done": boolean, "briefSummary": "two sentences describing the design direction so far"}
Return at most 3 questions per turn. Set done=true when the brief is complete enough to generate.` }]);
    return { questions: out.questions || [], done: !!out.done, briefSummary: out.briefSummary, source: 'model' };
  } catch (e) {
    console.error('Director brief fallback:', e.message);
    return { questions: remaining.slice(0, 3), done: remaining.length === 0, source: 'bank', error: e.message };
  }
}

// Stage 2: questions about one generated style image before refining it
async function styleQuestions(session, styleId) {
  const bank = Q.styleQuestions(styleId);
  if (!ANTHROPIC_KEY) return { questions: bank, source: 'bank' };
  try {
    const out = await callModel([{ role: 'user', content: `${sessionSummary(session)}
The client liked the "${Q.STYLE_NAMES[styleId] || styleId}" concept and we will generate 5 refinements of it. Base questions: ${JSON.stringify(bank)}
Return JSON {"questions":[...same shape...]} with 3 to 5 questions that will most improve the next round.` }]);
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

function buildPrompt(session, styleId, refinement) {
  const a = session.brief?.answers || {};
  const client = session.client || {};
  const ctx = session.context || {};
  const parts = [
    `Design a ${ctx.mode === 'logo' || !ctx.product ? 'logo / merchandise graphic' : 'graphic for a ' + ctx.product} for ${client.business || 'the client'}.`,
    `STYLE: ${STYLE_DESCRIPTIONS[styleId] || styleId}.`,
    a.exact_text ? `TEXT (spell exactly): ${a.exact_text}.` : `TEXT (spell exactly): ${client.business || ''}.`,
    a.industry ? `INDUSTRY: ${a.industry}.` : '',
    a.subject ? `MAIN IMAGE: ${[].concat(a.subject).join('; ')}${/icon from my industry/i.test([].concat(a.subject).join(' ')) ? ' (choose the most recognizable symbol of this industry)' : ''}.` : '',
    a.mood ? `FEEL: ${[].concat(a.mood).join(', ')}.` : '',
    a.palette ? `COLORS: ${[].concat(a.palette).join(', ')}${a.brand_colors ? ' using these brand colors: ' + [].concat(a.brand_colors).join(', ') : ''}.` : (a.brand_colors ? `COLORS: use these brand colors: ${[].concat(a.brand_colors).join(', ')}.` : ''),
    a.references ? `REFERENCE POINTS: ${a.references}.` : '',
    a.avoid ? `DO NOT INCLUDE: ${a.avoid}.` : ''
  ];
  // product tree answers
  Object.entries(a).forEach(([k, v]) => {
    if (!['exact_text', 'industry', 'subject', 'mood', 'palette', 'brand_colors', 'references', 'avoid'].includes(k) && v) parts.push(`${k.replace(/_/g, ' ').toUpperCase()}: ${[].concat(v).join(', ')}.`);
  });
  if (refinement) {
    parts.push('REFINEMENT ROUND. Keep the overall style direction and what the client liked. Apply every change they asked for:');
    Object.entries(refinement.answers || {}).forEach(([k, v]) => v && parts.push(`${k.replace(/_/g, ' ')}: ${[].concat(v).join(', ')}.`));
    if (refinement.notes) parts.push(`CLIENT NOTES: ${refinement.notes}.`);
    if (refinement.variation !== undefined) parts.push(VARIATION_PLANS[styleId] ? VARIATION_PLANS[styleId][refinement.variation % 5] : GENERIC_VARIATIONS[refinement.variation % 5]);
    parts.push('This must be a visibly different concept from the other refinements, not a recolor: change the composition, the central image, and the lettering treatment. Same palette family is fine; same picture is not.');
  }
  parts.push(`PRODUCTION RULES: ${COLOR_RULES}`);
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

module.exports = { briefQuestions, styleQuestions, buildPrompt, finalBrief, STYLE_DESCRIPTIONS, enabled: !!ANTHROPIC_KEY };

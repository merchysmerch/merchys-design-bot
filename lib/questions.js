// ================================================================
// Question bank and product decision trees.
// Used directly when no language model is configured, and handed to
// the art director model as the base it adapts from when one is.
// Every question: { id, q, type: 'chips' | 'text' | 'chips+text', options?, why }
// ================================================================

const STYLE_NAMES = {
  badge: 'Badge / Crest', icon_logo: 'Icon / Logo Mark', typography: 'Typography', mascot: 'Mascot / Character',
  scene: 'Scene / Environment', badge_scene: 'Badge + Scene', diagram: 'Diagram / Technical', vintage_script: 'Vintage Script',
  streetwear: 'Bold Streetwear', trade_tools: 'Trade / Tools', corporate_seal: 'Corporate Seal', pattern: 'Pattern / Repeat',
  monogram: 'Monogram / Number', collage: 'Mashup / Collage', product_focus: 'Product-Focused', humor: 'Humor / Novelty',
  heritage: 'Heritage / Legacy', line_art: 'Minimal Line Art', patch_first: 'Patch / Embroidery', event_series: 'Event Series'
};

// ---- Mood words: each gets a typeset sample so the client sees the word in that treatment ----
// sample: { font, weight, bg, fg, border, transform, spacing, italic }
const MOOD_WORDS = [
  { w: 'Bold', sample: { font: 'Impact, Arial Black, sans-serif', weight: 900, bg: '#111', fg: '#ffd400', transform: 'uppercase' } },
  { w: 'Classic', sample: { font: 'Georgia, Times New Roman, serif', weight: 700, bg: '#f4efe4', fg: '#1b1b1b', border: '2px double #1b1b1b' } },
  { w: 'Clean', sample: { font: 'Helvetica Neue, Arial, sans-serif', weight: 300, bg: '#fff', fg: '#222', spacing: '3px', border: '1px solid #ddd' } },
  { w: 'Rugged', sample: { font: 'Arial Black, Impact, sans-serif', weight: 900, bg: '#4a3b2a', fg: '#e8d8b8', transform: 'uppercase', border: '3px solid #2a2117' } },
  { w: 'Playful', sample: { font: 'Comic Sans MS, Chalkboard, cursive', weight: 700, bg: '#ff6b9d', fg: '#fff', transform: 'none' } },
  { w: 'Premium', sample: { font: 'Didot, Bodoni MT, Georgia, serif', weight: 400, bg: '#0e0e0e', fg: '#d4a017', spacing: '4px', transform: 'uppercase' } },
  { w: 'Vintage', sample: { font: 'Rockwell, Courier New, serif', weight: 700, bg: '#e9dcc1', fg: '#7a1f1f', transform: 'uppercase', border: '2px dashed #7a1f1f' } },
  { w: 'Modern', sample: { font: 'Futura, Century Gothic, sans-serif', weight: 500, bg: '#e8f0fe', fg: '#0b2545', spacing: '2px' } },
  { w: 'Friendly', sample: { font: 'Verdana, Trebuchet MS, sans-serif', weight: 700, bg: '#ffe8a3', fg: '#7a4b00', transform: 'none' } },
  { w: 'Serious', sample: { font: 'Times New Roman, serif', weight: 700, bg: '#1f2a44', fg: '#fff', transform: 'uppercase', spacing: '1px' } },
  { w: 'Retro', sample: { font: 'Cooper Black, Georgia, serif', weight: 900, bg: '#f7a723', fg: '#4a1d0f', transform: 'none' } },
  { w: 'Sporty', sample: { font: 'Impact, Arial Narrow, sans-serif', weight: 900, bg: '#c8102e', fg: '#fff', transform: 'uppercase', italic: true } },
  { w: 'Rustic', sample: { font: 'Courier New, monospace', weight: 700, bg: '#7b5e3b', fg: '#f3e9d2', transform: 'uppercase' } },
  { w: 'Elegant', sample: { font: 'Snell Roundhand, Brush Script MT, cursive', weight: 400, bg: '#fbf7f0', fg: '#333', italic: true } },
  { w: 'Edgy', sample: { font: 'Arial Black, sans-serif', weight: 900, bg: '#000', fg: '#39ff14', transform: 'uppercase', spacing: '-1px' } },
  { w: 'Minimal', sample: { font: 'Helvetica Neue, Arial, sans-serif', weight: 400, bg: '#fff', fg: '#111', spacing: '6px', transform: 'lowercase' } },
  { w: 'Luxury', sample: { font: 'Didot, Georgia, serif', weight: 400, bg: '#1a1a1a', fg: '#e5d3a1', spacing: '5px', transform: 'uppercase' } },
  { w: 'Industrial', sample: { font: 'Arial Narrow, Impact, sans-serif', weight: 900, bg: '#3b3f44', fg: '#f0a500', transform: 'uppercase', border: '3px solid #f0a500' } },
  { w: 'Western', sample: { font: 'Rockwell Extra Bold, Rockwell, serif', weight: 900, bg: '#c7a16b', fg: '#3b1f0f', transform: 'uppercase' } },
  { w: 'Coastal', sample: { font: 'Trebuchet MS, sans-serif', weight: 700, bg: '#8fcbd6', fg: '#0b3954', transform: 'uppercase', spacing: '2px' } },
  { w: 'Tactical', sample: { font: 'Arial Narrow, Impact, sans-serif', weight: 900, bg: '#2f3b2f', fg: '#c9c6a6', transform: 'uppercase', spacing: '2px' } },
  { w: 'Handmade', sample: { font: 'Marker Felt, Chalkboard, cursive', weight: 400, bg: '#fff8e7', fg: '#2b2b2b', transform: 'none' } },
  { w: 'Corporate', sample: { font: 'Arial, Helvetica, sans-serif', weight: 700, bg: '#fff', fg: '#0a3d91', border: '1px solid #0a3d91' } },
  { w: 'Techy', sample: { font: 'Menlo, Consolas, monospace', weight: 700, bg: '#0a0f1e', fg: '#4fd1ff', transform: 'uppercase' } },
  { w: 'Grunge', sample: { font: 'Impact, sans-serif', weight: 900, bg: '#2b2b2b', fg: '#d9d9d9', transform: 'uppercase', italic: true, spacing: '-1px' } },
  { w: 'Feminine', sample: { font: 'Brush Script MT, cursive', weight: 400, bg: '#fde2ea', fg: '#8a2846', italic: true } },
  { w: 'Masculine', sample: { font: 'Arial Black, sans-serif', weight: 900, bg: '#1b1b1b', fg: '#b0b0b0', transform: 'uppercase' } },
  { w: 'Fun', sample: { font: 'Chalkboard, Comic Sans MS, cursive', weight: 700, bg: '#5ad2f4', fg: '#1b1b1b' } },
  { w: 'Patriotic', sample: { font: 'Impact, sans-serif', weight: 900, bg: '#0a2a66', fg: '#fff', border: '3px solid #c8102e', transform: 'uppercase' } },
  { w: 'Faith-based', sample: { font: 'Georgia, serif', weight: 400, bg: '#f6f1e7', fg: '#5a4632', italic: true } },
  { w: 'Family', sample: { font: 'Verdana, sans-serif', weight: 700, bg: '#fff3d6', fg: '#b34700' } },
  { w: 'Outdoorsy', sample: { font: 'Rockwell, serif', weight: 700, bg: '#2f5d3a', fg: '#f3e9d2', transform: 'uppercase' } },
  { w: 'Street', sample: { font: 'Arial Black, sans-serif', weight: 900, bg: '#111', fg: '#fff', transform: 'uppercase', spacing: '-1px' } },
  { w: 'Collegiate', sample: { font: 'Rockwell Extra Bold, Rockwell, serif', weight: 900, bg: '#7a0019', fg: '#f4c542', transform: 'uppercase' } },
  { w: 'Nautical', sample: { font: 'Georgia, serif', weight: 700, bg: '#f7f7f7', fg: '#0a2a66', border: '2px solid #c8102e', transform: 'uppercase' } },
  { w: 'Medical', sample: { font: 'Arial, sans-serif', weight: 500, bg: '#eaf7f2', fg: '#1a7a5a' } },
  { w: 'Kids', sample: { font: 'Comic Sans MS, cursive', weight: 700, bg: '#ffe066', fg: '#e04e1b' } },
  { w: 'Spooky', sample: { font: 'Chiller, Papyrus, fantasy', weight: 700, bg: '#1c0b2e', fg: '#ff7a00' } },
  { w: 'Holiday', sample: { font: 'Georgia, serif', weight: 700, bg: '#0f5132', fg: '#f2d3a2', italic: true } },
  { w: 'Military', sample: { font: 'Impact, sans-serif', weight: 900, bg: '#4b5320', fg: '#e6e2c3', transform: 'uppercase', spacing: '2px' } }
];

// ---- Stage 1: the brief (before any image exists) ----
// prefill: which client/context field to seed the answer with
const BRIEF_LOGO = [
  { id: 'exact_text', q: 'What text has to appear in the design? We started with your business name. Edit it, add a tagline, year, or location, and spell everything exactly.', type: 'text', prefill: 'business', why: 'Spelling and wording go straight into the artwork.' },
  { id: 'industry', q: 'What is your industry or trade?', type: 'text', prefill: 'industry', why: 'Lets the director pull the right symbols and avoid the wrong ones.' },
  { id: 'subject', q: 'If the design had one picture in it, what would it be?', type: 'chips+text', options: ['An icon from my industry', 'An object from our work', 'An animal', 'A person or character', 'A place or landmark', 'Just letters, no picture', 'Not sure, surprise me'], why: 'Anchors the focal point. Add detail in the box if you have it.' },
  { id: 'mood', q: 'Pick every word that fits how it should feel.', type: 'moods', multi: true, options: MOOD_WORDS.map(m => m.w), why: 'Sets weight, type, and detail level.' },
  { id: 'palette', q: 'Colors', type: 'colors', options: ['Use my brand colors', 'Propose a palette', 'One color', 'Two colors'], why: 'Flat, limited palettes vectorize and print cleanly. Pick your brand colors below if you have them.' },
  { id: 'avoid', q: 'Anything you do NOT want to see? Colors, symbols, styles, cliches.', type: 'text', why: 'Keeps the design team away from dead ends.' },
  { id: 'references', q: 'Any brands or logos you admire for this? Names are enough.', type: 'text', why: 'Reference points sharpen the direction.' }
];

// ---- Product trees: asked in addition to the logo brief when the context is a product ----
const PRODUCT_TREES = {
  apparel: {
    label: 'Apparel',
    match: ['tee', 't-shirt', 'shirt', 'hoodie', 'sweatshirt', 'polo', 'jacket', 'hat', 'cap', 'beanie', 'apparel', 'uniform', 'jersey'],
    questions: [
      { id: 'garment', q: 'What garment and color is this going on?', type: 'text', why: 'Garment color decides the ink palette.' },
      { id: 'placement', q: 'Where does the design sit?', type: 'chips', multi: true, options: ['Full front', 'Chest logo', 'Pocket logo', 'Full back', 'Upper back', 'Sleeve', 'Hat front', 'Hat side'], why: 'Placement sets size and proportion.' },
      { id: 'decoration', q: 'How is it being decorated?', type: 'chips', options: ['DTF (full color)', 'Screen print', 'Embroidery', 'Not sure'], why: 'Embroidery needs fewer colors and thicker shapes.' },
      { id: 'size', q: 'Rough print size?', type: 'chips', options: ['Small (3-4 in)', 'Standard (10-12 in)', 'Oversized (14 in+)', 'Let the artist decide'], why: 'Detail has to survive the size.' }
    ]
  },
  banner: {
    label: 'Banner / Sign',
    match: ['banner', 'sign', 'yard', 'retractable', 'a-frame', 'window', 'wall', 'wrap', 'acrylic', 'poster', 'backdrop', 'flag'],
    questions: [
      { id: 'dimensions', q: 'Finished size and orientation? (e.g. 6 ft x 3 ft, landscape)', type: 'text', why: 'Layout is built to the real proportions.' },
      { id: 'distance', q: 'How far away will people read it from?', type: 'chips', options: ['Arm\'s length', 'Across a room', 'Across a street', 'From a moving car'], why: 'Sets minimum text size and contrast.' },
      { id: 'content', q: 'List everything that must be on it: headline, dates, phone, website, QR, sponsor logos.', type: 'text', why: 'Nothing gets added later without a reprint.' },
      { id: 'hierarchy', q: 'What is the ONE thing they should read first?', type: 'text', why: 'Drives the visual hierarchy.' },
      { id: 'environment', q: 'Where does it hang?', type: 'chips', options: ['Indoor', 'Outdoor', 'Trade show', 'Storefront', 'Vehicle'], why: 'Material and finish follow from this.' },
      { id: 'photos', q: 'Will it include photos, or artwork only?', type: 'chips', options: ['Photos (I will supply)', 'Artwork only', 'Both'], why: 'Photo layouts and vector layouts are built differently.' }
    ]
  },
  drinkware: {
    label: 'Drinkware',
    match: ['mug', 'cup', 'tumbler', 'bottle', 'koozie', 'drinkware', 'glass', 'travel mug'],
    questions: [
      { id: 'item', q: 'Which item and color? (e.g. 20 oz black tumbler, white ceramic mug)', type: 'text', why: 'Item color is the background of the design.' },
      { id: 'wrap', q: 'One-sided logo, two-sided, or a full wrap?', type: 'chips', options: ['One side', 'Both sides', 'Full wrap'], why: 'Wrap designs need a continuous layout.' },
      { id: 'method', q: 'Decoration method?', type: 'chips', options: ['Laser engraving (one tone)', 'UV print (full color)', 'Sublimation (full color)', 'Not sure'], why: 'Engraving is single tone; print can be full color.' },
      { id: 'imprint', q: 'Imprint size, if known.', type: 'text', why: 'Most drinkware imprint areas are 2-3 in wide.' }
    ]
  },
  promo: {
    label: 'Promo Item',
    match: ['pen', 'keychain', 'lanyard', 'magnet', 'pin', 'usb', 'tote', 'bag', 'promo', 'notebook', 'calendar', 'umbrella', 'towel', 'cooler'],
    questions: [
      { id: 'item', q: 'Which item and color?', type: 'text', why: 'Imprint area and color options depend on the item.' },
      { id: 'imprint', q: 'Imprint area is usually small. What is the one element that must fit? Logo only, or logo plus text?', type: 'chips', options: ['Logo only', 'Logo + website', 'Logo + phone', 'Text only'], why: 'Small imprints need the simplest version.' },
      { id: 'colors', q: 'Most promo imprints are 1 color. Is a one-color version acceptable?', type: 'chips', options: ['Yes, one color is fine', 'Need full color'], why: 'Determines which processes qualify.' }
    ]
  },
  stickers: {
    label: 'Stickers / Labels',
    match: ['sticker', 'label', 'decal'],
    questions: [
      { id: 'shape', q: 'Shape?', type: 'chips', options: ['Circle', 'Square', 'Rectangle', 'Die cut to the artwork', 'Oval'], why: 'Die cuts need a clean outline.' },
      { id: 'size', q: 'Size in inches?', type: 'text', why: 'Small stickers drop fine detail.' },
      { id: 'surface', q: 'Where will it be stuck?', type: 'chips', options: ['Laptops / water bottles', 'Product packaging', 'Windows', 'Vehicles', 'Outdoors'], why: 'Material and finish follow from this.' },
      { id: 'finish', q: 'Finish?', type: 'chips', options: ['Glossy', 'Matte', 'Holographic', 'Clear'], why: 'Affects how colors read.' }
    ]
  },
  patches: {
    label: 'Patches',
    match: ['patch', 'chenille', 'pvc', 'woven'],
    questions: [
      { id: 'type', q: 'Patch type?', type: 'chips', options: ['Embroidered', 'Woven', 'PVC', 'Chenille', 'Not sure'], why: 'Each has different detail limits.' },
      { id: 'size_shape', q: 'Size and shape? (e.g. 3 in circle, 4x2 in rectangle)', type: 'text', why: 'Embroidery needs thick shapes at small sizes.' },
      { id: 'border', q: 'Border?', type: 'chips', options: ['Merrowed (classic stitched edge)', 'Laser cut', 'Let the artist decide'], why: 'Border eats about 1/8 in of the design.' },
      { id: 'thread_colors', q: 'Max thread colors you are OK with (fewer is cheaper and cleaner)?', type: 'chips', options: ['1-2', '3-4', '5-6', 'Whatever it needs'], why: 'Sets the palette ceiling.' },
      { id: 'backing', q: 'Attachment?', type: 'chips', options: ['Sew on', 'Iron on', 'Velcro / hook and loop', 'Adhesive'], why: 'Noted for production.' }
    ]
  },
  print: {
    label: 'Business Printing',
    match: ['business card', 'flyer', 'brochure', 'postcard', 'menu', 'booklet', 'letterhead', 'door hanger', 'card', 'print', 'ncr'],
    questions: [
      { id: 'piece', q: 'Which piece and size? (e.g. standard business card, 8.5x11 flyer, trifold)', type: 'text', why: 'Layout is built to the trim size.' },
      { id: 'sides', q: 'One or two sided?', type: 'chips', options: ['One side', 'Two sides'], why: 'Doubles the content plan.' },
      { id: 'content', q: 'All copy that must appear: names, titles, phone, email, address, social, website, QR.', type: 'text', why: 'Every line gets proofed.' },
      { id: 'tone', q: 'Should it feel more corporate or more creative?', type: 'chips', options: ['Corporate', 'Creative', 'Somewhere between'], why: 'Guides type and layout.' }
    ]
  },
  packaging: {
    label: 'Packaging',
    match: ['box', 'mailer', 'packaging', 'bag', 'tissue', 'tape', 'pouch'],
    questions: [
      { id: 'item', q: 'Which packaging item and dimensions?', type: 'text', why: 'Dielines come from the item.' },
      { id: 'panels', q: 'Which panels get printed?', type: 'chips', multi: true, options: ['Top / lid', 'All outside panels', 'Inside', 'One logo spot'], why: 'Sets how much artwork is needed.' },
      { id: 'colors', q: 'Number of print colors you expect?', type: 'chips', options: ['1', '2', 'Full color'], why: 'Flexo and digital differ in cost.' }
    ]
  }
};

function detectProductTree(context) {
  const hay = `${context?.product || ''} ${context?.service || ''} ${context?.category || ''}`.toLowerCase();
  if (!hay.trim() || context?.mode === 'logo') return null;
  for (const [key, tree] of Object.entries(PRODUCT_TREES)) {
    if (tree.match.some(m => hay.includes(m))) return { key, ...tree };
  }
  return null;
}

// Stage 1 questions for a session
function briefQuestions(context) {
  const tree = detectProductTree(context);
  return tree ? [...tree.questions, ...BRIEF_LOGO] : BRIEF_LOGO;
}

// ---- Stage 2: per selected style, before refinement ----
const STYLE_QUESTIONS = {
  badge: [{ id: 'badge_shape', q: 'Keep it round, or try a shield or rectangle?', type: 'chips', options: ['Round', 'Shield', 'Rectangle / plaque', 'Mix it up'] }, { id: 'badge_text', q: 'Should the text wrap the edge, sit inside, or both?', type: 'chips', options: ['Wrap the edge', 'Inside the badge', 'Both'] }],
  typography: [{ id: 'type_feel', q: 'Lettering direction?', type: 'chips', options: ['Block / varsity', 'Condensed sans', 'Serif', 'Script', 'Hand drawn'] }, { id: 'type_arrange', q: 'Stacked, arched, or one line?', type: 'chips', options: ['Stacked', 'Arched', 'One line', 'Try all'] }],
  mascot: [{ id: 'mascot_who', q: 'Describe the character: species or person, expression, pose.', type: 'text' }, { id: 'mascot_detail', q: 'Cartoon simple or more illustrated?', type: 'chips', options: ['Simple cartoon', 'Detailed illustration'] }],
  scene: [{ id: 'scene_what', q: 'What is happening in the scene, and what time of day?', type: 'text' }, { id: 'scene_frame', q: 'Open scene or framed in a shape?', type: 'chips', options: ['Open', 'Framed circle', 'Framed rectangle'] }],
  icon_logo: [{ id: 'icon_meaning', q: 'What should the symbol stand for?', type: 'text' }, { id: 'icon_text', q: 'Symbol alone, or symbol with the name beside it?', type: 'chips', options: ['Symbol alone', 'Symbol + name'] }],
  vintage_script: [{ id: 'script_era', q: 'Which era?', type: 'chips', options: ['1920s-30s', '1950s diner', '1970s', 'Western'] }],
  streetwear: [{ id: 'street_energy', q: 'How loud?', type: 'chips', options: ['Clean and bold', 'Distressed', 'Graffiti-leaning'] }],
  patch_first: [{ id: 'patch_colors', q: 'How many thread colors are you OK with?', type: 'chips', options: ['2', '4', '6+'] }],
  heritage: [{ id: 'heritage_year', q: 'Founding year or date to feature?', type: 'text' }],
  event_series: [{ id: 'event_swap', q: 'What changes each year? (year, date, location, theme)', type: 'text' }]
};

const STYLE_GENERIC = [
  { id: 'keep', q: 'What do you like most about this one?', type: 'chips+text', options: ['The layout', 'The lettering', 'The icon', 'The colors', 'The overall vibe'] },
  { id: 'change', q: 'What should change in the next 5?', type: 'chips+text', multi: true, options: ['Simpler', 'More detail', 'Bigger text', 'Different icon', 'Different colors', 'Different proportions', 'Nothing major'] }
];

function styleQuestions(styleId) {
  return [...(STYLE_QUESTIONS[styleId] || []), ...STYLE_GENERIC];
}

// ---- Stage 3: final vetting per selected image (notes for the design team) ----
const FINAL_CHECKLIST = ['Colors', 'Size', 'Shape', 'Spacing', 'Font', 'Spelling', 'Remove something', 'Add something'];

module.exports = { STYLE_NAMES, MOOD_WORDS, BRIEF_LOGO, PRODUCT_TREES, detectProductTree, briefQuestions, styleQuestions, FINAL_CHECKLIST };

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

// ---- Stage 1: the brief (before any image exists) ----
const BRIEF_LOGO = [
  { id: 'exact_text', q: 'What text has to appear in the design? Type it exactly as it should be spelled.', type: 'text', why: 'Spelling and wording go straight into the artwork.' },
  { id: 'subject', q: 'If the design had one picture in it, what would it be?', type: 'chips+text', options: ['An object from our work', 'An animal', 'A person or character', 'A place or landmark', 'Just letters, no picture', 'Not sure, surprise me'], why: 'Anchors the focal point.' },
  { id: 'mood', q: 'Pick the words that fit how it should feel.', type: 'chips', multi: true, options: ['Bold', 'Classic', 'Clean', 'Rugged', 'Playful', 'Premium', 'Vintage', 'Modern', 'Friendly', 'Serious'], why: 'Sets weight, type and detail level.' },
  { id: 'palette', q: 'Colors: do you have brand colors, or should we propose a palette?', type: 'chips+text', options: ['Use my brand colors (type them)', 'Propose a palette', 'Keep it one color', 'Two colors max'], why: 'Flat, limited palettes vectorize and print cleanly.' },
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

module.exports = { STYLE_NAMES, BRIEF_LOGO, PRODUCT_TREES, detectProductTree, briefQuestions, styleQuestions, FINAL_CHECKLIST };

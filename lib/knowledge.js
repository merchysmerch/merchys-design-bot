// ================================================================
// MERCHY'S DESIGN KNOWLEDGE BASE
// Everything the models need to know about the company, the process,
// the production limits, and what a finished, sellable design is.
// Used by lib/director.js to build the interviewer's instructions and
// every image prompt. Plain English, kept factual, edit freely.
// ================================================================

const COMPANY = `Merchy's is a custom merchandise and print shop in San Diego, CA ("Custom Done Right"). We produce apparel decoration (DTF, screen print, embroidery, DTG, heat transfer, sublimation), patches (embroidered, woven, PVC, chenille), signs and banners, drinkware, promo products, stickers and labels, packaging, business printing, and design services. Every design we make has to be printed, stitched, engraved, or cut by our shop. Art that cannot be produced is worthless to us, no matter how it looks on screen.`;

const OUTCOME = `The outcome of the Design Studio is a set of reference designs the client loves and our artist can finish fast. "Finished art" at Merchy's means: a single clear idea, one recognizable focal point, text that is spelled exactly right and built into the structure of the design, a limited flat palette, clean closed shapes with consistent stroke weight, generous padding, nothing floating, nothing fuzzy, no tiny detail that disappears when the design is printed at 3 inches or stitched in thread. It should look like something people would pay to wear.`;

const PROCESS = `The process: (1) the website hands us the client and the product; (2) the art director interviews the client in short rounds to lock the brief; (3) the client picks any number of visual styles; (4) we generate one concept per style; (5) for each concept the client likes, we ask what to keep and change and generate five distinct refinements; (6) the client builds a review board, selects favorites, writes notes per image and tells us what to avoid; (7) they book a call with the artist; (8) the artist receives only the approved images, the brief, the notes and the dislikes, and takes the design to a production file.`;

// ---- Production rules by decoration method ----
const DECORATION = {
  dtf: { match: ['dtf', 'transfer'], rules: 'DTF full-color transfer: unlimited colors, but keep the palette to 2 to 6 flat colors for a clean look. No gradients or soft fades (they band). Minimum line weight about 1.5 pt. No large solid blocks of ink over 10 inches (stiff). Transparent-looking areas must be true knockouts. Design reads on both light and dark garments or state the garment color.' },
  screen: { match: ['screen', 'silk'], rules: 'Screen print: every color is a separate screen, so 1 to 4 flat spot colors. No gradients, no photo, no halftone unless asked. Minimum line weight 1 pt, minimum text height 0.25 in. Colors must not touch in ways that need tight registration. Think in layers of ink on fabric.' },
  embroidery: { match: ['embroid', 'emb', 'stitch', 'polo', 'hat', 'cap', 'beanie'], rules: 'Embroidery: thread, not ink. Maximum 6 to 8 thread colors. No gradients, no shading, no photo. Minimum text height 0.25 in and letters at least 0.05 in wide. Shapes must be solid and chunky; thin lines become satin stitch at least 1 mm wide. No tiny detail, no fine serifs, no small negative space. Hat fronts are about 2.25 in tall by 4 in wide; left chest is about 3.5 to 4 in wide. Fewer elements is better.' },
  patch: { match: ['patch', 'woven', 'pvc', 'chenille'], rules: 'Patches: a thick outer border (merrowed edge) takes about 1/8 in. Inside, 4 to 6 solid color areas, bold shapes, text at least 0.25 in tall. Woven patches allow finer detail than embroidered. PVC needs 2 to 4 flat colors and raised shapes with clean separations. Chenille is for big letters and simple shapes only.' },
  dtg: { match: ['dtg', 'direct to garment'], rules: 'DTG: full color on cotton, photo and gradients allowed, but underbase makes white areas heavy. Prefer artwork that uses the shirt color as a color.' },
  sublimation: { match: ['sublim'], rules: 'Sublimation: full color edge to edge on white polyester or coated items. Gradients fine. Pure white areas print as the material color. No white ink.' },
  engraving: { match: ['engrav', 'laser', 'etch'], rules: 'Laser engraving: one tone only (mark or no mark). Design must work as a single-color stencil with clean closed shapes. No gradients, no color, no fine hatching. Minimum line weight 0.5 pt.' },
  uv: { match: ['uv'], rules: 'UV print: full color on hard goods, flat colors print sharpest, white ink available for dark surfaces.' },
  largeformat: { match: ['banner', 'sign', 'large format', 'vinyl', 'poster', 'wrap', 'window'], rules: 'Large format: viewing distance decides everything. Text must be readable at the stated distance (roughly 1 in of letter height per 10 ft). Strong contrast, one headline, minimal body text, high resolution or vector art. Outdoor pieces get wind slits and grommets so keep critical content away from edges.' },
  print: { match: ['business card', 'flyer', 'brochure', 'postcard', 'menu', 'print', 'booklet', 'letterhead', 'door hanger', 'ncr'], rules: 'Business printing: CMYK, 0.125 in bleed, safe margin 0.125 in inside trim, body text at least 8 pt, rich black for large solids, no thin reversed text.' },
  stickers: { match: ['sticker', 'label', 'decal'], rules: 'Stickers and labels: die cut needs a clean outer silhouette with a 1/16 in border. Minimum text height 8 pt. Avoid thin interior cuts. Flat colors print best on vinyl.' },
  drinkware: { match: ['mug', 'cup', 'tumbler', 'bottle', 'koozie', 'drinkware'], rules: 'Drinkware: imprint area is usually 2 to 3 in wide. Design must survive being wrapped on a curve, so avoid wide horizontal lockups unless it is a full wrap. Engraved drinkware is one tone.' },
  promo: { match: ['pen', 'keychain', 'lanyard', 'magnet', 'pin', 'tote', 'bag', 'promo', 'notebook'], rules: 'Promo items: tiny imprint areas, often 1 color. Provide the simplest version of the mark: a bold icon or wordmark with no fine detail.' }
};

function decorationRules(text) {
  const hay = String(text || '').toLowerCase();
  const hits = Object.values(DECORATION).filter(d => d.match.some(m => hay.includes(m)));
  return hits.map(h => h.rules);
}

// ---- Product knowledge (keys match lib/questions.js PRODUCT_TREES) ----
const PRODUCTS = {
  apparel: 'Apparel graphic. Standard placements: full front 10 to 12 in wide, left chest 3.5 to 4 in, full back 12 to 14 in, sleeve 2.5 to 3 in, hat front 2.25 x 4 in. The garment color is part of the design.',
  banner: 'Banner or sign. One dominant headline, supporting line, contact or call to action. Hierarchy by size. Keep edges clear. Horizontal banners read left to right in one sweep.',
  drinkware: 'Drinkware graphic. Compact vertical or square lockup that fits a 2 to 3 in imprint, or a full wrap panel.',
  promo: 'Promo imprint. One bold mark, no fine detail, one color unless the method allows more.',
  stickers: 'Sticker or label. Strong outer silhouette for die cutting, bold shapes, readable at 2 to 3 in.',
  patches: 'Patch. Bold shapes inside a border, 4 to 6 colors, text at least 0.25 in tall.',
  print: 'Printed piece. Clear hierarchy: name, title, contact, website. Brand mark plus type. Print safe margins.',
  packaging: 'Packaging. Logo lockup for the main panel plus a simplified mark for small panels and tape.'
};

// ---- Style guide: what each style must be, and the traps ----
const STYLES = {
  badge: { is: 'Classic circular or shield emblem. Top arc text, bold center icon, bottom arc or banner text. Rings, rope or dot borders are allowed.', must: 'Icon reads from 20 ft. Text follows the curve cleanly. Even spacing all around.', avoid: 'More than 3 rings, tiny inner text, icon smaller than a third of the badge.' },
  icon_logo: { is: 'One powerful symbol that works alone at thumbnail size. Little or no text.', must: 'Single silhouette, symmetrical or deliberately balanced, built from a few shapes.', avoid: 'Multiple objects, thin strokes, text inside the icon.' },
  typography: { is: 'The lettering IS the design. Stacked, arched or interlocked words with weight and rhythm.', must: 'Clear hierarchy, consistent letterforms, text built into a shape (arc, block, banner).', avoid: 'More than two typefaces, floating words, effects that hide the letters.' },
  mascot: { is: 'An original illustrated character as the hero: a person who does the work, an animal, or an object with a face. Expressive pose, bold outlines, simple shapes.', must: 'One character, strong silhouette, 3 to 5 colors, name on a banner or under the figure.', avoid: 'Generic smiley faces, copyrighted characters, fine shading, more than one character.' },
  scene: { is: 'A simplified illustrated scene: foreground subject, mid-ground action, background shape, text woven in.', must: 'Three depth layers at most, flat color per layer, strong contrast between layers.', avoid: 'Photo realism, tiny background detail, gradients for sky.' },
  badge_scene: { is: 'A scene contained inside a circle or shield, text wrapping the frame.', must: 'Scene simplified to 3 layers, frame carries the text.', avoid: 'Scene too busy for the frame, text over the scene.' },
  diagram: { is: 'Technical layout: a cut chart, blueprint, labeled anatomy, or exploded view of the product.', must: 'One central object, clean segment lines, small clean labels, a title line.', avoid: 'Hand-drawn wobble, too many labels, labels smaller than 0.25 in at print size.' },
  vintage_script: { is: 'Retro postcard or 1950s sign style. Flowing script headline with a simple supporting icon.', must: 'Script is readable, one supporting element, warm limited palette.', avoid: 'Modern sans-serif, more than one script, distressed texture.' },
  streetwear: { is: 'Bold modern street graphic. Oversized central element, high contrast, minimal text.', must: 'One huge shape or word, 2 to 3 colors, aggressive weight.', avoid: 'Small elements, pastel palettes, busy backgrounds.' },
  trade_tools: { is: 'Crossed tools or industry symbols as the centerpiece, trade text above and below.', must: 'Tools are specific to the client\'s trade, drawn simply, symmetrical.', avoid: 'Generic wrench and hammer when the trade uses other tools, more than two crossed objects.' },
  corporate_seal: { is: 'Polished professional emblem. Geometric icon centered, balanced serif or sans text.', must: 'Trustworthy, restrained, 2 to 3 colors, perfect symmetry.', avoid: 'Cartoon elements, script, texture.' },
  pattern: { is: 'Repeating icons arranged in a grid or scattered all-over pattern.', must: 'Each element simple and bold, consistent spacing, 2 to 4 colors.', avoid: 'Elements that touch, text inside the pattern.' },
  monogram: { is: 'Oversized initials or numbers as the dominant visual. Varsity or luxury feel.', must: 'Thick letterforms, interlocked or stacked, one small supporting line.', avoid: 'Thin fonts, more than three letters, ornament that hides the letters.' },
  collage: { is: 'Several bold elements composed in a controlled layered arrangement.', must: 'Clear boundaries between elements, one dominant element, unified palette.', avoid: 'Chaos, overlapping text, more than five elements.' },
  product_focus: { is: 'Clean illustration of the actual product as the hero with supporting text.', must: 'Product is recognizable in silhouette, bold outline, simple internal detail.', avoid: 'Photo realism, reflections, tiny parts.' },
  humor: { is: 'Concept-driven funny visual with a punchline you get at a glance.', must: 'One joke, one image, bold simple drawing, text sells the joke.', avoid: 'Jokes that need explaining, more than one gag, generic emoji faces.' },
  heritage: { is: 'Established legacy feel: founding date, classic serif, simple timeless icon, rules and ornaments.', must: 'Looks decades old, restrained palette, perfect alignment.', avoid: 'Trendy type, bright neon, more than one ornament style.' },
  line_art: { is: 'Continuous or single-weight line drawing with intentional negative space.', must: 'Consistent medium stroke, closed shapes where needed for print, one color plus optional accent.', avoid: 'Hairlines, crosshatching, fills that fight the line.' },
  patch_first: { is: 'Designed for an embroidered patch: thick simplified shapes, bold border, 4 to 6 color areas.', must: 'Border shape is part of the design, text at least 0.25 in, no fine detail.', avoid: 'Gradients, thin lines, small text.' },
  event_series: { is: 'Reusable annual layout: consistent frame with swap zones for year, date, location or theme.', must: 'Frame is the brand, swap zones are obvious, works with any year.', avoid: 'Art that only works for one date, cluttered frame.' }
};

// ---- Universal design rules (every prompt gets these) ----
const UNIVERSAL = `Flat solid colors only, 2 to 5 colors from one palette. Crisp closed shapes, consistent stroke weight, no gradients, no shading, no photographic texture, no drop shadows, no 3D, no noise. One clear focal point, balanced composition, generous padding, nothing touching the edge. Text is spelled exactly as given, appears once, and is built into the structure of the design (arc, banner, block, under the mark), never floating. Readable at 3 inches and at 3 feet. Isolated on a plain white background with no mockup, no shirt, no frame, no watermark, no extra words. This is vector-style artwork that will be traced and produced, not a picture of a product.`;

// ---- Stage strategy: what the interviewer must learn at each stage ----
const STAGES = {
  brief: {
    goal: 'Lock the brief before any image exists. The client often cannot describe what they want, so you steer. Fewer, sharper questions.',
    mustLearn: ['Exact text and spelling (we start from the business name)', 'Industry or trade (so the symbol is right)', 'The one picture, if any', 'Feel words', 'Colors: brand colors, propose, one or two colors', 'What to avoid', 'For products: the production facts from the product tree (size, placement, method, viewing distance)'],
    guidance: 'Ask only what changes the design. Never ask for contact details. Offer tappable options. When the client picks "surprise me", propose two concrete directions in the next round and ask which is closer. When answers conflict with production limits (6 colors for embroidery, tiny text on a pen), say so in one line and offer the fix.'
  },
  style: {
    goal: 'The client liked one concept. Learn exactly what to keep and what to change so the five refinements are five real alternatives, not recolors.',
    mustLearn: ['What they like most (layout, lettering, icon, colors, vibe)', 'What must change', 'Style-specific choices (badge shape, character type, lettering direction, scene content)', 'Any new text or element to add or remove'],
    guidance: 'Three to five questions. Reflect the image back: name what is in it. Every answer must map to a visible change in the next round.'
  },
  final: {
    goal: 'Turn selected images into artist instructions. The AI stops here; the artist finishes.',
    mustLearn: ['Per image: colors, size, shape, spacing, font, spelling, remove, add', 'What the client does not want, across all images', 'Which design is primary if several are selected'],
    guidance: 'Short, specific, numbered by image. Dislikes are as valuable as likes.'
  }
};

// ---- Common failure modes the models must avoid ----
const NEVER = [
  'copyrighted characters, team logos, or famous brand marks',
  'generic emoji or smiley faces as a mascot',
  'clip-art look: thin outlines, default fonts, elements floating in space',
  'gradients, soft shadows, 3D bevels, lens flares',
  'misspelled or duplicated text, extra random words, lorem ipsum',
  'mockups: do not draw the shirt, hat, mug, or banner; draw only the artwork',
  'more than one idea in one design',
  'tiny detail that will not print or stitch',
  'photographic realism in a logo'
];

// ---- Prompt assembly helper: pick the knowledge blocks that apply ----
function contextBlocks({ decoration, product, productTree, styleId }) {
  const blocks = [];
  const dec = decorationRules(`${decoration || ''} ${product || ''}`);
  if (dec.length) blocks.push('PRODUCTION LIMITS: ' + dec.join(' '));
  if (productTree && PRODUCTS[productTree]) blocks.push('PRODUCT: ' + PRODUCTS[productTree]);
  const st = STYLES[styleId];
  if (st) blocks.push(`STYLE DEFINITION: ${st.is} MUST: ${st.must} AVOID: ${st.avoid}`);
  return blocks;
}

module.exports = { COMPANY, OUTCOME, PROCESS, DECORATION, decorationRules, PRODUCTS, STYLES, UNIVERSAL, STAGES, NEVER, contextBlocks };

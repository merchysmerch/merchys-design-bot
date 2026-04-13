// ================================================================
// MERCHY'S DESIGN BOT — Backend Server
// Express.js + Recraft AI + Asana Integration
// ================================================================

require('dotenv').config();
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

  let presaleProjectGid = null;
  if (searchResult.data) {
    const presaleProject = searchResult.data.find(p =>
      p.name.toLowerCase().includes('presale') || p.name.toLowerCase().includes('pre-sale')
    );
    if (presaleProject) presaleProjectGid = presaleProject.gid;
  }

  const taskName = `${formData.name} | ${formData.business || 'New Client'} | Design Request - ${formData.serviceType || 'Custom Design'}`;

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

// Build formatted design notes HTML for Asana comment
function buildDesignNotesHTML(formData) {
  const products = (formData.products || []).join(', ');
  const placements = Object.entries(formData.placements || {})
    .map(([prod, locs]) => `${prod}: ${(locs || []).join(', ')}`)
    .join('\n');

  const pins = (formData.pins || [])
    .filter(p => p.note || p.n)
    .map((p, i) => `Pin ${i + 1} (${p.region || p.r}): ${p.note || p.n}`)
    .join('\n');

  const clarifyAnswers = Object.entries(formData.clarifyAnswers || {})
    .map(([q, a]) => `Q: ${q}\nA: ${a}`)
    .join('\n\n');

  return `<body>
<strong>AI DESIGN BOT SUBMISSION</strong>

<strong>Client:</strong> ${formData.name || 'N/A'}
<strong>Business:</strong> ${formData.business || 'N/A'}
<strong>Email:</strong> ${formData.email || 'N/A'}
<strong>Phone:</strong> ${formData.phone || 'N/A'}

<strong>Service:</strong> ${formData.serviceType || 'N/A'}
<strong>Decoration:</strong> ${formData.decoration || 'N/A'}
<strong>Products:</strong> ${products || 'N/A'}
<strong>Style:</strong> ${formData.style || 'N/A'}
<strong>Quantity:</strong> ${formData.qty || 'N/A'}
<strong>Deadline:</strong> ${formData.deadline || 'N/A'}

<strong>Placements:</strong>
${placements || 'N/A'}

<strong>Design Text (Spell-Checked):</strong>
${formData.text || 'N/A'}

<strong>Design Description:</strong>
${formData.desc || 'N/A'}

<strong>Garment Colors:</strong> ${formData.gcol || 'N/A'}
<strong>Design Colors:</strong> ${formData.dcol || 'B&W first'}

<strong>Selected Option:</strong> ${formData.selectedOption || 'N/A'}

${pins ? `<strong>Client Annotation Notes:</strong>\n${pins}` : ''}

${clarifyAnswers ? `<strong>Clarifying Q&A:</strong>\n${clarifyAnswers}` : ''}

<strong>Special Instructions:</strong>
${formData.notes || 'None'}

Submitted via AI Design Bot on ${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PT
</body>`;
}

function buildPlainTextNotes(formData) {
  const products = (formData.products || []).join(', ');
  return `AI DESIGN BOT SUBMISSION

Client: ${formData.name || 'N/A'}
Business: ${formData.business || 'N/A'}
Email: ${formData.email || 'N/A'}
Phone: ${formData.phone || 'N/A'}

Service: ${formData.serviceType || 'N/A'}
Decoration: ${formData.decoration || 'N/A'}
Products: ${products || 'N/A'}
Style: ${formData.style || 'N/A'}
Quantity: ${formData.qty || 'N/A'}
Deadline: ${formData.deadline || 'N/A'}

Design Text: ${formData.text || 'N/A'}
Description: ${formData.desc || 'N/A'}

Special Instructions: ${formData.notes || 'None'}`;
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

  // Each variation targets a different composition approach
  const variations = [
    'LAYOUT A: Classic centered symmetrical composition. The icon or main visual sits dead center with text arching above and below. Most traditional merchandise layout.',
    'LAYOUT B: Typography-forward composition. The text and lettering drive the visual weight. Supporting icon or graphic is secondary, integrated into or behind the text structure.',
    'LAYOUT C: Illustration-forward composition. The graphic, character, or scene is the dominant element taking up 60-70% of the design. Text is compact and positioned below or integrated.'
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

// Generate designs via Recraft API
async function generateDesigns(formData) {
  if (!RECRAFT_API_KEY) {
    console.log('No Recraft API key - returning placeholder designs');
    return { designs: null, error: 'No API key configured. Using placeholder designs.' };
  }

  const designs = [];

  for (let i = 0; i < 3; i++) {
    try {
      const prompt = buildDesignPrompt(formData, i);

      const response = await fetch(`${RECRAFT_BASE}/images/generations`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RECRAFT_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt: prompt,
          style: 'vector_illustration',
          model: 'recraftv4',
          size: '1024x1024',
          response_format: 'url',
          controls: {
            colors: [{ rgb: [0, 0, 0] }, { rgb: [255, 255, 255] }]
          }
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error(`Recraft generation ${i} failed:`, errText);
        designs.push({ error: `Generation failed: ${response.status}` });
        continue;
      }

      const data = await response.json();
      const imageUrl = data.data?.[0]?.url;

      if (imageUrl) {
        // Download and save the image locally
        const imgResponse = await fetch(imageUrl);
        const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());
        const filename = `design-${Date.now()}-${i}.png`;
        const filepath = path.join(uploadsDir, filename);
        fs.writeFileSync(filepath, imgBuffer);

        designs.push({
          url: `/uploads/${filename}`,
          remoteUrl: imageUrl,
          variation: i,
          prompt: prompt
        });
      } else {
        designs.push({ error: 'No image URL in response' });
      }
    } catch (err) {
      console.error(`Recraft generation ${i} error:`, err.message);
      designs.push({ error: err.message });
    }
  }

  return { designs };
}

// Try to vectorize using Recraft's vectorize endpoint
async function vectorizeDesign(imageUrl) {
  if (!RECRAFT_API_KEY) return { error: 'No API key' };

  try {
    const response = await fetch(`${RECRAFT_BASE}/images/vectorize`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RECRAFT_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ file: imageUrl })
    });

    if (!response.ok) return { error: `Vectorize failed: ${response.status}` };
    const data = await response.json();
    return { svg_url: data.data?.[0]?.url };
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
  const formData = req.body;
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
      const products = (formData.products || []).join(', ');
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
                <p style="margin: 4px 0; font-size: 14px;"><strong>Service:</strong> ${formData.serviceType || 'Custom Design'}</p>
                <p style="margin: 4px 0; font-size: 14px;"><strong>Decoration:</strong> ${formData.decoration || 'TBD'}</p>
                <p style="margin: 4px 0; font-size: 14px;"><strong>Products:</strong> ${products || 'TBD'}</p>
                <p style="margin: 4px 0; font-size: 14px;"><strong>Selected Option:</strong> ${formData.selectedOption || 'TBD'}</p>
                ${formData.poNumber ? `<p style="margin: 4px 0; font-size: 14px;"><strong>PO #:</strong> ${formData.poNumber}</p>` : ''}
              </div>
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
    recraftEnabled: !!RECRAFT_API_KEY
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


// ---- Serve frontend (all inline, no /public folder needed) ----

const WIDGET_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Merchy's Design Studio</title>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Poppins',sans-serif;background:#fff;color:#111;overflow-x:hidden}

/* Header */
.header{background:#111;color:#d4a017;padding:16px 24px;display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #d4a017;position:sticky;top:0;z-index:100}
.header h1{font-size:18px;font-weight:700;letter-spacing:1px}
.header .steps{font-size:13px;color:#999;margin-top:2px}
.close-btn{background:none;border:none;color:#999;font-size:22px;cursor:pointer;padding:6px}
.close-btn:hover{color:#fff}

/* Content */
.content{padding:20px 24px;overflow-y:auto;height:calc(100vh - 64px)}
.step{display:none}
.step.active{display:block;animation:fadeUp .2s ease}
@keyframes fadeUp{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}

/* Category Tabs */
.cat-tabs{display:flex;gap:6px;overflow-x:auto;padding-bottom:14px;margin-bottom:14px;border-bottom:1px solid #eee;-webkit-overflow-scrolling:touch}
.cat-tabs::-webkit-scrollbar{height:0}
.cat-tab{padding:8px 16px;border-radius:20px;font-size:14px;font-weight:600;white-space:nowrap;cursor:pointer;border:2px solid #e5e5e5;background:#fff;transition:all .15s;flex-shrink:0}
.cat-tab:hover{border-color:#d4a017}
.cat-tab.active{background:#111;color:#d4a017;border-color:#111}

/* Search */
.search-bar{width:100%;padding:12px 16px;border:2px solid #e5e5e5;border-radius:8px;font-family:inherit;font-size:15px;margin-bottom:14px;outline:none;transition:border .15s}
.search-bar:focus{border-color:#d4a017}

/* Service tiles - 6 wide grid */
.svc-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin-bottom:14px}
.svc-tile{background:#fff;border:2px solid #eee;border-radius:10px;padding:16px 10px;text-align:center;cursor:pointer;transition:all .2s;display:flex;flex-direction:column;align-items:center}
.svc-tile:hover{border-color:#d4a017;box-shadow:0 4px 16px rgba(212,160,23,.1);transform:translateY(-2px)}
.svc-tile.selected{border-color:#d4a017;background:#111;color:#d4a017}
.svc-tile .tile-icon{width:48px;height:48px;margin-bottom:8px;display:flex;align-items:center;justify-content:center}
.svc-tile .tile-icon svg{width:40px;height:40px;stroke:#d4a017;fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.svc-tile.selected .tile-icon svg{stroke:#d4a017}
.svc-tile .tile-name{font-size:13px;font-weight:600;line-height:1.3;margin-bottom:4px}
.svc-tile .tile-desc{font-size:11px;color:#999;line-height:1.3}
.svc-tile.selected .tile-desc{color:#888}
.no-results{text-align:center;color:#888;font-size:14px;padding:24px 0}

/* Responsive: fewer columns on smaller screens */
@media(max-width:900px){.svc-grid{grid-template-columns:repeat(4,1fr)}}
@media(max-width:600px){.svc-grid{grid-template-columns:repeat(3,1fr)}}
@media(max-width:400px){.svc-grid{grid-template-columns:repeat(2,1fr)}}

/* Form layout - side by side */
.form-row{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:4px}
.form-row.full{grid-template-columns:1fr}
label{display:block;font-size:13px;font-weight:600;margin-bottom:5px;color:#444;text-transform:uppercase;letter-spacing:.5px}
input[type="text"],input[type="email"],textarea,select{width:100%;padding:11px 14px;border:2px solid #e5e5e5;border-radius:8px;font-family:inherit;font-size:15px;outline:none;transition:border .15s;margin-bottom:14px}
input:focus,textarea:focus,select:focus{border-color:#d4a017}
textarea{resize:vertical;min-height:70px}

/* Multi-location picker */
.loc-section{margin-bottom:14px}
.loc-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px}
.loc-btn{padding:10px 6px;border:2px solid #eee;border-radius:8px;cursor:pointer;text-align:center;font-size:14px;font-weight:600;transition:all .15s;background:#fff}
.loc-btn:hover{border-color:#d4a017}
.loc-btn.active{background:#111;color:#d4a017;border-color:#111}
.loc-detail{background:#f8f8f8;border-radius:8px;padding:12px;margin-bottom:8px;display:none;animation:fadeUp .15s ease}
.loc-detail.visible{display:block}
.loc-detail h4{font-size:14px;font-weight:700;margin-bottom:6px;color:#111}
.loc-detail textarea{min-height:50px;margin-bottom:6px}

/* Upload area - compact inline */
.upload-area{border:2px dashed #ddd;border-radius:8px;padding:14px;text-align:center;cursor:pointer;transition:all .15s;margin-bottom:14px;display:flex;align-items:center;gap:10px;justify-content:center}
.upload-area:hover{border-color:#d4a017;background:#fffdf5}
.upload-area.has-file{border-color:#d4a017;background:#f0f7e6}
.upload-area p{font-size:14px;color:#888}
.upload-area .plus{font-size:22px;color:#ccc;font-weight:700}
.upload-preview{max-width:48px;max-height:40px;border-radius:4px}

/* Style picker - 20 styles, 5-wide grid with SVG icons */
.style-section{margin-bottom:16px}
.style-counter{font-size:13px;color:#888;margin-bottom:8px;text-align:right}
.style-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}
@media(max-width:700px){.style-grid{grid-template-columns:repeat(4,1fr)}}
@media(max-width:500px){.style-grid{grid-template-columns:repeat(3,1fr)}}
.style-card{padding:12px 6px 8px;border:2px solid #eee;border-radius:10px;cursor:pointer;text-align:center;transition:all .15s;background:#fff}
.style-card:hover{border-color:#d4a017;background:#fffdf5;transform:translateY(-1px)}
.style-card.active{background:#111;color:#d4a017;border-color:#d4a017}
.style-card.disabled{opacity:.3;cursor:not-allowed;transform:none}
.style-card .s-icon{width:44px;height:44px;margin:0 auto 6px;display:flex;align-items:center;justify-content:center}
.style-card .s-icon svg{width:36px;height:36px;stroke:#d4a017;fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.style-card .s-name{font-size:12px;font-weight:700;line-height:1.2}
.style-card .s-hint{font-size:10px;color:#aaa;line-height:1.2;margin-top:2px}
.style-card.active .s-hint{color:#999}

/* Selected service pill */
.sel-pill{display:inline-flex;align-items:center;gap:8px;background:#f8f8f8;border-radius:8px;padding:8px 14px;margin-bottom:16px;font-size:15px;font-weight:600}
.sel-pill .dot{width:10px;height:10px;border-radius:50%;background:#d4a017}

/* Buttons */
.btn{width:100%;padding:14px;border:none;border-radius:8px;font-family:inherit;font-size:16px;font-weight:700;cursor:pointer;transition:all .15s;letter-spacing:.5px}
.btn-primary{background:#d4a017;color:#111}
.btn-primary:hover{background:#e8b420}
.btn-primary:disabled{opacity:.5;cursor:not-allowed}
.btn-back{background:none;border:2px solid #eee;color:#555;margin-bottom:8px;font-size:14px;padding:10px}
.btn-back:hover{border-color:#111;color:#111}

/* Design results */
.designs-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:14px}
.design-card{border:2px solid #eee;border-radius:8px;overflow:hidden;cursor:pointer;transition:all .15s;position:relative}
.design-card:hover{border-color:#d4a017}
.design-card.selected{border-color:#d4a017;box-shadow:0 0 0 3px #d4a017}
.design-card img{width:100%;aspect-ratio:1;object-fit:cover;display:block}
.design-card .watermark{position:absolute;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:rgba(0,0,0,.12);pointer-events:none;transform:rotate(-30deg);letter-spacing:2px}

/* Loading */
.loading{text-align:center;padding:30px}
.spinner{width:36px;height:36px;border:3px solid #eee;border-top-color:#d4a017;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 10px}
@keyframes spin{to{transform:rotate(360deg)}}
.loading p{font-size:14px;color:#888}

/* Summary */
.summary-box{background:#f8f8f8;border-radius:8px;padding:14px;margin-bottom:14px}
.summary-box h3{font-size:15px;font-weight:700;margin-bottom:8px}
.summary-row{display:flex;justify-content:space-between;font-size:14px;margin-bottom:4px}
.summary-row .label{color:#888}
.summary-row .val{font-weight:600}
</style>
</head>
<body>

<div class="header">
  <div>
    <h1>DESIGN STUDIO</h1>
    <div class="steps" id="stepLabel">Step 1 of 4 - Choose Service</div>
  </div>
  <button class="close-btn" onclick="window.parent?.postMessage({type:'close-widget'},'*')">&times;</button>
</div>

<div class="content" id="content">

  <!-- STEP 1: Service Tiles -->
  <div class="step active" id="step1">
    <div class="cat-tabs" id="catTabs"></div>
    <input type="text" class="search-bar" placeholder="Search services..." id="searchBar" oninput="filterServices()">
    <div id="serviceGrid" class="svc-grid"></div>
    <div id="noResults" class="no-results" style="display:none">No services found.</div>
  </div>

  <!-- STEP 2: Design Details -->
  <div class="step" id="step2">
    <button class="btn btn-back" onclick="goStep(1)">Back</button>
    <div class="sel-pill" id="selPill"><span class="dot"></span><span id="selSvcName"></span></div>

    <div class="form-row">
      <div><label>Name</label><input type="text" id="userName" placeholder="John Smith"></div>
      <div><label>Email</label><input type="email" id="userEmail" placeholder="john@company.com"></div>
    </div>
    <div class="form-row">
      <div><label>Business / Brand</label><input type="text" id="userBusiness" placeholder="Your Company Name"></div>
      <div><label>Text for Design</label><input type="text" id="designText" placeholder="Brand Name, Est. 2024"></div>
    </div>
    <div class="form-row full">
      <div><label>Describe What You Want</label><textarea id="designDesc" placeholder="A bold logo with a mountain icon for an outdoor adventure company"></textarea></div>
    </div>

    <!-- Print Location Picker (apparel only) -->
    <div class="loc-section" id="locationSection" style="display:none">
      <label>Print Locations (select all that apply)</label>
      <div class="loc-grid" id="locGrid"></div>
      <div id="locDetails"></div>
    </div>

    <!-- Upload -->
    <label>Reference Image (optional)</label>
    <div class="upload-area" id="uploadArea" onclick="document.getElementById('fileInput').click()">
      <span class="plus">+</span>
      <p>Upload a reference image</p>
    </div>
    <input type="file" id="fileInput" accept="image/*" style="display:none" onchange="handleUpload(this)">

    <!-- Style Picker -->
    <div class="style-section">
      <label>Design Style <span style="font-weight:400;color:#aaa;text-transform:none">(pick up to 3)</span></label>
      <div class="style-counter" id="styleCounter">0 of 3 selected</div>
      <div class="style-grid" id="styleGrid"></div>
    </div>

    <button class="btn btn-primary" onclick="generateDesigns()" id="generateBtn">Generate 3 AI Designs</button>
  </div>

  <!-- STEP 3: Review Designs -->
  <div class="step" id="step3">
    <button class="btn btn-back" onclick="goStep(2)">Back to Details</button>
    <div class="loading" id="loadingState">
      <div class="spinner"></div>
      <p>Creating your designs...</p>
      <p style="font-size:12px;color:#aaa;margin-top:4px">This may take 15-30 seconds</p>
    </div>
    <div id="designResults" style="display:none">
      <p style="font-size:15px;font-weight:600;margin-bottom:10px">Select your favorite:</p>
      <div class="designs-grid" id="designsGrid"></div>
      <div class="summary-box" id="designSummary"></div>
      <button class="btn btn-primary" onclick="goStep(4)" id="continueBtn" disabled>Continue with Selected Design</button>
      <button class="btn btn-back" onclick="regenerate()" style="margin-top:6px">Regenerate</button>
    </div>
  </div>

  <!-- STEP 4: Get Vector / Submit -->
  <div class="step" id="step4">
    <button class="btn btn-back" onclick="goStep(3)">Back</button>
    <div style="text-align:center;margin-bottom:16px">
      <img id="finalDesignImg" src="" style="max-width:180px;border-radius:8px;border:2px solid #eee">
    </div>
    <div style="background:#f8f8f8;border-radius:8px;padding:14px;margin-bottom:14px">
      <p style="font-size:16px;font-weight:700;margin-bottom:6px">Want a production-ready vector file?</p>
      <p style="font-size:14px;color:#666;margin-bottom:10px">Scalable SVG vector for crisp printing at any size. \$25 one-time.</p>
      <button class="btn btn-primary" onclick="purchaseVector()" id="vectorBtn">Get Vector File - \$25</button>
    </div>
    <p style="font-size:14px;color:#888;text-align:center;margin-bottom:10px">or</p>
    <button class="btn btn-primary" onclick="submitDesign()" id="submitBtn" style="background:#111;color:#d4a017">Submit Design Request (Free)</button>
    <p style="font-size:12px;color:#999;text-align:center;margin-top:6px">Our team will review and finalize your design.</p>
  </div>

  <!-- STEP 5: Confirmation -->
  <div class="step" id="step5">
    <div style="text-align:center;padding:24px 0">
      <div style="font-size:40px;margin-bottom:10px;color:#d4a017">&#10003;</div>
      <h2 style="font-size:20px;font-weight:700;margin-bottom:8px">Design Submitted!</h2>
      <p style="font-size:15px;color:#666;margin-bottom:16px">Our team will get back to you within 1 business day.</p>
      <div class="summary-box" id="finalSummary"></div>
      <p style="font-size:13px;color:#888;margin-top:14px">619-800-0949 | start@merchysmerch.com</p>
    </div>
  </div>
</div>

<script>
const API_BASE = window.location.origin;
let config = null;
let selectedService = null;
let selectedCategory = 'all';
let selectedLocations = {};
let selectedStyles = ['badge'];
let uploadedFileUrl = null;
let designs = [];
let selectedDesignIdx = null;

const DEFAULT_LOCATIONS = [
  { id: 'front', name: 'Front', positions: ['Full Front', 'Chest Logo', 'Pocket Logo', 'Oversized'] },
  { id: 'back', name: 'Back', positions: ['Full Back', 'Oversized'] },
  { id: 'left-sleeve', name: 'Left Sleeve' },
  { id: 'right-sleeve', name: 'Right Sleeve' },
  { id: 'neck-label', name: 'Neck Label' },
  { id: 'hat', name: 'Hat' }
];

// SVG icons for service categories
const CATEGORY_ICONS = {
  'dtf-printing': '<svg viewBox="0 0 48 48"><path d="M14 10L20 6L28 6L34 10L40 16L36 20L32 16V40H16V16L12 20L8 16Z"/><rect x="20" y="22" width="8" height="10" rx="1"/></svg>',
  'screen-printing': '<svg viewBox="0 0 48 48"><rect x="8" y="8" width="32" height="12" rx="2"/><line x1="12" y1="14" x2="36" y2="14"/><path d="M14 20V40H34V20"/><rect x="18" y="26" width="12" height="8" rx="1"/></svg>',
  'embroidery': '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="14"/><path d="M18 18L24 30L30 18"/><path d="M16 24H32" stroke-dasharray="3 2"/></svg>',
  'dtg-printing': '<svg viewBox="0 0 48 48"><rect x="10" y="8" width="28" height="32" rx="3"/><rect x="16" y="16" width="16" height="16" rx="2"/><circle cx="24" cy="24" r="4"/></svg>',
  'heat-transfer': '<svg viewBox="0 0 48 48"><path d="M14 10L20 6L28 6L34 10L40 16L36 20L32 16V40H16V16L12 20L8 16Z"/><path d="M20 28L24 20L28 28" stroke-dasharray="3 2"/></svg>',
  'sublimation-apparel': '<svg viewBox="0 0 48 48"><path d="M14 10L20 6L28 6L34 10L40 16L36 20L32 16V40H16V16L12 20L8 16Z"/><path d="M16 22H32"/><path d="M16 28H32"/><path d="M16 34H32"/></svg>',
  'vinyl-banners': '<svg viewBox="0 0 48 48"><rect x="6" y="10" width="36" height="22" rx="2"/><line x1="12" y1="18" x2="36" y2="18"/><line x1="12" y1="24" x2="30" y2="24"/><line x1="6" y1="10" x2="6" y2="6"/><line x1="42" y1="10" x2="42" y2="6"/></svg>',
  'retractable-banners': '<svg viewBox="0 0 48 48"><rect x="14" y="6" width="20" height="32" rx="1"/><line x1="18" y1="14" x2="30" y2="14"/><line x1="18" y1="20" x2="28" y2="20"/><rect x="16" y="38" width="16" height="4" rx="1"/></svg>',
  'yard-signs': '<svg viewBox="0 0 48 48"><rect x="10" y="8" width="28" height="18" rx="2"/><line x1="18" y1="14" x2="34" y2="14"/><line x1="18" y1="20" x2="28" y2="20"/><line x1="20" y1="26" x2="20" y2="42"/><line x1="28" y1="26" x2="28" y2="42"/></svg>',
  'window-graphics': '<svg viewBox="0 0 48 48"><rect x="8" y="8" width="32" height="32" rx="2"/><line x1="24" y1="8" x2="24" y2="40"/><line x1="8" y1="24" x2="40" y2="24"/><circle cx="16" cy="16" r="3"/></svg>',
  'wall-wraps': '<svg viewBox="0 0 48 48"><rect x="6" y="10" width="36" height="28" rx="2"/><path d="M12 24L20 18L28 26L36 20"/><circle cx="14" cy="16" r="2"/></svg>',
  'car-wraps': '<svg viewBox="0 0 48 48"><path d="M8 28L12 20H36L40 28"/><rect x="6" y="28" width="36" height="10" rx="3"/><circle cx="14" cy="38" r="3"/><circle cx="34" cy="38" r="3"/></svg>',
  'a-frame-signs': '<svg viewBox="0 0 48 48"><path d="M12 40L24 8L36 40"/><line x1="16" y1="28" x2="32" y2="28"/><line x1="18" y1="20" x2="30" y2="20"/></svg>',
  'acrylic-signs': '<svg viewBox="0 0 48 48"><rect x="8" y="12" width="32" height="20" rx="3"/><line x1="14" y1="20" x2="34" y2="20"/><line x1="14" y1="26" x2="28" y2="26"/><line x1="24" y1="32" x2="24" y2="40"/><line x1="18" y1="40" x2="30" y2="40"/></svg>',
  'business-cards': '<svg viewBox="0 0 48 48"><rect x="6" y="14" width="36" height="22" rx="2"/><line x1="14" y1="22" x2="28" y2="22"/><line x1="14" y1="28" x2="22" y2="28"/><circle cx="36" cy="28" r="3"/></svg>',
  'flyers': '<svg viewBox="0 0 48 48"><rect x="10" y="6" width="28" height="36" rx="2"/><line x1="16" y1="14" x2="32" y2="14"/><line x1="16" y1="20" x2="32" y2="20"/><line x1="16" y1="26" x2="24" y2="26"/></svg>',
  'brochures': '<svg viewBox="0 0 48 48"><rect x="6" y="10" width="36" height="28" rx="2"/><line x1="20" y1="10" x2="20" y2="38"/><line x1="34" y1="10" x2="34" y2="38"/><line x1="9" y1="18" x2="17" y2="18"/><line x1="23" y1="18" x2="31" y2="18"/></svg>',
  'postcards': '<svg viewBox="0 0 48 48"><rect x="6" y="12" width="36" height="24" rx="2"/><line x1="26" y1="12" x2="26" y2="36"/><line x1="30" y1="20" x2="38" y2="20"/><line x1="30" y1="26" x2="38" y2="26"/><rect x="10" y="16" width="12" height="8" rx="1"/></svg>',
  'menus': '<svg viewBox="0 0 48 48"><rect x="8" y="6" width="32" height="36" rx="2"/><line x1="14" y1="14" x2="34" y2="14"/><line x1="14" y1="20" x2="30" y2="20"/><line x1="14" y1="26" x2="28" y2="26"/><line x1="14" y1="32" x2="32" y2="32"/></svg>',
  'ncr-forms': '<svg viewBox="0 0 48 48"><rect x="10" y="6" width="28" height="34" rx="2"/><rect x="13" y="10" width="28" height="34" rx="2"/><line x1="19" y1="20" x2="35" y2="20"/><line x1="19" y1="26" x2="31" y2="26"/></svg>',
  'booklets': '<svg viewBox="0 0 48 48"><path d="M8 8V40L24 36L40 40V8L24 12Z"/><line x1="24" y1="12" x2="24" y2="36"/></svg>',
  'letterhead': '<svg viewBox="0 0 48 48"><rect x="10" y="6" width="28" height="36" rx="2"/><circle cx="24" cy="14" r="4"/><line x1="16" y1="24" x2="32" y2="24"/><line x1="16" y1="30" x2="32" y2="30"/><line x1="16" y1="36" x2="24" y2="36"/></svg>',
  'door-hangers': '<svg viewBox="0 0 48 48"><rect x="14" y="6" width="20" height="36" rx="3"/><circle cx="24" cy="14" r="4"/><line x1="18" y1="24" x2="30" y2="24"/><line x1="18" y1="30" x2="28" y2="30"/></svg>',
  'drinkware': '<svg viewBox="0 0 48 48"><path d="M14 10H34L32 40H16Z"/><path d="M34 16H40V24H34"/><line x1="20" y1="22" x2="28" y2="22"/></svg>',
  'tote-bags': '<svg viewBox="0 0 48 48"><rect x="10" y="18" width="28" height="24" rx="2"/><path d="M18 18V12A6 6 0 0 1 30 12V18"/><rect x="18" y="26" width="12" height="8" rx="1"/></svg>',
  'pens': '<svg viewBox="0 0 48 48"><path d="M32 8L40 16L18 38L10 40L12 32Z"/><line x1="28" y1="12" x2="36" y2="20"/></svg>',
  'tech-accessories': '<svg viewBox="0 0 48 48"><rect x="14" y="6" width="20" height="36" rx="4"/><line x1="14" y1="12" x2="34" y2="12"/><line x1="14" y1="36" x2="34" y2="36"/><circle cx="24" cy="40" r="1.5"/></svg>',
  'trade-show-displays': '<svg viewBox="0 0 48 48"><rect x="6" y="6" width="36" height="28" rx="2"/><line x1="6" y1="34" x2="42" y2="34"/><line x1="12" y1="34" x2="12" y2="42"/><line x1="36" y1="34" x2="36" y2="42"/></svg>',
  'lanyards': '<svg viewBox="0 0 48 48"><path d="M18 6V28H30V6"/><rect x="16" y="28" width="16" height="12" rx="2"/><line x1="20" y1="34" x2="28" y2="34"/></svg>',
  'stickers-labels': '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="16"/><path d="M24 8A16 16 0 0 1 40 24L24 24Z" fill="none"/><line x1="18" y1="22" x2="30" y2="22"/><line x1="18" y1="28" x2="26" y2="28"/></svg>',
  'keychains': '<svg viewBox="0 0 48 48"><circle cx="24" cy="18" r="10"/><circle cx="24" cy="18" r="4"/><path d="M24 28V42"/><line x1="24" y1="34" x2="30" y2="34"/><line x1="24" y1="38" x2="28" y2="38"/></svg>',
  'packaging': '<svg viewBox="0 0 48 48"><path d="M8 16L24 8L40 16V36L24 44L8 36Z"/><line x1="24" y1="8" x2="24" y2="44"/><line x1="8" y1="16" x2="40" y2="16"/></svg>',
  'food-wellness': '<svg viewBox="0 0 48 48"><circle cx="24" cy="28" r="14"/><path d="M24 14V8"/><path d="M20 10C20 10 24 6 28 10"/></svg>',
  'outdoor-leisure': '<svg viewBox="0 0 48 48"><path d="M24 6L40 38H8Z"/><path d="M16 28L24 16L32 28"/><circle cx="34" cy="14" r="4"/></svg>',
  'awards': '<svg viewBox="0 0 48 48"><circle cx="24" cy="18" r="12"/><path d="M18 28L16 40H32L30 28"/><line x1="24" y1="12" x2="24" y2="24"/><line x1="18" y1="18" x2="30" y2="18"/></svg>',
  'pet-supplies': '<svg viewBox="0 0 48 48"><circle cx="24" cy="28" r="8"/><circle cx="16" cy="16" r="4"/><circle cx="32" cy="16" r="4"/><circle cx="12" cy="24" r="3"/><circle cx="36" cy="24" r="3"/></svg>',
  'auto-accessories': '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="16"/><circle cx="24" cy="24" r="8"/><circle cx="24" cy="24" r="2"/><line x1="24" y1="8" x2="24" y2="16"/><line x1="24" y1="32" x2="24" y2="40"/><line x1="8" y1="24" x2="16" y2="24"/><line x1="32" y1="24" x2="40" y2="24"/></svg>',
  'uv-printing': '<svg viewBox="0 0 48 48"><circle cx="24" cy="16" r="8"/><path d="M14 28H34V40H14Z" rx="2"/><line x1="24" y1="24" x2="24" y2="28"/><path d="M18 20L10 26"/><path d="M30 20L38 26"/></svg>',
  'sublimation': '<svg viewBox="0 0 48 48"><path d="M14 10H34L32 40H16Z"/><circle cx="24" cy="24" r="6"/><path d="M20 18H28"/></svg>',
  'laser-engraving': '<svg viewBox="0 0 48 48"><rect x="10" y="16" width="28" height="24" rx="2"/><path d="M24 6L24 16"/><path d="M20 6L28 6"/><line x1="16" y1="24" x2="32" y2="24"/><line x1="16" y1="30" x2="28" y2="30"/></svg>',
  'patches': '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="16"/><circle cx="24" cy="24" r="12" stroke-dasharray="4 2"/><line x1="18" y1="22" x2="30" y2="22"/><line x1="20" y1="28" x2="28" y2="28"/></svg>',
  'embroidered-patches': '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="16"/><path d="M16 20L24 14L32 20" stroke-dasharray="3 2"/><line x1="16" y1="28" x2="32" y2="28" stroke-dasharray="3 2"/></svg>',
  'pvc-patches': '<svg viewBox="0 0 48 48"><rect x="8" y="8" width="32" height="32" rx="6"/><rect x="14" y="14" width="20" height="20" rx="3"/><line x1="18" y1="22" x2="30" y2="22"/><line x1="20" y1="28" x2="28" y2="28"/></svg>',
  'chenille-patches': '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="16"/><path d="M18 22C18 22 21 18 24 22C27 26 30 22 30 22"/><line x1="16" y1="30" x2="32" y2="30"/></svg>',
  'logo-design': '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="16"/><path d="M18 30L24 16L30 30"/><line x1="20" y1="26" x2="28" y2="26"/></svg>',
  'vectorizing': '<svg viewBox="0 0 48 48"><path d="M12 36L24 12L36 36"/><line x1="16" y1="28" x2="32" y2="28"/><circle cx="24" cy="12" r="3"/><circle cx="12" cy="36" r="3"/><circle cx="36" cy="36" r="3"/></svg>',
  'mockups': '<svg viewBox="0 0 48 48"><rect x="8" y="10" width="20" height="28" rx="2"/><rect x="20" y="14" width="20" height="20" rx="2"/></svg>',
  'brand-identity': '<svg viewBox="0 0 48 48"><rect x="8" y="8" width="32" height="32" rx="4"/><circle cx="24" cy="20" r="6"/><line x1="14" y1="30" x2="34" y2="30"/><line x1="18" y1="36" x2="30" y2="36"/></svg>',
  'social-media-graphics': '<svg viewBox="0 0 48 48"><rect x="8" y="8" width="32" height="32" rx="4"/><circle cx="24" cy="24" r="8"/><circle cx="34" cy="14" r="2"/></svg>',
  'illustration': '<svg viewBox="0 0 48 48"><path d="M12 40L14 28L32 10L40 18L22 36Z"/><line x1="28" y1="14" x2="36" y2="22"/></svg>',
  'photo-editing': '<svg viewBox="0 0 48 48"><rect x="6" y="10" width="36" height="28" rx="2"/><circle cx="16" cy="20" r="4"/><path d="M6 34L18 24L28 32L36 26L42 32"/></svg>',
  'shirt-design': '<svg viewBox="0 0 48 48"><path d="M14 10L20 6L28 6L34 10L40 16L36 20L32 16V40H16V16L12 20L8 16Z"/><circle cx="24" cy="26" r="6"/></svg>',
  'packaging-design': '<svg viewBox="0 0 48 48"><path d="M8 16L24 8L40 16V36L24 44L8 36Z"/><line x1="24" y1="8" x2="24" y2="44"/><line x1="8" y1="16" x2="24" y2="24"/><line x1="40" y1="16" x2="24" y2="24"/></svg>',
  'digitizing': '<svg viewBox="0 0 48 48"><path d="M12 36L24 12L36 36"/><line x1="16" y1="28" x2="32" y2="28"/><path d="M8 40H40" stroke-dasharray="4 2"/></svg>'
};

// SVG icons for 20 design styles
const STYLE_ICONS = {
  badge: '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="18"/><circle cx="24" cy="24" r="12"/><path d="M14 14L24 8L34 14" fill="none"/><line x1="16" y1="28" x2="32" y2="28"/></svg>',
  icon_logo: '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="10"/><circle cx="24" cy="24" r="18" stroke-dasharray="6 4"/></svg>',
  typography: '<svg viewBox="0 0 48 48"><path d="M10 12H38"/><path d="M24 12V38"/><path d="M16 38H32"/><path d="M14 12V18"/><path d="M34 12V18"/></svg>',
  mascot: '<svg viewBox="0 0 48 48"><circle cx="24" cy="18" r="12"/><circle cx="20" cy="16" r="2" fill="#d4a017"/><circle cx="28" cy="16" r="2" fill="#d4a017"/><path d="M20 22C20 22 24 26 28 22"/><path d="M16 30C16 30 24 40 32 30"/></svg>',
  scene: '<svg viewBox="0 0 48 48"><rect x="6" y="8" width="36" height="32" rx="2"/><path d="M6 32L18 22L28 30L38 22L42 28"/><circle cx="14" cy="16" r="3"/></svg>',
  badge_scene: '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="18"/><path d="M12 30L20 22L28 28L36 22"/><circle cx="16" cy="18" r="2"/><path d="M14 12L24 8L34 12"/></svg>',
  diagram: '<svg viewBox="0 0 48 48"><rect x="8" y="8" width="32" height="32" rx="2"/><line x1="8" y1="20" x2="40" y2="20"/><line x1="8" y1="32" x2="40" y2="32"/><line x1="24" y1="8" x2="24" y2="40"/></svg>',
  vintage_script: '<svg viewBox="0 0 48 48"><path d="M10 28C10 28 16 16 24 24C32 32 38 20 38 20"/><line x1="8" y1="36" x2="40" y2="36"/><circle cx="24" cy="12" r="3"/></svg>',
  streetwear: '<svg viewBox="0 0 48 48"><path d="M10 38L24 8L38 38"/><line x1="14" y1="30" x2="34" y2="30"/><rect x="18" y="18" width="12" height="8" rx="1"/></svg>',
  trade_tools: '<svg viewBox="0 0 48 48"><path d="M14 8L34 40"/><path d="M34 8L14 40"/><circle cx="24" cy="24" r="6"/></svg>',
  corporate_seal: '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="18"/><circle cx="24" cy="24" r="12"/><line x1="18" y1="22" x2="30" y2="22"/><line x1="20" y1="28" x2="28" y2="28"/></svg>',
  pattern: '<svg viewBox="0 0 48 48"><circle cx="12" cy="12" r="4"/><circle cx="24" cy="12" r="4"/><circle cx="36" cy="12" r="4"/><circle cx="12" cy="24" r="4"/><circle cx="24" cy="24" r="4"/><circle cx="36" cy="24" r="4"/><circle cx="12" cy="36" r="4"/><circle cx="24" cy="36" r="4"/><circle cx="36" cy="36" r="4"/></svg>',
  monogram: '<svg viewBox="0 0 48 48"><rect x="8" y="8" width="32" height="32" rx="4"/><text x="24" y="32" text-anchor="middle" font-size="24" font-weight="700" fill="none" stroke="#d4a017" stroke-width="1.5">M</text></svg>',
  collage: '<svg viewBox="0 0 48 48"><rect x="6" y="6" width="16" height="16" rx="2"/><rect x="26" y="6" width="16" height="10" rx="2"/><rect x="26" y="20" width="16" height="22" rx="2"/><rect x="6" y="26" width="16" height="16" rx="2"/></svg>',
  product_focus: '<svg viewBox="0 0 48 48"><path d="M14 38V18L24 10L34 18V38Z"/><rect x="20" y="28" width="8" height="10"/><circle cx="24" cy="22" r="3"/></svg>',
  humor: '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="18"/><circle cx="18" cy="20" r="2" fill="#d4a017"/><circle cx="30" cy="20" r="2" fill="#d4a017"/><path d="M16 30C16 30 20 36 24 36C28 36 32 30 32 30"/></svg>',
  heritage: '<svg viewBox="0 0 48 48"><rect x="8" y="8" width="32" height="32" rx="2"/><line x1="14" y1="16" x2="34" y2="16"/><text x="24" y="30" text-anchor="middle" font-size="12" font-weight="700" fill="none" stroke="#d4a017" stroke-width="1">1985</text><line x1="14" y1="36" x2="34" y2="36"/></svg>',
  line_art: '<svg viewBox="0 0 48 48"><path d="M24 8C14 8 8 16 8 24C8 32 14 40 24 40C34 40 40 32 40 24" fill="none"/><path d="M32 12L36 8L40 12"/><line x1="24" y1="20" x2="24" y2="32"/><line x1="18" y1="26" x2="30" y2="26"/></svg>',
  patch_first: '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="18" stroke-width="3"/><circle cx="24" cy="24" r="14" stroke-dasharray="5 3"/><path d="M18 22L24 16L30 22"/><line x1="16" y1="28" x2="32" y2="28" stroke-width="2"/></svg>',
  event_series: '<svg viewBox="0 0 48 48"><rect x="8" y="10" width="24" height="28" rx="2"/><rect x="16" y="14" width="24" height="28" rx="2"/><line x1="22" y1="22" x2="34" y2="22"/><line x1="22" y1="28" x2="32" y2="28"/><line x1="22" y1="34" x2="30" y2="34"/></svg>'
};

async function init() {
  try {
    const res = await fetch(\`\${API_BASE}/api/widget-config\`);
    config = await res.json();
  } catch(e) {
    config = { services: [], categories: [], styles: [], locations: DEFAULT_LOCATIONS };
  }
  renderCategoryTabs();
  renderServices();
  renderStylePicker();
  renderLocationPicker();
}

// Category tabs
function renderCategoryTabs() {
  const cats = config.categories || [];
  let html = '<div class="cat-tab active" onclick="selectCategory(\\'all\\',this)">All</div>';
  cats.forEach(c => { html += \`<div class="cat-tab" onclick="selectCategory('\${c.id}',this)">\${c.name}</div>\`; });
  document.getElementById('catTabs').innerHTML = html;
}

function selectCategory(id, el) {
  selectedCategory = id;
  document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
  if(el) el.classList.add('active');
  renderServices();
}

// Service tiles - 6 wide grid with SVG icons
function renderServices() {
  const search = (document.getElementById('searchBar').value || '').toLowerCase();
  let svcs = config?.services || [];
  if(selectedCategory !== 'all') svcs = svcs.filter(s => s.category === selectedCategory);
  if(search) svcs = svcs.filter(s => s.name.toLowerCase().includes(search) || s.desc.toLowerCase().includes(search));

  const grid = document.getElementById('serviceGrid');
  const noRes = document.getElementById('noResults');
  if(!svcs.length) { grid.innerHTML=''; noRes.style.display='block'; return; }
  noRes.style.display='none';

  grid.innerHTML = svcs.map(s => {
    const icon = CATEGORY_ICONS[s.id] || '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="16"/><line x1="18" y1="22" x2="30" y2="22"/><line x1="20" y1="28" x2="28" y2="28"/></svg>';
    return \`<div class="svc-tile \${selectedService?.id===s.id?'selected':''}" onclick="selectService('\${s.id}')">
      <div class="tile-icon">\${icon}</div>
      <div class="tile-name">\${s.name}</div>
      <div class="tile-desc">\${s.desc}</div>
    </div>\`;
  }).join('');
}

function filterServices() { renderServices(); }

function selectService(id) {
  selectedService = (config?.services||[]).find(s => s.id === id);
  renderServices();
  if(selectedService) setTimeout(() => goStep(2), 150);
}

// Location picker
function renderLocationPicker() {
  const locs = config?.locations || DEFAULT_LOCATIONS;
  document.getElementById('locGrid').innerHTML = locs.map(l =>
    \`<div class="loc-btn" id="loc-\${l.id}" onclick="toggleLocation('\${l.id}')">\${l.name}</div>\`
  ).join('');
}

function toggleLocation(id) {
  const btn = document.getElementById(\`loc-\${id}\`);
  if(selectedLocations[id]) { delete selectedLocations[id]; btn.classList.remove('active'); }
  else { selectedLocations[id] = { instructions:'', position:'' }; btn.classList.add('active'); }
  renderLocationDetails();
}

function renderLocationDetails() {
  const locs = config?.locations || DEFAULT_LOCATIONS;
  let html = '';
  Object.keys(selectedLocations).forEach(id => {
    const loc = locs.find(l => l.id === id);
    if(!loc) return;
    const hasPos = loc.positions?.length > 0;
    html += \`<div class="loc-detail visible">
      <h4>\${loc.name}</h4>
      \${hasPos ? \`<select onchange="selectedLocations['\${id}'].position=this.value">
        <option value="">Select position...</option>
        \${loc.positions.map(p => \`<option value="\${p}">\${p}</option>\`).join('')}
      </select>\` : ''}
      <textarea placeholder="Instructions for \${loc.name} (e.g. logo centered, 4 inches wide)" oninput="selectedLocations['\${id}'].instructions=this.value"></textarea>
    </div>\`;
  });
  document.getElementById('locDetails').innerHTML = html;
}

// Style picker with SVG icons - multi-select up to 3
function renderStylePicker() {
  const styles = config?.styles || [];
  const grid = document.getElementById('styleGrid');
  const isObj = styles.length > 0 && typeof styles[0] === 'object';

  grid.innerHTML = (isObj ? styles : []).map(s => {
    const isActive = selectedStyles.includes(s.id);
    const atMax = selectedStyles.length >= 3 && !isActive;
    const icon = STYLE_ICONS[s.id] || '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="16"/></svg>';
    return \`<div class="style-card \${isActive?'active':''} \${atMax?'disabled':''}" onclick="toggleStyle('\${s.id}')">
      <div class="s-icon">\${icon}</div>
      <div class="s-name">\${s.name}</div>
      <div class="s-hint">\${s.desc}</div>
    </div>\`;
  }).join('');

  document.getElementById('styleCounter').textContent = \`\${selectedStyles.length} of 3 selected\`;
}

function toggleStyle(id) {
  const idx = selectedStyles.indexOf(id);
  if(idx > -1) { selectedStyles.splice(idx, 1); }
  else { if(selectedStyles.length >= 3) return; selectedStyles.push(id); }
  renderStylePicker();
}

// Upload
function handleUpload(input) {
  const file = input.files[0];
  if(!file) return;
  const area = document.getElementById('uploadArea');
  const fd = new FormData();
  fd.append('files', file);
  fetch(\`\${API_BASE}/api/upload\`, { method:'POST', body:fd })
    .then(r => r.json())
    .then(d => { if(d.files?.length) uploadedFileUrl = d.files[0].url; })
    .catch(console.error);
  const reader = new FileReader();
  reader.onload = e => {
    area.innerHTML = \`<img class="upload-preview" src="\${e.target.result}"><p style="font-size:13px;color:#888">\${file.name}</p>\`;
    area.classList.add('has-file');
  };
  reader.readAsDataURL(file);
}

// Navigation
function goStep(n) {
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
  document.getElementById(\`step\${n}\`).classList.add('active');
  const labels = ['Choose Service','Design Details','Review Designs','Get Your File','Confirmation'];
  document.getElementById('stepLabel').textContent = \`Step \${n} of 4 - \${labels[n-1]||''}\`;
  if(n===2 && selectedService) {
    document.getElementById('selSvcName').textContent = selectedService.name;
    document.getElementById('locationSection').style.display = selectedService.category==='apparel_decoration'?'block':'none';
  }
  if(n===4) {
    const d = designs[selectedDesignIdx]||{};
    document.getElementById('finalDesignImg').src = d.remoteUrl || (d.url ? \`\${API_BASE}\${d.url}\` : '');
  }
  document.querySelector('.content').scrollTop = 0;
}

// Generate designs via backend
async function generateDesigns() {
  const name = document.getElementById('userName').value.trim();
  const email = document.getElementById('userEmail').value.trim();
  if(!name||!email) { alert('Please enter your name and email.'); return; }
  if(!selectedStyles.length) { alert('Please select at least one design style.'); return; }

  goStep(3);
  document.getElementById('loadingState').style.display = 'block';
  document.getElementById('designResults').style.display = 'none';

  try {
    const res = await fetch(\`\${API_BASE}/api/generate\`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        name, email,
        business: document.getElementById('userBusiness').value.trim(),
        text: document.getElementById('designText').value.trim(),
        desc: document.getElementById('designDesc').value.trim(),
        service: selectedService?.id||'',
        decoration: selectedService?.name||'',
        style: selectedStyles[0],
        styles: selectedStyles,
        locations: selectedLocations,
        referenceImage: uploadedFileUrl
      })
    });
    const data = await res.json();
    designs = data.designs || [];
    showDesignResults();
  } catch(err) {
    document.getElementById('loadingState').innerHTML = \`<p style="color:#c00;font-size:14px">Something went wrong.</p><button class="btn btn-back" onclick="goStep(2)" style="margin-top:10px">Go Back</button>\`;
  }
}

function showDesignResults() {
  document.getElementById('loadingState').style.display = 'none';
  document.getElementById('designResults').style.display = 'block';
  selectedDesignIdx = null;
  document.getElementById('designsGrid').innerHTML = designs.map((d,i) => {
    if(d.error) return \`<div class="design-card" style="display:flex;align-items:center;justify-content:center;aspect-ratio:1;background:#f8f8f8"><span style="font-size:12px;color:#888">Failed</span></div>\`;
    const src = d.remoteUrl || (d.url ? \`\${API_BASE}\${d.url}\` : '');
    const fallback = d.url ? \`\${API_BASE}\${d.url}\` : '';
    return \`<div class="design-card" onclick="selectDesign(\${i})" id="dcard-\${i}"><img src="\${src}" alt="Design \${i+1}" onerror="if(this.src!=='\${fallback}')this.src='\${fallback}'"><div class="watermark">PREVIEW</div></div>\`;
  }).join('');
  document.getElementById('continueBtn').disabled = true;
}

function selectDesign(idx) {
  if(designs[idx]?.error) return;
  selectedDesignIdx = idx;
  document.querySelectorAll('.design-card').forEach((c,i) => c.classList.toggle('selected', i===idx));
  document.getElementById('continueBtn').disabled = false;

  const styleNames = selectedStyles.map(sid => {
    const s = (config?.styles||[]).find(x => x.id===sid);
    return s?.name || sid;
  }).join(', ');

  const locNames = Object.keys(selectedLocations).length > 0
    ? Object.keys(selectedLocations).map(k => { const l=(config?.locations||DEFAULT_LOCATIONS).find(x=>x.id===k); return l?.name||k; }).join(', ')
    : 'N/A';

  document.getElementById('designSummary').innerHTML = \`
    <h3>Summary</h3>
    <div class="summary-row"><span class="label">Service</span><span class="val">\${selectedService?.name||'-'}</span></div>
    <div class="summary-row"><span class="label">Styles</span><span class="val">\${styleNames}</span></div>
    <div class="summary-row"><span class="label">Locations</span><span class="val">\${locNames}</span></div>
  \`;
}

function regenerate() { generateDesigns(); }

// Stripe vector purchase
async function purchaseVector() {
  const btn = document.getElementById('vectorBtn');
  btn.disabled=true; btn.textContent='Processing...';
  const d = designs[selectedDesignIdx]||{};
  try {
    const res = await fetch(\`\${API_BASE}/api/create-checkout\`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ tier:'detailed', designUrl: d.remoteUrl || (d.url ? \`\${API_BASE}\${d.url}\` : ''), email:document.getElementById('userEmail').value.trim() })
    });
    const data = await res.json();
    if(data.url) window.open(data.url,'_blank');
    else alert(data.error||'Checkout failed. Call 619-800-0949.');
  } catch(e) { alert('Payment error. Call 619-800-0949.'); }
  btn.disabled=false; btn.textContent='Get Vector File - \$25';
}

// Submit design request
async function submitDesign() {
  const btn = document.getElementById('submitBtn');
  btn.disabled=true; btn.textContent='Submitting...';
  const d = designs[selectedDesignIdx]||{};
  try {
    await fetch(\`\${API_BASE}/api/submit\`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        name: document.getElementById('userName').value.trim(),
        email: document.getElementById('userEmail').value.trim(),
        business: document.getElementById('userBusiness').value.trim(),
        text: document.getElementById('designText').value.trim(),
        desc: document.getElementById('designDesc').value.trim(),
        service: selectedService?.id||'',
        serviceName: selectedService?.name||'',
        styles: selectedStyles,
        locations: selectedLocations,
        designUrl: d.remoteUrl||d.url||'',
        designVariation: selectedDesignIdx
      })
    });
    document.getElementById('finalSummary').innerHTML = \`
      <h3>Your Request</h3>
      <div class="summary-row"><span class="label">Name</span><span class="val">\${document.getElementById('userName').value.trim()}</span></div>
      <div class="summary-row"><span class="label">Service</span><span class="val">\${selectedService?.name||'-'}</span></div>
      <div class="summary-row"><span class="label">Styles</span><span class="val">\${selectedStyles.length} selected</span></div>
    \`;
    goStep(5);
  } catch(e) {
    alert('Submission error. Try again or call 619-800-0949.');
    btn.disabled=false; btn.textContent='Submit Design Request (Free)';
  }
}

init();
</script>
</body>
</html>
`;

const WIDGET_JS = `// ================================================================
// MERCHY'S AI DESIGN BOT — Embeddable Widget Loader
// Usage: <script src="https://your-domain.com/widget.js"></script>
// Optional: window.MERCHY_API_URL = 'https://your-api.com';
// ================================================================
(function() {
  if (document.getElementById('merchys-widget-root')) return;

  var API = window.MERCHY_API_URL || (function() {
    var scripts = document.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) {
      if (scripts[i].src && scripts[i].src.indexOf('widget.js') !== -1) {
        return scripts[i].src.replace(/\\/widget\\.js.*\$/, '');
      }
    }
    return '';
  })();

  // Load Poppins font
  var fontLink = document.createElement('link');
  fontLink.href = 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap';
  fontLink.rel = 'stylesheet';
  document.head.appendChild(fontLink);

  // Floating button
  var btn = document.createElement('div');
  btn.id = 'merchys-widget-btn';
  btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg><span>Design Studio</span>';
  btn.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:99999;display:flex;align-items:center;gap:8px;padding:14px 22px;background:#111;color:#d4a017;font-family:Poppins,sans-serif;font-size:14px;font-weight:600;border:2px solid #d4a017;border-radius:50px;cursor:pointer;box-shadow:0 4px 20px rgba(0,0,0,0.3);transition:all 0.3s ease;';
  btn.onmouseover = function() { this.style.background = '#d4a017'; this.style.color = '#111'; };
  btn.onmouseout = function() { this.style.background = '#111'; this.style.color = '#d4a017'; };

  // Widget panel
  var panel = document.createElement('div');
  panel.id = 'merchys-widget-root';
  panel.style.cssText = 'position:fixed;bottom:90px;right:24px;width:400px;height:580px;z-index:99999;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.25);display:none;font-family:Poppins,sans-serif;';

  var iframe = document.createElement('iframe');
  iframe.src = API + '/widget.html';
  iframe.style.cssText = 'width:100%;height:100%;border:none;border-radius:16px;';
  iframe.allow = 'payment';
  panel.appendChild(iframe);

  document.body.appendChild(btn);
  document.body.appendChild(panel);

  var open = false;
  btn.onclick = function() {
    open = !open;
    panel.style.display = open ? 'block' : 'none';
    btn.querySelector('span').textContent = open ? 'Close' : 'Design Studio';
  };

  // Mobile: full screen
  function checkMobile() {
    if (window.innerWidth <= 520) {
      panel.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;width:100%;height:100%;z-index:99999;border-radius:0;overflow:hidden;box-shadow:none;display:' + (open ? 'block' : 'none') + ';font-family:Poppins,sans-serif;';
      iframe.style.borderRadius = '0';
    } else {
      panel.style.cssText = 'position:fixed;bottom:90px;right:24px;width:400px;height:580px;z-index:99999;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.25);display:' + (open ? 'block' : 'none') + ';font-family:Poppins,sans-serif;';
      iframe.style.borderRadius = '16px';
    }
  }
  window.addEventListener('resize', checkMobile);

  // Listen for close messages from iframe
  window.addEventListener('message', function(e) {
    if (e.data === 'merchys-close') { open = false; panel.style.display = 'none'; btn.querySelector('span').textContent = 'Design Studio'; }
  });
})();
`;

app.get('/', (req, res) => {
  res.type('html').send(WIDGET_HTML);
});

app.get('/widget.html', (req, res) => {
  res.type('html').send(WIDGET_HTML);
});

app.get('/widget.js', (req, res) => {
  res.type('application/javascript').send(WIDGET_JS);
});

// ---- Start server ----
app.listen(PORT, () => {
  console.log(`\n  Merchy's Design Bot running on http://localhost:${PORT}`);
  console.log(`  Asana:   ${ASANA_TOKEN ? 'Connected' : 'Not configured'}`);
  console.log(`  Recraft: ${RECRAFT_API_KEY ? 'Connected' : 'Not configured (using placeholders)'}`);
  console.log(`  Email:   ${emailTransporter ? 'Connected' : 'Not configured'}`);
  console.log(`  Stripe:  ${stripe ? 'Connected' : 'Not configured (vector paywall disabled)'}\n`);
});

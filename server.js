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
app.use(express.static(path.join(__dirname, 'public')));

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

// Merchy's design rules baked into every prompt
function buildDesignPrompt(formData, variation) {
  const decorationType = formData.decoration || 'DTF';
  const style = formData.style || 'badge';
  const text = formData.text || '';
  const desc = formData.desc || '';
  const business = formData.business || '';

  const baseRules = [
    'Black and white only, no color.',
    'Bold outlines, solid fills, clean separations.',
    'Centered and balanced composition.',
    'No gradients, no soft shading, no fine detail, no textures.',
    'Strong silhouette - recognizable at a glance.',
    'Typography integrated into the design, not placed on top.',
    `Print-ready for ${decorationType} production.`,
    'Vector-friendly with clean edges.',
    'Professional custom merchandise design.'
  ].join(' ');

  const styleMap = {
    badge: 'Circular, shield, or emblem-style crest with top arc text, center icon, and bottom text. Official and versatile.',
    icon_logo: 'Clean minimal scalable icon/logo mark. Single strong symbol, minimal or no text. Works at any size.',
    typography: 'Bold dominant lettering, stacked or arched text with minimal graphics. Text is the hero element.',
    mascot: 'Illustrated character or mascot as the hero with supporting text around it. Memorable and builds identity.',
    scene: 'Full scene illustration with foreground, background, and integrated text. Storytelling and premium feel.',
    badge_scene: 'Scene contained inside a circular badge frame with text wrapping around. Combines structure with storytelling.',
    diagram: 'Technical/structured layout like butcher cuts or blueprints with labeled sections and segmented areas.',
    vintage_script: 'Retro travel postcard style with script headline and supporting scene or icon. Nostalgic and wearable.',
    streetwear: 'Aggressive modern high-contrast bold graphic with minimal text. Trend-driven and eye-catching.',
    trade_tools: 'Crossed tools or industrial icons as centerpiece with supporting text. Communicates trade or industry instantly.',
    corporate_seal: 'Professional structured minimal emblem/seal with clean icon and balanced text. Trust and professionalism.',
    pattern: 'Repeating icons or shapes in a grid or scattered pattern layout. Scalable and modern.',
    monogram: 'Bold numbers, initials, or monogram as the dominant central element with minimal extras.',
    collage: 'Multiple elements combined in a layered controlled-chaos composition. High energy creative feel.',
    product_focus: 'Illustration of the product itself centered with supporting text. Clear and literal.',
    humor: 'Funny concept-driven visual with a punchline. Shareable and memorable.',
    heritage: 'Old-school established feel with dates, classic typography, and simple icon. Builds credibility.',
    line_art: 'Super clean thin controlled outlines with lots of negative space. Premium high-end aesthetic.',
    patch_first: 'Thick simplified bold-edge shapes designed for embroidery and stitching. Built for patches and hats.',
    event_series: 'Template-based scalable layout with consistent structure and swappable text. Perfect for annual events.'
  };

  // Support multiple styles (up to 3) - combine their descriptions
  const styles = Array.isArray(formData.styles) ? formData.styles : [style];
  const styleDescs = styles.map(s => styleMap[s]).filter(Boolean);
  const styleDesc = styleDescs.length > 0 ? styleDescs.join(' Also incorporate: ') : styleMap.badge;

  const variations = [
    'Variation A: Classic centered composition with the primary style as the dominant layout.',
    'Variation B: Alternative composition emphasizing typography and text placement.',
    'Variation C: Creative interpretation with the icon or illustration as the focal point.'
  ];

  const prompt = `Design a ${styleDesc} ${baseRules}

The design is for: ${desc || business || 'custom merchandise'}
${text ? `Text to include (EXACT SPELLING): ${text}` : ''}
${business ? `Business/brand: ${business}` : ''}

${variations[variation] || variations[0]}

This must look like a professional custom merchandise design ready for production printing.`;

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


// ---- Serve frontend ----
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---- Start server ----
app.listen(PORT, () => {
  console.log(`\n  Merchy's Design Bot running on http://localhost:${PORT}`);
  console.log(`  Asana:   ${ASANA_TOKEN ? 'Connected' : 'Not configured'}`);
  console.log(`  Recraft: ${RECRAFT_API_KEY ? 'Connected' : 'Not configured (using placeholders)'}`);
  console.log(`  Email:   ${emailTransporter ? 'Connected' : 'Not configured'}`);
  console.log(`  Stripe:  ${stripe ? 'Connected' : 'Not configured (vector paywall disabled)'}\n`);
});

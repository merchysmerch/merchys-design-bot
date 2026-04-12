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
    vintage: 'Vintage Americana style with retro feel, classic badge/emblem layout.',
    badge: 'Shield or circular crest/badge/emblem layout with arched text.',
    bold_type: 'Typography-driven design with bold impactful lettering as the main element.',
    illustration: 'Custom illustration with bold line art, simple iconic shapes.',
    minimal: 'Minimal clean design with simple icon and clean typography.',
    rubber_hose: '1920s rubber hose cartoon style with thick outlines, pie-cut eyes, simple shapes.',
    retro_sport: 'Retro athletic varsity sports style with block letters and classic elements.',
    hand_lettered: 'Hand-lettered script typography with crafted flowing letterforms.'
  };

  const styleDesc = styleMap[style] || styleMap.badge;

  const variations = [
    'Variation A: Classic centered emblem/badge composition with text arched around a central icon.',
    'Variation B: Bold typography-forward design with the main text as the dominant element.',
    'Variation C: Illustrative approach with a custom icon/character as the focal point and text integrated below.'
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
          style_id: null,
          substyle: 'none',
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
// SERVICES CATALOG (31 services from Merchy's graphic design page)
// ================================================================

const SERVICES_CATALOG = [
  { id: 'banner-design', name: 'Banner Design', priceRange: '$25-$100', category: 'print_design', desc: 'Custom designs for large-format banners suitable for events and promotions.' },
  { id: 'business-cards', name: 'Business Cards', priceRange: '$25-$75', category: 'brand_identity', desc: 'Professional and memorable business card designs to represent your brand.' },
  { id: 'digitizing', name: 'Digitizing', priceRange: '$30', category: 'apparel', desc: 'Converting existing graphics into digital formats for embroidery and other applications.' },
  { id: 'event-posters', name: 'Event Posters', priceRange: '$50-$125', category: 'print_design', desc: 'Eye-catching designs for concerts, festivals, and events.' },
  { id: 'flyer-design', name: 'Flyer Design', priceRange: '$25-$125', category: 'print_design', desc: 'Creative flyers to promote events, services, or products.' },
  { id: 'logo-design', name: 'Logo Design', priceRange: '$50-$100', category: 'brand_identity', desc: 'Creating unique and impactful logos to establish a strong brand identity.' },
  { id: 'menus', name: 'Menus', priceRange: '$100-$200', category: 'print_design', desc: 'Visually appealing and easy-to-read menus for restaurants, cafes, and events.' },
  { id: 'mockups', name: 'Mockups', priceRange: '$10 / Free with Purchase', category: 'digital', desc: 'High-quality mock-ups for apparel, packaging, and promotional materials.' },
  { id: 'product-labels', name: 'Product Labels', priceRange: '$100-$200', category: 'specialty', desc: 'Custom product label designs that attract consumer attention.' },
  { id: 'shirt-design', name: 'Shirt Design', priceRange: '$25-$200', category: 'apparel', desc: 'Custom t-shirt designs for corporate wear, events, and promotional campaigns.' },
  { id: 'signage', name: 'Signage', priceRange: '$50-$125', category: 'print_design', desc: 'Indoor and outdoor sign designs for businesses, events, and promotions.' },
  { id: 'social-media', name: 'Social Media Graphics', priceRange: '$25-$250', category: 'digital', desc: 'Engaging graphics for your social media platforms.' },
  { id: 'vehicle-wraps', name: 'Vehicle Wraps', priceRange: '$200-$300', category: 'specialty', desc: 'Creative and durable vehicle wrap designs for cars, trucks, and vans.' },
  { id: 'vectorizing', name: 'Vectorizing', priceRange: '$10-$50', category: 'specialty', desc: 'Transforming images into vector graphics for print and digital uses.' },
  { id: 'patch-design', name: 'Patch Design', priceRange: '$25-$75', category: 'apparel', desc: 'Custom patch artwork for embroidered, woven, and PVC patches.' },
  { id: 'packaging-design', name: 'Packaging Design', priceRange: '$75-$250', category: 'specialty', desc: 'Custom boxes, poly mailers, tissue paper, and branded packaging.' },
  { id: 'brand-identity', name: 'Brand Identity Packages', priceRange: '$200-$500', category: 'brand_identity', desc: 'Full brand kit: logo, business cards, social templates, and brand guidelines.' },
  { id: 'promo-item-design', name: 'Promotional Item Design', priceRange: '$25-$100', category: 'apparel', desc: 'Designs for koozies, tote bags, pens, lanyards, and all your swag needs.' },
  { id: 'embroidery-design', name: 'Embroidery Design', priceRange: '$25-$100', category: 'apparel', desc: 'Custom artwork created specifically for embroidery applications.' },
  { id: 'sticker-design', name: 'Sticker / Decal Design', priceRange: '$15-$50', category: 'specialty', desc: 'Die-cut stickers, vinyl decals, and bumper stickers for brands and events.' },
  { id: 'qr-code-design', name: 'QR Code Design', priceRange: '$10-$25', category: 'digital', desc: 'Branded and stylized QR codes for menus, cards, and marketing materials.' },
  { id: 'screen-print-seps', name: 'Screen Print Separations', priceRange: '$25-$50', category: 'apparel', desc: 'Color separations for screen printing: spot colors, simulated process, CMYK.' },
  { id: 'photo-editing', name: 'Photo Editing', priceRange: '$15-$75/hr', category: 'digital', desc: 'Background removal, retouching, product photography cleanup, and composites.' },
  { id: 'illustration', name: 'Illustration', priceRange: '$75-$300', category: 'specialty', desc: 'Custom hand-drawn and digital illustrations: mascots, characters, detailed artwork.' },
  { id: 'catalog-design', name: 'Catalog / Lookbook', priceRange: '$150-$400', category: 'print_design', desc: 'Multi-page product catalogs and lookbooks for brands with full product lines.' },
  { id: 'uniform-design', name: 'Uniform Program Design', priceRange: '$100-$300', category: 'apparel', desc: 'Full corporate uniform layouts: logo placements across polos, jackets, and hats.' },
  { id: 'certificate-design', name: 'Certificate / Award Design', priceRange: '$25-$75', category: 'print_design', desc: 'Professional certificates and awards for schools, sports leagues, and organizations.' },
  { id: 'invitation-design', name: 'Invitation / Event Stationery', priceRange: '$25-$100', category: 'print_design', desc: 'Wedding invitations, birthday, quinceañera, graduation, and event stationery.' },
  { id: 'infographic-design', name: 'Infographic Design', priceRange: '$50-$150', category: 'digital', desc: 'Visual infographics for marketing, training, social media, and presentations.' },
  { id: 'favicon-design', name: 'Favicon / App Icon', priceRange: '$15-$35', category: 'digital', desc: 'Browser favicons and app icons: perfect add-on with any logo project.' },
  { id: 'lettering-design', name: 'Lettering / Custom Typography', priceRange: '$50-$200', category: 'specialty', desc: 'Hand-lettered designs for merch, signage, and streetwear brands.' }
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
    styles: ['vintage', 'badge', 'bold_type', 'illustration', 'minimal', 'rubber_hose', 'retro_sport', 'hand_lettered'],
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

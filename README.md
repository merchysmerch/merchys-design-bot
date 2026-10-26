# Merchy's Design Studio

An art director pop-up that plugs into merchysmarket.com (customization step, product design pages, existing orders). The site already knows the client, so the studio starts straight on design questions and ends with approved reference designs, per-image notes, dislikes, a logo library entry, and a booked call with the artist. Only approved designs and the final brief reach the design team.

## Run it

```bash
npm install
cp .env.example .env     # fill in what you have; the rest falls back to demo mode
npm start                # http://localhost:3000
```

- `/` is the studio (add `?demo=1` to run it without a host page).
- `/demo.html` is a storefront stand-in with four entry points showing the plug-in contract.
- `/legacy` is the old intake widget.
- `/api/health` and `/api/studio/capabilities` show which integrations are live.

## Embed on the website

```html
<script src="https://YOUR-HOST/studio.js"></script>
<script>
MerchyStudio.open({
  client:  { id: '42', name: 'Jordan Smith', email: 'jordan@example.com', business: 'Smith Family BBQ', projectGid: '', poNumber: '' },
  context: { mode: 'product', product: '6 ft x 3 ft outdoor banner', decoration: 'Large format print' },   // or { mode: 'logo' }
  onComplete: function (r) { /* r.sessionId, r.selections[], r.libraryIds[], r.brief */ }
});
</script>
```

Or a button: `<button data-merchy-studio data-client='{...}' data-context='{...}'>Design it</button>`.
Set `window.MERCHY_API_URL` when the script is served from a different origin than the API.

`context.product` picks the question tree: apparel, banner/sign, drinkware, promo, stickers/labels, patches, business printing, packaging. Anything else gets the logo brief.

## The flow

1. Director interview. 3 questions at a time, tuned to the product. Powered by the Anthropic API when `ANTHROPIC_API_KEY` is set; otherwise the built-in question bank in `lib/questions.js`.
2. Style wall. Any number of the 20 styles.
3. One concept per style, generated in the background and shown as each finishes, titled by style.
4. Like the ones that work. For each liked style: a few questions plus notes, then 5 refinements (Recraft image-to-image) run in the background while the client moves to the next style. Skip is allowed.
5. Review board: each liked style as a header with original plus 5, numbered. Multi-select, per-image notes with a checklist (colors, size, shape, spacing, font, spelling, remove, add), plus a "what you do not want" field.
6. Book a call with the artist (Calendly single-use link when `CALENDLY_TOKEN` + `CALENDLY_EVENT_TYPE` are set, `CALENDLY_URL` as a plain link, or a slot request).
7. Finalize: approved designs go to the client's library, and the brief (approved only, notes, dislikes, skipped styles, call) posts to the project's Graphic Design task (PO/project GID) or a Presale task, plus a confirmation email.

Images are full color, flat, limited palette, built to vectorize (`lib/director.js` holds the rules and prompts).

## Knowledge base (what the models are taught)

`lib/knowledge.js` is the single place that teaches both the question model and the image model about Merchy's:

- Company, outcome ("finished art" defined), and the eight-step process
- Production limits per decoration method: DTF, screen print, embroidery, patches, DTG, sublimation, engraving, UV, large format, business print, stickers, drinkware, promo
- Product knowledge per tree (placements, imprint sizes, hierarchy)
- Style guide for all 20 styles: what it is, what it must do, what to avoid
- Universal design rules and a never-do list
- Stage strategy: what the interviewer must learn at the brief, style, and final stages

Edit that file to change how every prompt and every question is written. `lib/director.js` assembles it into the interviewer's instructions and into each image prompt (intended use, style, main image, feel, text spelled letter by letter, colors, production limits, edit keep/change lists, universal rules, exclusions).

The question model is Anthropic when `ANTHROPIC_API_KEY` is set, otherwise OpenAI chat when `OPENAI_API_KEY` is set (`OPENAI_CHAT_MODEL`, default `gpt-6-astra`), otherwise the built-in bank. `DIRECTOR_PROVIDER` forces one.

## Image engine

Order of preference: OpenAI, then Recraft, then demo previews. Set `IMAGE_PROVIDER` to force one.

- OpenAI: `OPENAI_API_KEY` from platform.openai.com with billing enabled. Default model `gpt-image-2.5-sunburst` at `high` quality (`OPENAI_IMAGE_MODEL`, `OPENAI_IMAGE_QUALITY` to change). Concepts use `/images/generations`; refinements use `/images/edits` with the liked image as the base so each round builds on it.
- Recraft: `RECRAFT_API_KEY`. Also provides SVG vectorizing when set, regardless of which engine generates.

## Logo library

Independent store at `data/library/<clientKey>.json` (clientKey = `client.id`, else email).

- `GET /api/studio/library/:clientKey` one client's items
- `GET /api/studio/library?since=<ms>` everything added since a timestamp, for the Merchy's Market sync job
- Items: `{ id, url, styleId, styleName, label, sessionId, business, addedAt, status }`

## Demo mode

Any `.env` value left blank or as `your_..._here` counts as not configured:

| Missing | Fallback |
|---|---|
| `OPENAI_API_KEY` and `RECRAFT_API_KEY` | Full-color SVG layout previews built from the client's answers |
| `ANTHROPIC_API_KEY` | Built-in question bank |
| `ASANA_ACCESS_TOKEN` | Brief saved to `submissions/` only |
| `CALENDLY_*` | In-studio slot request |
| `SMTP_PASS` | No email |

## Shareable static demo

```bash
node scripts/build-static-demo.js   # writes dist/index.html
```

The whole plug-in running in the browser with no server: host it anywhere or publish as a Claude artifact.

## Layout

```
server.js              Express app, Asana/email/Stripe helpers, legacy widget API
routes/studio.js       Studio v2 API (sessions, generation queue, refine, board, library, schedule, finalize)
lib/questions.js       Question bank and product decision trees
lib/director.js        Anthropic-backed art director, prompt builder, final brief
lib/generate.js        Recraft generation + image-to-image, demo SVG fallback
public/studio.html     Studio UI (7 stages)
public/studio.js       Host loader (overlay + postMessage contract)
public/demo.html       Storefront embed demo
public/widget.html     Legacy intake widget
scripts/               Static demo build
data/                  Sessions and library (gitignored)
```

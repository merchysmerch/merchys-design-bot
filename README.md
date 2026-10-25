# Merchy's Design Bot

Client-facing AI Design Studio widget. A customer picks a service, describes their design, gets 6 black and white production-style concepts, picks favorites, then either requests a vector file, saves the designs, or sends them to a product. Every submission is routed to Asana (Presale task or a comment on the matching post-sale project) and backed up locally.

## Run it

```bash
npm install
cp .env.example .env     # fill in keys you have; leave the rest
npm start                # http://localhost:3000
```

- `/` or `/widget.html` is the full-screen widget.
- `/demo.html` is a fake storefront with the widget embedded as a floating button, the way it will sit on merchysmarket.com.
- `/api/health` shows which integrations are live.

## Demo mode

The app never dead-ends. Any `.env` value left blank or as `your_..._here` is treated as not configured:

| Missing | What happens |
|---|---|
| `RECRAFT_API_KEY` | 6 local black and white SVG layout previews are generated from the client's own text. The widget shows a "Preview mode" banner. If Recraft is configured but every call fails, the same fallback kicks in and the first error is logged. |
| `ASANA_ACCESS_TOKEN` | Submission is saved to `submissions/*.json` only. |
| `STRIPE_SECRET_KEY` | "Get Vector File" becomes "Request Vector File" and sends a request to the team instead of opening checkout. |
| `SMTP_PASS` | No confirmation email. |

## Embed on a site

```html
<script src="https://YOUR-HOST/widget.js"></script>
```

Optional: set `window.MERCHY_API_URL = 'https://YOUR-HOST'` before the script tag if the widget is hosted on a different domain than the API.

## Integrations

- Recraft: `POST /v1/images/generations` with `model: recraftv3`, `style: vector_illustration`, black and white color controls. Vectorize uses `POST /v1/images/vectorize` with `image_url`.
- Asana: PO number match posts design notes as a comment on the project's Graphic Design task. No match creates a Presale task. Notes are plain text (no bold) per house rules.
- Stripe: Checkout session for the $25 vector file. `/api/vectorize-paid` verifies the session before vectorizing.

## Layout

```
server.js          Express API, Recraft, Asana, Stripe, email, demo fallback
public/widget.html The widget UI (4 steps + confirmation)
public/widget.js   Embeddable loader (floating button + iframe)
public/demo.html   Storefront embed demo
uploads/           Generated designs and reference uploads (gitignored)
submissions/       JSON backup of every submission (gitignored)
```

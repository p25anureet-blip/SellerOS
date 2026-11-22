# SellerOS

SellerOS helps Indian sellers manage product information in one place and prepare it for
e-commerce and quick-commerce channels (Amazon, Flipkart, Meesho, Myntra, Blinkit, Zepto,
Swiggy Instamart).

It is a college project: a fully working demo, with marketplace publishing simulated, real
CSV/Excel exports, real Gemini AI, and recommendations computed by algorithms.

**Stack:** Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · Supabase (Postgres, Auth) ·
Google Gemini

## Quick start (demo mode, no accounts needed)

```bash
npm install
cp .env.example .env.local     # DEMO_MODE=true is already set
npm run dev                    # open http://localhost:3000
```

Demo mode skips login (you are the demo seller "Iyer Naturals") and keeps products and listings
in the browser's localStorage, seeded with six sample products. **Settings → Demo data** resets
them.

To use the **AI Product Agent**, add at least one AI provider key to `.env.local` and restart
`npm run dev` (see [AI providers](#ai-providers)). Without a key the agent shows setup
instructions; it never shows made-up results.

## Features

| Area             | What works                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| Products         | Add, edit, delete, detail view, search, category/stock filters, sorting                                  |
| AI Product Agent | Upload MP4 → real Gemini (or DeepSeek) vision analysis → schema-validated JSON → review → save           |
| Listings         | Attribute mapping and validation for Amazon India, Flipkart, Blinkit; real CSV export; simulated publish |
| Pricing          | Cost, contribution margin and recommended price (capped at MRP); comparison across 7 channels            |
| Inventory        | Stock allocation across channels maximising expected contribution (marginal-value greedy, optimal)       |
| Dashboard        | Totals, listings, inventory overview, recent products, computed recommendations                          |

The Supabase foundation (auth, organizations, Row Level Security) is implemented and used when
`DEMO_MODE` is not `true`; see "Full setup" below.

## AI providers

The AI Product Agent has a provider selector. The default, **Auto**, uses **Gemini Flash Lite**
first and falls back to DeepSeek only if a DeepSeek key is configured. **Gemini alone is enough**:
it is the only key needed for the demo.

| Auto order   | Provider                          | Default model                  | How it sees the video                                                  |
| ------------ | --------------------------------- | ------------------------------ | ---------------------------------------------------------------------- |
| 1 (primary)  | Gemini (Google AI Studio)         | `gemini-flash-lite-latest`     | The video file via the Gemini Files API                                |
| 2 (optional) | DeepSeek                          | `deepseek-v4-flash-vision-exp` | 12 sharp frames extracted in your browser                              |
| not in Auto  | Qwen (Alibaba Cloud Model Studio) | `qwen3-vl-flash`               | The video file itself (Base64, up to 7 MB); larger videos as 12 frames |

DeepSeek switches on only when `DEEPSEEK_API_KEY` looks like a real DeepSeek key (`sk-…`). Qwen
is kept in the code for later; it is not part of Auto and appears in the selector only if
`QWEN_API_KEY` is set (Alibaba Cloud Model Studio sign-up is not available from India).

**Video size and hosting limits (Vercel):** Vercel functions accept request bodies up to 4.5 MB
and, on the Hobby plan, run for at most 300 s. So:

- **Videos up to 4 MB** are uploaded and Gemini analyses the **full video** (including audio).
- **Larger videos are never uploaded.** The browser extracts about 12 sharp frames (≈1 MB in
  total) and Gemini analyses those **frames** instead (no audio). The page says which path a
  video will take before you click Analyse, and the review screen says which one was used.
- The upload route declares `maxDuration = 300`. AI calls and retries stop starting after 270 s,
  so a slow request ends with a clear "ran out of time, click Retry" message rather than a platform
  timeout. If the video was uploaded, it stays stored at Gemini and Retry does not upload it again.

**Fallback rules (Auto):** SellerOS moves to the next provider only when another provider can
help: quota or rate limit (HTTP 429), no credit or overdue payment, unavailable model, overload
(503) or server error after 3 retries with backoff, or network failure. It does **not** fall back
for a rejected API key, a malformed request or an answer that fails schema validation; you see
the error and choose. The review screen always says which provider and model processed the video,
and which providers were skipped and why.

All keys are read only on the server (`src/lib/env/server.ts`) and are redacted from every error
message and log line.

### Gemini (primary)

Google AI Studio → **Get API key → Create API key**, then `GEMINI_API_KEY=…`. The default model
is `gemini-flash-lite-latest`. Run `npm run gemini:models` to see the models your key can use and
set `GEMINI_MODEL` to change it; the page's model dropdown can also switch per video.

### DeepSeek (optional fallback)

1. Sign up at [platform.deepseek.com](https://platform.deepseek.com) and **top up** a small
   prepaid balance (DeepSeek has no free tier; an empty balance returns HTTP 402).
2. **API keys → Create new API key**, then `DEEPSEEK_API_KEY=sk-…` in `.env.local`.
3. DeepSeek reads images only with its vision model. Check the
   [models page](https://api-docs.deepseek.com/quick_start/pricing) for the current image-capable
   model id; if it differs from the default, set `DEEPSEEK_MODEL`. A text-only model answers
   "does not support image", which SellerOS reports as an unavailable model.

### Qwen: Alibaba Cloud Model Studio (optional, manual only)

1. Create an account at [alibabacloud.com](https://www.alibabacloud.com) (international site)
   and complete account verification; a payment method is usually required.
2. Open **Model Studio** and select the **Singapore** region (top of the console). New accounts
   usually get a free token quota per model; the console shows it.
3. In the Model Marketplace, check that **qwen3-vl-flash** (and optionally **qwen3-vl-plus**) are
   available/activated.
4. **API Keys → Create API key**, then in `.env.local`: `QWEN_API_KEY=sk-…`.

**Regions:** keys only work in the region they were created in (a mismatch gives HTTP 401).
The default `QWEN_BASE_URL` is Singapore (`https://dashscope-intl.aliyuncs.com/compatible-mode/v1`).
For a US (Virginia) key use `https://dashscope-us.aliyuncs.com/compatible-mode/v1`; for China
(Beijing) `https://dashscope.aliyuncs.com/compatible-mode/v1`.

`QWEN_MODEL=qwen3-vl-plus` reads small print more accurately at a higher price. Select Qwen
manually in the page's provider selector; Auto never uses it.

### Verify each provider

```bash
npm run test:integration -- tests/integration/providers.test.ts
```

Each provider's test runs only if its key is set, sends a real request with a built-in label
video (`tests/fixtures/`), and passes only if the answer passes schema validation and reads the
brand, MRP and weight correctly.

**Privacy:** videos and frames are sent to the provider you choose: Alibaba Cloud (Singapore by
default), DeepSeek (servers in China) or Google.

## Full setup (Supabase)

### 1. Prerequisites

- Node.js 22 or newer (developed on Node 26)
- A free [Supabase](https://supabase.com) account
- A [Google AI Studio](https://aistudio.google.com) account for a Gemini API key

Docker is **not** needed. The app uses a hosted Supabase project.

### 2. Install

```bash
npm install
```

### 3. Create the Supabase project

1. In the Supabase dashboard, create a new project (any name, region close to you, e.g.
   Mumbai). Save the **database password** you choose.
2. **Authentication → Sign In / Providers → Email:** turn **off** "Confirm email" so demo
   sign-ups work instantly.
3. **Project Settings → API Keys:** copy the **publishable** key and the **secret** key.
   The project URL is shown under **Project Settings → Data API**.

### 4. Get a Gemini API key

In Google AI Studio choose **Get API key → Create API key**.

### 5. Configure environment variables

```bash
cp .env.example .env.local
```

Fill in every value in `.env.local`. This file is git-ignored; never commit it.

### 6. Create the database tables

```bash
npx supabase login           # opens the browser once
npm run db:link              # choose your project; asks for the database password
npm run db:push              # applies supabase/migrations/*.sql
npm run db:types             # regenerates src/types/database.ts from the live schema
```

### 7. Run

```bash
npm run dev
```

Open http://localhost:3000, create an account, and use **Settings → Test AI connection** to
confirm Gemini works.

## Scripts

| Command                    | What it does                                                |
| -------------------------- | ----------------------------------------------------------- |
| `npm run dev`              | Start the development server                                |
| `npm run build` / `start`  | Production build / serve it                                 |
| `npm run lint`             | ESLint                                                      |
| `npm run typecheck`        | Generate Next.js route types, then TypeScript check         |
| `npm test`                 | Unit tests (no network or credentials needed)               |
| `npm run test:integration` | Real tests against your Supabase project and the Gemini API |
| `npm run check`            | lint + typecheck + unit tests + build                       |
| `npm run format`           | Prettier                                                    |
| `npm run db:push`          | Apply new migrations to the linked Supabase project         |
| `npm run db:types`         | Regenerate database TypeScript types                        |

Run a single test file with `npx vitest run tests/unit/routes.test.ts`, or a single test by
name with `npx vitest run -t "safeRedirectPath"`.

## How it is organised

```
src/
  app/
    (auth)/          login and signup pages + their Server Actions
    (app)/           logged-in pages (dashboard, settings, upcoming sections)
    page.tsx         public landing page
  components/
    ui/              base components (shadcn/ui style)
    layout/          sidebar, navigation, user menu
  lib/
    auth.ts          "who is logged in / which organization" (data access layer)
    supabase/        Supabase clients for browser, server and proxy
    ai/              Gemini client
    env/             environment variable validation
    validation/      Zod schemas shared by forms and Server Actions
    marketplaces/    connector interface (simulated connector arrives in Phase 3)
    jobs/            job interface for slow AI work (Phase 2)
  proxy.ts           refreshes the login session; redirects logged-out visitors
supabase/migrations/ every database change, in order
tests/unit/          fast tests for pure logic
tests/integration/   tests against the real hosted services
```

### Security model

Every organization's data is separated by **Row Level Security** in Postgres. Each business
table has an `organization_id`. Policies allow access only when
`public.is_org_member(organization_id)` is true for the logged-in user. The anonymous role has
no access to any table. `tests/integration/rls.test.ts` checks this against the real database
with three test users.

## Troubleshooting

- **`Invalid environment configuration`**: a value in `.env.local` is missing. The message
  lists which one.
- **Gemini check says the model was not found**: run `npm run gemini:models` to list the models
  your key can use, then set `GEMINI_MODEL` in `.env.local` (the default is
  `gemini-flash-latest`) and restart.
- **"Gemini is overloaded (HTTP 503)"**: Google is short of capacity. SellerOS has already
  retried 3 times with backoff. The video stays stored at Gemini for 48 hours, so you can click
  **Retry**, or **Try** another model, without uploading again.
- **"API key hit its Gemini quota (HTTP 429)"**: this is a limit on your key (per minute or per
  day), not an outage. Wait for the countdown, or try another model, which has its own quota.
- **`npx shadcn add …` fails with `ECONNRESET`**: some networks block `ui.shadcn.com`. The
  components in `src/components/ui` are plain source files and can be added by hand.
- **Free Supabase projects pause after about a week of inactivity**: open the dashboard and
  click "Restore" before a demo.

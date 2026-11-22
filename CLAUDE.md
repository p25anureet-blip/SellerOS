# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Project

SellerOS is a **college project** that must work as a full end-to-end demo: a PIM for Indian
sellers, Gemini video → attribute extraction, marketplace listing generation, and pricing and
inventory recommendations. Optimise for working features, good UX and a reliable schema over
production infrastructure, but keep modules swappable so it can grow into a SaaS. Hard rules
from the project owner:

- Marketplace **publishing is simulated**, but attribute mapping and CSV/Excel export must
  really work.
- Gemini calls are **always real**, never mocked, including in integration tests.
- Recommendations come from **actual calculations or optimisation**. An LLM may only explain
  results.
- No extra infrastructure (no job queues, no Docker). Slow work runs in-request behind the
  `src/lib/jobs` interface.
- Current priority is a **working demo MVP in DEMO_MODE** (see below). Don't delete or rebuild
  existing code; keep the Supabase paths intact for later.
- Never invent credentials. If keys or external setup are needed, stop and ask.
- After each feature: run the app, check for errors, run `npm run check`.

## DEMO_MODE (current default)

`DEMO_MODE=true` in `.env.local` (re-exported as `NEXT_PUBLIC_DEMO_MODE` by `next.config.ts`;
read via `DEMO_MODE` in `src/lib/demo.ts`):

- `lib/supabase/proxy.ts` skips Supabase entirely; `/login` and `/signup` redirect to `/dashboard`.
- `lib/auth.ts` returns the fixed `DEMO_USER` / `DEMO_ORGANIZATION`. Supabase settings are read
  lazily (`getSupabaseConfig()`), so no Supabase env vars are needed in demo mode.
- Product and listing data lives in the browser: `lib/store/app-store.ts` (localStorage +
  `useSyncExternalStore`, seeded from `lib/store/seed.ts`). Pages read it via `useAppState()` or
  `<StoreGate>`, so they are client components. All writes go through the store's functions,
  which is the seam for a future Supabase-backed store.
- `GEMINI_API_KEY` is optional at startup; AI features check `isGeminiConfigured()` and show
  setup instructions (`GEMINI_SETUP_MESSAGE`), never fake output.

## Commands

```bash
npm run dev                  # dev server (needs .env.local)
npm run check                # lint + typecheck + unit tests + build: run before declaring done
npm test                     # unit tests only (no network)
npm run test:integration     # real Supabase + Gemini tests (needs .env.local incl. SUPABASE_SECRET_KEY)
npx vitest run tests/unit/routes.test.ts      # one file
npx vitest run -t "safeRedirectPath"          # tests matching a name
npm run db:push              # apply new supabase/migrations/*.sql to the hosted project
npm run db:types             # regenerate src/types/database.ts after every migration
```

Env vars are validated on server start (`src/instrumentation.ts`): Supabase vars are required
only when `DEMO_MODE` is not `true`. `TEST_VIDEO_PATH` enables the real Gemini video
integration test.

Headless-browser checks: Edge's `--virtual-time-budget` screenshot mode hangs on some pages
(not an app bug). Drive Edge through the DevTools protocol in real time instead.

## Architecture

- **Next.js 16 with `cacheComponents` + `partialPrefetching` on.** Anything that reads cookies
  or the session (including `getCurrentUser()` / `getCurrentOrganization()`) must render inside
  `<Suspense>`, and must not be awaited at the top level of a layout. Keep the static shell
  static and push dynamic reads into small async components (see `src/app/(app)/layout.tsx`).
  Middleware is called **proxy** in this version (`src/proxy.ts`). After a mutation in a Server
  Action, use `refresh()` from `next/cache`. Read `node_modules/next/dist/docs/` before using
  any unfamiliar Next API.
- **Auth flow:** `src/proxy.ts` → `lib/supabase/proxy.ts` refreshes the Supabase session and
  does routing-only redirects (`lib/routes.ts` defines public/auth pages and
  `safeRedirectPath`). Real authorization is the data access layer `src/lib/auth.ts`, which
  every page and action calls, plus RLS in the database. Server Actions must re-check auth
  themselves.
- **Supabase clients:** `lib/supabase/client.ts` (browser), `lib/supabase/server.ts` (server,
  per request, acts as the user so RLS applies). No service-role/secret client exists in app
  code; only `tests/integration/helpers.ts` uses the secret key.
- **Multi-tenancy:** each user gets one organization at sign-up through the `handle_new_user()`
  trigger on `auth.users` (reads `full_name` / `organization_name` from user metadata).
  `getCurrentOrganization()` picks the user's first membership.
- **Forms:** Client Component + `useActionState(serverAction, initialFormState)`. Actions
  return `FormState` (`lib/validation/form-state.ts`) and validate with the same Zod schemas in
  `lib/validation/`. Never echo passwords back in `values`.
- **Gemini:** `lib/ai/gemini.ts` (server-only, `@google/genai` 2.x, model from `GEMINI_MODEL`,
  default `gemini-flash-latest`). Resilience lives in pure, unit-tested modules:
  `lib/ai/errors.ts` (`classifyGeminiError`: 503 `overloaded` and 5xx `server_error` are
  retryable, 429 `quota` is not; plus `redactSecrets`, so the key never reaches messages or
  logs), `lib/ai/retry.ts` (`withRetry`, max 3 retries with jittered exponential backoff; the
  SDK's own retries stay off), and `lib/ai/model-choice.ts` (ranks alternatives from
  `models.list()`, which `listAvailableModels()` caches for 10 minutes). `npm run gemini:models`
  lists the models the key can use.
- **Pure domain logic (unit-tested, no React):** `lib/catalog/product.ts` (product model + form
  Zod schema), `lib/pricing/calculator.ts` (P* = C / (1 − commission − margin), capped at
  MRP), `lib/inventory/allocation.ts` (marginal-value greedy allocation under Normal demand,
  proven optimal against brute force in tests), `lib/marketplaces/mapping.ts` (per-marketplace
  column templates: source attribute, required rule, transform; `generateListing()` returns the
  row, its issues and the channel price), `lib/export/csv.ts`, `lib/insights/recommendations.ts`.
  UI pages compose these; put new business rules here, not in components.
- **AI providers (multi-provider):** `lib/ai/providers/`. `types.ts` defines
  `VideoExtractionProvider` and the errors (`ProviderError`, `ExtractionFailedError`,
  `ProviderNotConfiguredError`). The adapters are `qwen.ts` (Model Studio compatible-mode:
  a Base64 `video_url` up to 7 MB, otherwise frames), `deepseek.ts` (frames only) and
  `gemini-provider.ts` (wraps the unchanged Gemini code). Qwen and DeepSeek share
  `openai-compatible.ts`, which uses plain fetch, JSON mode with the schema in the prompt
  (`lib/ai/prompt.ts`), a one-time retry without `response_format` if it is unsupported, and
  `classifyProviderError`. `orchestrate.ts` holds the pure Auto rules: Gemini (default model
  `gemini-flash-lite-latest`) → DeepSeek, which is active only with a plausible `sk-…` key
  (`isPlausibleDeepSeekKey`). Qwen is not in Auto: it can be selected manually and appears only
  when `QWEN_API_KEY` is set. Auto falls back only on `FALLBACK_KINDS`, never on `auth`, `invalid_request` or invalid
  output. Frames are extracted in the browser by `lib/video/frames.ts` (about 12, the sharper of
  2 candidates per slot) and sent as multipart `frames` + `frameTimes`. `ExtractionResponse`
  adds `provider`, `inputMode` and `fallbacks` to the unchanged extraction schema. Keys are read
  only in `lib/env/server.ts`; `aiSecrets()` feeds redaction. Real per-provider tests live in
  `tests/integration/providers.test.ts`, each skipped without its key.
- **AI Product Agent:** browser uploads to `POST /api/ai/extract-product` (multipart; `/api` is
  excluded from the proxy matcher because the proxy caps bodies at 10 MB) → the selected
  provider. For Gemini: `lib/ai/product-extraction.ts` uploads to the Gemini Files API, polls until ACTIVE, calls
  `generateContent` with a `responseSchema`, validates with `extractionSchema`
  (`lib/ai/extraction-schema.ts`), and deletes the file. On a failure that a retry could fix,
  the Gemini file is kept and returned as `upload` in `ExtractErrorBody`
  (`lib/ai/extraction-api.ts`). The UI then retries with a JSON `{ fileName, video, model? }`
  POST, without re-uploading, or calls `DELETE ?file=` to discard. `lib/ai/extraction-to-product.ts`
  maps the result into the shared `ProductForm` for review.
- **Vercel limits (deployment target):** request bodies are capped at 4.5 MB and Hobby functions
  at 300 s.
  - **Upload size:** `lib/ai/upload-plan.ts` (pure, tested) decides the upload. Videos of 4 MB or
    less are sent as the file. Larger videos send only frames plus a `videoMeta` field, and
    Gemini reads them through `extractProductFromFrames` (inline images, no Files API).
    `lib/ai/upload-input.ts` parses both request shapes.
  - **Time budget:** the route exports `maxDuration = 300` as a literal, and `requestDeadline()`
    (`lib/ai/retry.ts`) gives a 270 s budget. Every Gemini, Qwen and DeepSeek call takes
    `timeoutWithin(…, deadline)`, `withRetry` won't start a retry it can't finish, and Auto won't
    start another provider. The result is a `time_budget` error from `timeBudgetError()` that
    says what Retry reuses.
  - **SDK quirk:** do **not** pass `httpOptions` to `files.upload` (`@google/genai` 2.32
    then uploads to a URL that returns 404). Use `abortSignal` instead.
- **Extension points:** `lib/marketplaces/types.ts` (`MarketplaceConnector`) and
  `lib/jobs/types.ts` (`JobHandler`) are interfaces for real integrations and queued jobs later.

## Database conventions (`supabase/migrations/`)

- Never edit an applied migration. Add a new file named `YYYYMMDDHHMMSS_description.sql`, then
  `npm run db:push` and `npm run db:types`. `src/types/database.ts` is generated; don't
  hand-edit it.
- Every new business table: `organization_id uuid not null references organizations on delete
cascade`, `enable row level security`, policies using `public.is_org_member(organization_id)`
  (or `public.has_org_role(...)` for writes), and explicit `grant`s to `authenticated` only (the
  foundation migration revokes defaults; anon gets nothing). Use column-level `grant update
(...)` to protect columns like `created_by`.
- `security definer` functions must `set search_path = ''` and fully qualify names.
  `tests/unit/migrations.test.ts` enforces RLS-on-every-table and this rule.
- Mirror DB check constraints in Zod (e.g. `GSTIN_PATTERN` in `lib/validation/organization.ts`).
- Add RLS cases to `tests/integration/rls.test.ts` for every new table: cross-tenant read,
  cross-tenant write, member vs owner, anon.

## Environment quirks

- `ui.shadcn.com` is blocked on the developer's network, so `npx shadcn add` fails. Write
  components by hand in `src/components/ui/` following the existing shadcn style (`radix-ui`
  unified package, `cn()`, `data-slot`). `components.json` is kept for when the CLI works.
- npm ≥ 11 install-script gating: unneeded scripts are denied in `package.json` `allowScripts`.
- Dependencies are pinned to exact versions. Avoid versions published in the last ~2 weeks.
- Windows + PowerShell/Git Bash. The repo lives in OneDrive, so file-lock errors (`EPERM`) on
  `.next/` or `node_modules/` usually come from OneDrive syncing.

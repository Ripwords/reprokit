import tailwindcss from "@tailwindcss/vite"

export default defineNuxtConfig({
  compatibilityDate: "2026-04-17",
  modules: ["@nuxt/ui", "@nuxt/fonts", "nuxt-security", "@vueuse/nuxt", "nuxt-charts"],
  css: ["~/assets/css/tailwind.css"],
  // Scan source at build time and bundle every `<UIcon>` / `i-*` reference
  // into the client JS. Without this, icons fall through to `@nuxt/icon`'s
  // `/api/_nuxt_icon/:collection.json?icons=*` runtime endpoint — which
  // crashes with `TypeError: Invalid URL` because our graph has both
  // `h3@1.15` (Nitro) and `h3@2.0.1-rc` (via @nuxt/telemetry → ofetch@2),
  // and @nuxt/icon 2.2.1's handler was compiled against h3 v2's Request
  // shape while the wrapping event is still h3 v1. Bundling at build time
  // sidesteps the broken server path entirely. The three `@iconify-json/*`
  // collections we installed (heroicons, lucide, simple-icons) feed this.
  icon: {
    clientBundle: {
      scan: true,
      includeCustomCollections: true,
    },
  },
  fonts: {
    families: [
      { name: "Geist", provider: "fontsource", weights: ["400", "500", "600", "700"] },
      { name: "JetBrains Mono", provider: "fontsource", weights: ["400", "500"] },
    ],
  },
  app: {
    head: {
      title: "Repro",
      titleTemplate: "%s · Repro",
      link: [
        {
          rel: "icon",
          type: "image/svg+xml",
          href: "/icon-light.svg",
          media: "(prefers-color-scheme: light)",
        },
        {
          rel: "icon",
          type: "image/svg+xml",
          href: "/icon-dark.svg",
          media: "(prefers-color-scheme: dark)",
        },
        { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32x32.png" },
        { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16x16.png" },
        { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
        { rel: "manifest", href: "/manifest.webmanifest" },
      ],
    },
  },
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      include: ["better-auth/vue", "better-auth/client/plugins", "rrweb-player", "shiki"],
    },
    server: {
      // Allow an externally-tunnelled host to reach the dev server. Set
      // DEV_TUNNEL_HOST in your local .env (e.g. `repro-dev.yourdomain.com`)
      // — defaults to an empty allowlist in production/CI so no accidental
      // hostname ever ships in the repo.
      allowedHosts: process.env.DEV_TUNNEL_HOST ? [process.env.DEV_TUNNEL_HOST] : [],
    },
  },

  // nuxt-security defaults are fine for the dashboard itself (same-origin),
  // but its `xssValidator` consumes POST bodies in a way that trips up
  // better-auth's catch-all handler (/api/auth/sign-in/social lands with
  // `[body] Invalid input: expected object, received undefined`), and its
  // default CORS origin is the dashboard's own URL — which blocks the
  // cross-origin SDK POSTs to /api/intake/*. Scope the middleware down.
  security: {
    // Keep global defaults on; per-route overrides do the real work below.
    // (Shiki on /settings/install runs on its JavaScript engine, not WASM, so
    // we don't need to relax CSP's script-src for WebAssembly.)
    //
    // Test env: disable the global per-IP rate limiter. The integration test
    // suite hammers many endpoints from a single origin in under a minute,
    // which trips the default bucket (150 req / 5 min) and cascades 429s
    // through unrelated test files. The app's own rate-limit.ts / rate-limit-pg.ts
    // library continues to protect endpoints that actually need it (magic-link,
    // intake). CI + local test runs set DISABLE_NUXT_SECURITY_RATE_LIMIT=1.
    //
    // Can't gate on NODE_ENV: `nuxt dev` forcibly sets NODE_ENV to "development"
    // at startup (before nuxt.config is evaluated), so any inherited
    // NODE_ENV=test from the parent shell is lost. A custom env var survives
    // the Nuxt init sequence unchanged.
    // The env-var escape hatch is ONLY honoured outside production — if it
    // somehow leaks into a prod .env the global rate limiter stays on.
    rateLimiter:
      process.env.NODE_ENV !== "production" && process.env.DISABLE_NUXT_SECURITY_RATE_LIMIT === "1"
        ? false
        : undefined,
    // CSP: nuxt-security's default img-src is ['\'self\'', 'data:'] which
    // blocks GitHub user avatars (avatars.githubusercontent.com/u/<id>?v=4)
    // rendered in the assignees picker and comment author rows. Extend
    // img-src — not override — so we keep 'self' + data: and add the
    // GitHub CDN host. Allow https: broadly as well so user-supplied avatar
    // URLs from other identity providers (when we add Jira/Linear) don't
    // each require a code change. `blob:` is required by the comment
    // composer's pending-attachment thumbnails — `URL.createObjectURL(file)`
    // produces blob: URLs, which the browser silently refuses to render
    // without the scheme listed here (the `<img>` falls through to its alt
    // text and shows a broken-image glyph).
    headers: {
      contentSecurityPolicy: {
        "img-src": ["'self'", "data:", "blob:", "https:"],
      },
    },
  },
  routeRules: {
    // Every authenticated API response is user-specific and must not be
    // cached by intermediaries. Without this, a Cloudflare proxy in front
    // of the dashboard can serve a stale GET `/api/projects/:id/integrations/github`
    // after the user PATCHes a toggle — the UI reads back the pre-save
    // value and silently regresses to what looked like "the toggle keeps
    // turning itself off." `no-store` forbids any shared or browser cache
    // from holding the response at all.
    //
    // Specifically scoped to /api/** so we don't break static asset
    // caching (Nuxt's /_nuxt/ bundles, /sdk/repro.iife.js, favicons, etc.).
    "/api/**": {
      headers: {
        "Cache-Control": "private, no-store",
      },
    },
    // better-auth owns request/response shape for every /api/auth/* call —
    // rate-limits, validates, and sets session cookies itself. Letting
    // nuxt-security middleware touch bodies or throttle here causes subtle
    // auth-flow breakage (social sign-in, magic-link verify, session
    // revoke). Turn the security stack off for this prefix.
    "/api/auth/**": {
      security: {
        xssValidator: false,
        requestSizeLimiter: false,
        rateLimiter: false,
        corsHandler: false,
      },
    },
    // SDK intake — customer browsers POST from whatever origin their site
    // is served from, so nuxt-security's default same-origin CORS would
    // block them. The intake handler runs its own origin-allowlist CORS
    // (see server/lib/intake-cors.ts): it emits ACAO reflecting the exact
    // origin *after* validating against the project's allowedOrigins, and
    // deliberately withholds ACAO on reject so cross-origin scripts can't
    // read error bodies as an enumeration oracle. A blanket `origin: "*"`
    // here would defeat that oracle protection, so disable nuxt-security's
    // corsHandler entirely and let the handler own CORS. xssValidator is
    // also off because intake bodies are structured JSON + base64 blobs.
    "/api/intake/**": {
      security: {
        corsHandler: false,
        xssValidator: false,
      },
    },
    // GitHub webhook — nuxt-security's per-IP rate limiter would block
    // GitHub's exponential-backoff delivery retries during restarts /
    // deployments. The webhook handler enforces its own defence-in-depth
    // (5 MB body cap → HMAC-SHA256 signature → delivery dedupe →
    // installation allowlist), so the nuxt-security layer adds no
    // meaningful protection here. requestSizeLimiter is also off because
    // the handler reads and checks body size itself.
    "/api/integrations/github/webhook": {
      security: {
        rateLimiter: false,
        requestSizeLimiter: false,
        xssValidator: false,
      },
    },
  },
  nitro: {
    experimental: {
      tasks: true,
    },
    // Scheduled tasks run on Nitro/croner. The 6-field form (`* * * * * *`)
    // accepts seconds; the 5-field form uses minutes.
    //
    // `github:sync` is now the SAFETY NET, not the hot path. Dashboard
    // writes trigger the same sync runner in-process (see
    // `server/lib/github-sync-runner.ts`), so end-to-end latency from
    // PATCH to GitHub is sub-second on the happy path. This cron only
    // exists to (a) recover rows stuck in 'syncing' after a worker
    // crash, and (b) retry rows whose `next_attempt_at` has caught up
    // with the exponential backoff.
    //
    // Dev keeps a 10-second tick so a developer reproducing a retry
    // scenario doesn't wait a minute to see the next attempt. Prod at
    // 60s keeps DB load predictable — in-process triggers carry the
    // happy-path traffic either way.
    scheduledTasks: {
      [process.env.NODE_ENV === "production" ? "*/1 * * * *" : "*/10 * * * * *"]: ["github:sync"],
      // Daily at 03:00 UTC — cleans up any unconsumed expired write-lock rows.
      "0 3 * * *": ["github:cleanup-write-locks"],
    },
    routeRules: {
      // Baseline security headers for every dashboard response.
      // - X-Frame-Options: DENY   → prevents the dashboard UI from being framed (clickjacking).
      //                             Safe for the intake API because it returns JSON, not embeddable HTML.
      // - X-Content-Type-Options  → disables MIME sniffing.
      // - Referrer-Policy         → avoids leaking full URLs to third-party origins.
      // HSTS is intentionally omitted here — it should be emitted by the terminating
      // reverse proxy (Caddy / Nginx / Cloudflare) where HTTPS actually terminates.
      // CSP is deferred — a correct policy requires a full inventory of every script/style
      // source and a too-strict policy breaks the app; too-permissive is security theater.
      "/**": {
        headers: {
          "X-Frame-Options": "DENY",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "strict-origin-when-cross-origin",
        },
      },
    },
  },
})

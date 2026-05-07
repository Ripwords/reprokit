# MCP OAuth Server — Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase 1–3 to users — VitePress documentation, `MCP_ENABLED=true` default, plus the two minor cleanups flagged by the Phase 3 final review (N+1 in connections list, comment Zod schema in shared).

**Architecture:** Documentation goes into `docs/guide/mcp.md` (end-user) and `docs/self-hosting/mcp.md` (operator: env vars, migration `0017`, security). The flag flip is a one-line change in `env.ts`. The N+1 fix uses a single `MAX(createdAt) GROUP BY clientId` subquery. The shared-schema move is a textbook lift from `comments/index.post.ts` to `packages/shared/src/reports.ts`.

**Tech Stack:** VitePress, drizzle-orm, Zod. No new dependencies. oxlint pinned at 1.59.0.

**Spec:** [`docs/superpowers/specs/2026-05-06-mcp-oauth-server-design.md`](../specs/2026-05-06-mcp-oauth-server-design.md) §11 (rollout) + §12 implementation sequence.

**Predecessors:**
- Phase 1: `2026-05-06-mcp-oauth-server-phase-1.md`
- Phase 2: `2026-05-06-mcp-oauth-server-phase-2.md`
- Phase 3: `2026-05-07-mcp-oauth-server-phase-3.md`

This is the final phase. After Phase 4, the MCP feature is shipped.

---

## File Structure

| Path | Status | Responsibility |
|---|---|---|
| `docs/guide/mcp.md` | create | End-user docs: connect each client, what tools do, revoke. |
| `docs/self-hosting/mcp.md` | create | Operator docs: `MCP_ENABLED` env var, migration `0017`, security model summary. |
| `docs/.vitepress/config.ts` | modify | Add both new pages to sidebar. |
| `apps/dashboard/server/lib/env.ts` | modify | Flip `MCP_ENABLED` default `false` → `true`. |
| `apps/dashboard/server/api/me/mcp-connections.get.ts` | modify | Replace N+1 last-used query with a single GROUP BY. |
| `packages/shared/src/reports.ts` | modify | Export new `CreateCommentBody` Zod schema. |
| `apps/dashboard/server/api/projects/[id]/reports/[reportId]/comments/index.post.ts` | modify | Import + use shared schema (drop inline copy). |

No new dependencies, no new tests. Phase 4 is pure productization + cleanup.

---

## Conventions

- Conventional Commits, one concern per commit. The shared-schema move + endpoint update should be ONE commit (they're a single semantic change).
- VitePress files use the existing project tone: factual, plain English, code blocks with copy-paste config.
- `bun test` for tests (no new tests in this plan, but the shared-schema change must not break existing comment tests).

---

## Task 1: End-user docs — `docs/guide/mcp.md`

**Files:**
- Create: `docs/guide/mcp.md`

User-facing page covering: what MCP enables, how to connect Claude Desktop / Cursor / ChatGPT / generic clients, what tools are available, how to revoke access, troubleshooting.

- [ ] **Step 1: Create the page.**

```markdown
---
title: AI assistants (MCP)
---

# AI assistants (MCP)

Repro exposes your tickets to AI assistants through the [Model Context Protocol](https://modelcontextprotocol.io). Once connected, an assistant like Claude Desktop or Cursor can read your reports, summarize triage, change ticket status, post comments, and link issues to GitHub — all using the same permissions you have in the dashboard.

## What you can do

Connected assistants can:

- **Read tickets and reports** — title, description, status, priority, tags, page context, system info, console + network logs, and a textual replay timeline.
- **Update triage** — change status, priority, tags, assignees (GitHub logins), and milestones.
- **Comment on tickets** — markdown comments, mirrored to GitHub if the ticket is linked.
- **Link / unlink GitHub issues** — connect a Repro ticket to an existing GitHub issue.

Assistants run **as you** — they can only read or change projects you're a member of, and they're bound by the same role permissions (viewer / manager / developer / owner). They cannot manage settings, members, or integrations.

## Connect an assistant

Sign in to your dashboard and visit **Settings → AI assistants (MCP)**. The page shows ready-to-paste configuration for each major client.

### Claude Desktop / Claude Code

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or the equivalent on your platform:

```json
{
  "mcpServers": {
    "repro": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://<your-repro>/api/mcp"]
    }
  }
}
```

Restart Claude Desktop. The first time a tool is called, your browser opens to the Repro sign-in page (if you're not already signed in), then a consent screen — click **Allow**.

### Cursor

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "repro": {
      "url": "https://<your-repro>/api/mcp",
      "transport": "streamable-http"
    }
  }
}
```

### ChatGPT custom connectors

Paste your dashboard URL into the connector dialog. ChatGPT auto-discovers the OAuth endpoints and walks you through sign-in.

### Other MCP clients

Any client that supports the Streamable HTTP transport works. The `mcp-remote` shim is a universal fallback:

```bash
npx mcp-remote https://<your-repro>/api/mcp
```

## How sign-in works

When an assistant first calls a tool:

1. Your browser opens to the Repro sign-in page (skip if already signed in).
2. After signing in, you see a consent screen listing the permissions the assistant is requesting.
3. Click **Allow** to grant access. The assistant receives a token and can call tools on your behalf.

Tokens expire after 1 hour. The assistant refreshes them automatically without prompting you again — until you disconnect.

## Revoking access

Visit **Settings → AI assistants (MCP)** and click **Disconnect** next to the assistant you want to revoke. This:

- Deletes the consent grant (next sign-in will re-prompt for permission).
- Invalidates the assistant's active tokens immediately.

You can disconnect any time without warning the assistant — it'll just start getting authentication errors.

## Troubleshooting

**The assistant says "401 Unauthorized" repeatedly.**
You disconnected it. Re-add the configuration above and reconnect.

**Browser opens but the consent page is blank.**
Confirm you're signed into the dashboard in the same browser. The consent flow uses your dashboard session.

**Tools can't see one of my projects.**
The assistant only sees projects you're a member of. Add yourself to the project in Settings → Members.

**Updates fail with "GitHub-only feature".**
Assignees and milestones are mirrored from GitHub, so they require a connected GitHub integration on the project. Set this up in Settings → Integrations.

## Privacy and security

- Captured cookies are **never** included in `repro_get_ticket`. To fetch them, an assistant must explicitly call the separate `repro_get_ticket_cookies` tool, and the tool's description warns about session tokens.
- Raw replay event streams are capped at 200 KB unless the assistant explicitly asks for the full payload.
- Every change made through MCP is recorded with the connecting client's identity (e.g. "Claude Desktop") in the audit trail.
- Assistants cannot delete tickets, change project settings, or manage members.

For the full security model see the [self-hosting docs](/self-hosting/mcp).
```

> Replace the `<your-repro>` placeholders with the actual instance URL when adapting per-deployment. The dashboard's `/settings/mcp` page does this substitution dynamically; the docs use a placeholder so they read sanely on the public site.

- [ ] **Step 2: Commit.**

```bash
git add docs/guide/mcp.md
git commit -m "docs(mcp): add user guide for connecting AI assistants"
```

---

## Task 2: Operator docs — `docs/self-hosting/mcp.md`

**Files:**
- Create: `docs/self-hosting/mcp.md`

Operator-focused page covering env vars, migration `0017`, and the security model summary.

- [ ] **Step 1: Create the page.**

```markdown
---
title: AI assistants (MCP)
---

# AI assistants (MCP)

Repro can act as an OAuth 2.1 authorization server and an MCP resource server, letting AI assistants (Claude Desktop, Cursor, ChatGPT, …) connect to your instance through a per-user OAuth flow. This page covers the operator-side concerns: enabling it, the database migration, and the security model.

## Enabling MCP

Set `MCP_ENABLED=true` in your environment. From v0.6.0 this is the default; in v0.5.x it required an explicit opt-in.

```bash
MCP_ENABLED=true
```

When the flag is off, the `/api/mcp` endpoint returns 404, the `/.well-known/oauth-authorization-server/api/auth` discovery endpoint returns 404, and the better-auth `oauth-provider` plugin is not loaded. Existing dashboard auth (magic link, GitHub OAuth) is unaffected.

## Tunables

| Variable | Default | Purpose |
|---|---|---|
| `MCP_ENABLED` | `true` | Master toggle. Set to `false` to disable MCP entirely. |
| `MCP_ACCESS_TOKEN_TTL_SECONDS` | `3600` (1h) | How long an access token is valid before refresh. Shorter is safer; longer reduces token-refresh chatter. |
| `MCP_RATE_LIMIT_PER_USER_PER_MINUTE` | `600` | Per-user rate cap on `/api/mcp`. AI clients are chatty — leave this generous unless you see abuse. |

`BETTER_AUTH_URL` and `BETTER_AUTH_SECRET` are reused; no new auth secrets to manage.

## Database changes

Migration `0017_cute_toxin` adds two columns and the `oauth-provider` plugin's tables (jwks, oauth_client, oauth_access_token, oauth_refresh_token, oauth_consent — added earlier in `0016`). The two new columns:

- `report_events.actor_client_id text` — populated with the OAuth `client_id` when a write came through MCP, NULL when it came through the dashboard UI.
- `report_comments.actor_client_id text` — same.

Apply migrations the standard way:

```bash
bun run db:migrate
```

(or `db:push` for dev iteration).

The migrations are purely additive — no existing tables are altered or dropped.

## How the OAuth flow looks

1. AI client fetches `https://<your-repro>/.well-known/oauth-authorization-server/api/auth` for endpoint discovery (RFC 8414).
2. Client registers via `POST /api/auth/oauth2/register` (RFC 7591 — anonymous; this only registers a client, not a grant).
3. Client opens the user's browser to `/api/auth/oauth2/authorize?...` with PKCE.
4. The user signs in (existing flow) and lands on `/oauth/consent` — they click Allow.
5. Client exchanges the code for a JWT access token at `/api/auth/oauth2/token` with the `resource` indicator set to `<your-repro>/api/mcp`.
6. All subsequent MCP calls go to `/api/mcp` with `Authorization: Bearer <jwt>`.

## Audit trail

Every change made through MCP is recorded with `actor_client_id` set to the OAuth client_id. To find every change made by Claude Desktop on a particular ticket:

```sql
SELECT kind, payload, created_at, actor_client_id
FROM report_events
WHERE report_id = '<ticket-id>' AND actor_client_id IS NOT NULL
ORDER BY created_at DESC;
```

A future dashboard release will surface this as a badge on the activity feed; for now it's queryable directly.

## Security model

- **Per-user OAuth, no service tokens.** An assistant runs as a specific user with that user's project memberships and roles.
- **No exfiltration tools.** Repro's MCP surface has no `fetch_url`, `post_to_webhook`, or `run_code` tool. An AI ingesting attacker-controlled content (prompt-injected replay, console log) cannot exfiltrate data through the Repro surface.
- **No destructive writes.** No `delete_*` tool exists. The worst an injected prompt can do is mistakenly change a status or post a comment — both reversible in the UI in seconds.
- **Bounded blast radius.** Access tokens expire after 1 hour. Users can revoke any time at `/settings/mcp`.
- **Cookies are opt-in.** `repro_get_ticket` deliberately omits captured cookies. An AI must call `repro_get_ticket_cookies` explicitly. The tool description warns about session-token risk.

For more depth see the spec at [`docs/superpowers/specs/2026-05-06-mcp-oauth-server-design.md`](https://github.com/Ripwords/ReproJs/blob/main/docs/superpowers/specs/2026-05-06-mcp-oauth-server-design.md).

## Disabling

Set `MCP_ENABLED=false` and restart. The OAuth tables stay in the database (so existing consents are preserved if you re-enable later) but are unreachable. To clean up entirely, also revoke any consents from the dashboard UI before disabling.
```

- [ ] **Step 2: Commit.**

```bash
git add docs/self-hosting/mcp.md
git commit -m "docs(mcp): add self-hosting / operator guide"
```

---

## Task 3: Wire docs into VitePress sidebar

**Files:**
- Modify: `docs/.vitepress/config.ts`

Add both new pages to the existing sidebar config — guide page goes under `/guide/`, self-hosting page goes under `/self-hosting/`.

- [ ] **Step 1: Edit the sidebar.**

In `docs/.vitepress/config.ts`, find the `"/guide/"` sidebar block. After the existing groups (Introduction / For testers / Web SDK / Mobile SDK / Tester extension), add:

```ts
        {
          text: "AI assistants",
          items: [{ text: "MCP", link: "/guide/mcp" }],
        },
```

Then in the `"/self-hosting/"` block, append a new entry inside the existing `items` array (between `"Compatibility"` and the closing `]`):

```ts
            { text: "AI assistants (MCP)", link: "/self-hosting/mcp" },
```

- [ ] **Step 2: Build the docs locally to confirm no broken links.**

```bash
bun run docs:build 2>&1 | tail -20
```

Expected: `build complete` (or equivalent VitePress success message). NO errors about missing files. If the build fails on a relative-link warning, fix the offending link.

- [ ] **Step 3: Commit.**

```bash
git add docs/.vitepress/config.ts
git commit -m "docs(mcp): add MCP pages to VitePress sidebar"
```

---

## Task 4: Flip `MCP_ENABLED` default to `true`

**Files:**
- Modify: `apps/dashboard/server/lib/env.ts`

- [ ] **Step 1: Edit `env.ts`.**

Find the line:
```ts
  MCP_ENABLED: boolString.default(false),
```

Change to:
```ts
  MCP_ENABLED: boolString.default(true),
```

Update the inline comment block above it so future readers understand the flag is now on by default:

```ts
  // MCP — feature gate + tunables. Default-on as of v0.6.0. Operators who
  // want to disable MCP entirely can set MCP_ENABLED=false; that hides the
  // /api/mcp route + discovery endpoints + oauth-provider plugin without
  // touching the dashboard's other auth flows.
```

(Replace the existing Phase-1 comment.)

- [ ] **Step 2: Verify env still parses.**

```bash
bun --env-file=.env apps/dashboard/server/lib/env.ts
```

Expected: exit 0, silent. (The default kicks in only when `MCP_ENABLED` is absent from `.env`; since the dashboard `.env` may already set it, the flip mostly affects fresh deployments.)

- [ ] **Step 3: Commit.**

```bash
git add apps/dashboard/server/lib/env.ts
git commit -m "feat(mcp): flip MCP_ENABLED default to true"
```

---

## Task 5: Fix N+1 in `mcp-connections.get.ts`

**Files:**
- Modify: `apps/dashboard/server/api/me/mcp-connections.get.ts`

Replace the loop that runs one `SELECT` per consent with a single grouped subquery.

- [ ] **Step 1: Read the current file.**

```bash
cat apps/dashboard/server/api/me/mcp-connections.get.ts
```

Identify the loop that builds `lastUsedByClient`. It probably looks like:

```ts
const lastUsedByClient = new Map<string, Date>()
await Promise.all(
  consents.map(async (c) => {
    const [latest] = await db
      .select({ createdAt: oauthAccessToken.createdAt })
      .from(oauthAccessToken)
      .where(eq(oauthAccessToken.clientId, c.clientId))
      .orderBy(desc(oauthAccessToken.createdAt))
      .limit(1)
    if (latest?.createdAt) lastUsedByClient.set(c.clientId, latest.createdAt)
  }),
)
```

(Phase 3's subagent parallelized with `Promise.all`. Still N queries; now in parallel.)

- [ ] **Step 2: Replace with a single GROUP BY query.**

Add `max` to the drizzle imports if not already present:

```ts
import { desc, eq, max } from "drizzle-orm"
```

Replace the loop with a single query:

```ts
// One query: max(createdAt) per (userId, clientId). Scopes by userId so a
// shared client_id between users doesn't leak each other's last-used.
const lastUsedRows = await db
  .select({
    clientId: oauthAccessToken.clientId,
    lastUsedAt: max(oauthAccessToken.createdAt),
  })
  .from(oauthAccessToken)
  .where(eq(oauthAccessToken.userId, session.userId))
  .groupBy(oauthAccessToken.clientId)

const lastUsedByClient = new Map<string, Date>()
for (const row of lastUsedRows) {
  if (row.lastUsedAt) lastUsedByClient.set(row.clientId, row.lastUsedAt)
}
```

The downstream `lastUsedByClient.get(c.clientId) ?? null` access pattern stays the same. Total queries drop from `1 + N` to `2`.

- [ ] **Step 3: Smoke-test the endpoint.**

```bash
MCP_ENABLED=true BETTER_AUTH_URL=http://localhost:3000 bun run dev > /tmp/dev.log 2>&1 &
DEV_PID=$!
for i in {1..30}; do
  if curl -sf http://localhost:3000/.well-known/oauth-authorization-server/api/auth > /dev/null 2>&1; then
    break
  fi
  sleep 1
done

# Unauthenticated → 401
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/me/mcp-connections

kill $DEV_PID 2>/dev/null
wait $DEV_PID 2>/dev/null
```

Expected: `401`. (The query change doesn't affect auth gating.)

- [ ] **Step 4: Lint.**

```bash
bunx oxlint apps/dashboard/server/api/me/mcp-connections.get.ts
```

Expected: 0 errors.

- [ ] **Step 5: Commit.**

```bash
git add apps/dashboard/server/api/me/mcp-connections.get.ts
git commit -m "perf(mcp): fold last-used lookup into single grouped query"
```

---

## Task 6: Move `CreateCommentBody` Zod schema to `@reprojs/shared`

**Files:**
- Modify: `packages/shared/src/reports.ts`
- Modify: `apps/dashboard/server/api/projects/[id]/reports/[reportId]/comments/index.post.ts`

The comment endpoint currently defines `CreateCommentBody` inline. Move it next to `TriagePatchInput` in the shared package so future MCP-side or other callers can reuse the same validation.

- [ ] **Step 1: Add the schema to `packages/shared/src/reports.ts`.**

Find the `TriagePatchInput` definition and append below it:

```ts
export const CreateCommentBody = z.object({
  body: z.string().min(1).max(65_536),
})
export type CreateCommentBody = z.infer<typeof CreateCommentBody>
```

(Match whatever export style the file already uses for `TriagePatchInput` — same pattern of named `const` + `type` alias.)

- [ ] **Step 2: Build the shared package so the export resolves.**

The shared package usually rebuilds automatically via the workspace. If not:
```bash
bun --filter @reprojs/shared build
```
(If the package has no build step and just publishes source, skip this.)

- [ ] **Step 3: Update the comments endpoint to import from shared.**

In `apps/dashboard/server/api/projects/[id]/reports/[reportId]/comments/index.post.ts`:

Find the inline declaration:
```ts
const CreateCommentBody = z.object({ body: z.string().min(1).max(65_536) })
```

Delete it.

Update imports — replace whatever `z` imports the file has with the shared schema:
```ts
import { CreateCommentBody } from "@reprojs/shared"
```

(If `z` is still needed elsewhere in the file, keep that import. Otherwise drop it.)

The endpoint's `readValidatedBody(event, (b) => CreateCommentBody.parse(b))` call still works as-is.

- [ ] **Step 4: Run existing comment tests.**

The dev server must be running (existing pattern):

```bash
MCP_ENABLED=true BETTER_AUTH_URL=http://localhost:3000 bun run dev > /tmp/dev.log 2>&1 &
DEV_PID=$!
for i in {1..30}; do
  if curl -sf http://localhost:3000/.well-known/oauth-authorization-server/api/auth > /dev/null 2>&1; then
    break
  fi
  sleep 1
done

bun test apps/dashboard/tests/api/comments.test.ts

kill $DEV_PID 2>/dev/null
wait $DEV_PID 2>/dev/null
```

Expected: existing comment tests pass (~5–7 tests).

- [ ] **Step 5: Lint.**

```bash
bunx oxlint packages/shared/src/reports.ts apps/dashboard/server/api/projects/\[id\]/reports/\[reportId\]/comments/index.post.ts
```

Expected: 0 errors.

- [ ] **Step 6: Commit.**

```bash
git add packages/shared/src/reports.ts \
        apps/dashboard/server/api/projects/\[id\]/reports/\[reportId\]/comments/index.post.ts
git commit -m "refactor(comments): move CreateCommentBody schema to @reprojs/shared"
```

---

## Self-Review

Looking over the plan against the spec's §11 (rollout):

| Spec rollout step | Plan task |
|---|---|
| VitePress docs page covering "how to connect each client / what the AI can do / how to revoke / security summary / troubleshooting" | Task 1 (user) + Task 2 (operator) |
| `MCP_ENABLED=true` flag flip default | Task 4 |
| `CHANGELOG.md` migration note | **Deferred** — the project uses `changelogen` for auto-generated CHANGELOGs from conventional commits. Manual entries get overwritten. The migration notes live in `docs/self-hosting/mcp.md` instead, which operators actually read during deploys. |
| Two cleanups from Phase 3 review | Task 5 (N+1) + Task 6 (shared schema) |

**Spec coverage:** complete for Phase 4. The CHANGELOG deviation is explicit and intentional given the project's release tooling.

**Placeholder scan:** clean. Each task has executable code, exact paths, exact commands.

**Type consistency:** the new `CreateCommentBody` Zod export uses the same named-const + type-alias pattern as the existing `TriagePatchInput` in the same file.

**No new tests added.** Phase 4 doesn't introduce new behavior — it ships existing behavior to users (docs + flag) and tightens two minor things. Existing comment tests cover the schema move; existing connections smoke test covers the N+1 fix.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-07-mcp-oauth-server-phase-4.md`.** 6 tasks, ~2 hours of work. Most tasks are mechanical and dispatch-friendly to haiku.

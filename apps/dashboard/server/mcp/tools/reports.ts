import { gunzipSync } from "node:zlib"
import { z } from "zod"
import { and, eq } from "drizzle-orm"
import { db } from "../../db"
import { reports, reportAttachments } from "../../db/schema"
import { requireProjectRoleByUser } from "../../lib/permissions"
import { mcpError } from "../errors"
import { getStorage } from "../../lib/storage"
import { buildReplayTranscript, type RrwebEvent } from "../replay-transcript"
import type { McpRequestContext } from "../context"

const SCREENSHOT_MAX_BYTES = 1024 * 1024 // 1 MB

export const getScreenshotTool = {
  name: "repro_get_screenshot",
  config: {
    description:
      "Fetch the annotated screenshot for a ticket as an inline image. Falls back to the unannotated screenshot if no annotated version exists. Returns an error if the image exceeds 1MB — fetch via the dashboard UI in that case.",
    inputSchema: z.object({
      ticketId: z.string().uuid(),
    }),
  },
  handler: async (input: { ticketId: string }, ctx: McpRequestContext) => {
    const [report] = await db
      .select({ projectId: reports.projectId })
      .from(reports)
      .where(eq(reports.id, input.ticketId))
      .limit(1)
    if (!report) throw mcpError("NOT_FOUND", `ticket ${input.ticketId} not found`)
    await requireProjectRoleByUser(ctx.userId, report.projectId, "viewer")

    const candidates = await db
      .select({
        kind: reportAttachments.kind,
        storageKey: reportAttachments.storageKey,
        contentType: reportAttachments.contentType,
        size: reportAttachments.sizeBytes,
      })
      .from(reportAttachments)
      .where(eq(reportAttachments.reportId, input.ticketId))

    const annotated = candidates.find((a) => a.kind === "annotated-screenshot")
    const screenshot = candidates.find((a) => a.kind === "screenshot")
    const chosen = annotated ?? screenshot
    if (!chosen) {
      throw mcpError("NOT_FOUND", `no screenshot attached to ticket ${input.ticketId}`)
    }
    if (chosen.size > SCREENSHOT_MAX_BYTES) {
      throw mcpError(
        "PAYLOAD_TOO_LARGE",
        `screenshot is ${chosen.size} bytes (max ${SCREENSHOT_MAX_BYTES}); view it in the Repro dashboard UI`,
      )
    }

    const storage = await getStorage()
    const obj = await storage.get(chosen.storageKey)
    const base64 = Buffer.from(obj.bytes).toString("base64")

    return {
      content: [
        {
          type: "image" as const,
          data: base64,
          mimeType: chosen.contentType,
        },
      ],
    }
  },
}

export const getReplayTranscriptTool = {
  name: "repro_get_replay_transcript",
  config: {
    description:
      "Re-fetch the textual replay timeline for a ticket. The 'summary' verbosity (default) matches the inline transcript in repro_get_ticket; 'detailed' includes more event types like focus/blur and DOM mutation counts.",
    inputSchema: z.object({
      ticketId: z.string().uuid(),
      verbosity: z.enum(["summary", "detailed"]).optional(),
    }),
  },
  handler: async (
    input: { ticketId: string; verbosity?: "summary" | "detailed" },
    ctx: McpRequestContext,
  ) => {
    const [report] = await db
      .select({ projectId: reports.projectId })
      .from(reports)
      .where(eq(reports.id, input.ticketId))
      .limit(1)
    if (!report) throw mcpError("NOT_FOUND", `ticket ${input.ticketId} not found`)
    await requireProjectRoleByUser(ctx.userId, report.projectId, "viewer")

    const [replayAttachment] = await db
      .select({
        storageKey: reportAttachments.storageKey,
      })
      .from(reportAttachments)
      .where(
        and(eq(reportAttachments.reportId, input.ticketId), eq(reportAttachments.kind, "replay")),
      )
      .limit(1)
    if (!replayAttachment) {
      throw mcpError("NOT_FOUND", `no replay captured for ticket ${input.ticketId}`)
    }

    const storage = await getStorage()
    const obj = await storage.get(replayAttachment.storageKey)
    let events: RrwebEvent[]
    try {
      const decompressed = gunzipSync(Buffer.from(obj.bytes))
      events = JSON.parse(decompressed.toString("utf-8")) as RrwebEvent[]
    } catch (e) {
      throw mcpError(
        "INVALID_INPUT",
        `replay attachment for ticket ${input.ticketId} could not be decoded: ${
          e instanceof Error ? e.message : String(e)
        }`,
      )
    }
    const t = buildReplayTranscript(events, { verbosity: input.verbosity ?? "summary" })
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              transcript: t.transcript,
              eventCount: t.eventCount,
              durationMs: t.durationMs,
              truncated: t.truncated,
              verbosity: input.verbosity ?? "summary",
            },
            null,
            2,
          ),
        },
      ],
    }
  },
}

const REPLAY_RAW_DEFAULT_CAP = 200 * 1024 // 200 KB of decoded JSON

export const getReplayRawTool = {
  name: "repro_get_replay_raw",
  config: {
    description:
      "Fetch the raw rrweb event stream for a ticket as JSON. The decompressed size is capped at 200KB unless you pass acknowledgeSize: true. Use repro_get_replay_transcript first — raw events are noisy and rarely needed.",
    inputSchema: z.object({
      ticketId: z.string().uuid(),
      acknowledgeSize: z.boolean().optional(),
    }),
  },
  handler: async (
    input: { ticketId: string; acknowledgeSize?: boolean },
    ctx: McpRequestContext,
  ) => {
    const [report] = await db
      .select({ projectId: reports.projectId })
      .from(reports)
      .where(eq(reports.id, input.ticketId))
      .limit(1)
    if (!report) throw mcpError("NOT_FOUND", `ticket ${input.ticketId} not found`)
    await requireProjectRoleByUser(ctx.userId, report.projectId, "viewer")

    const [replayAttachment] = await db
      .select({
        storageKey: reportAttachments.storageKey,
      })
      .from(reportAttachments)
      .where(
        and(eq(reportAttachments.reportId, input.ticketId), eq(reportAttachments.kind, "replay")),
      )
      .limit(1)
    if (!replayAttachment) {
      throw mcpError("NOT_FOUND", `no replay captured for ticket ${input.ticketId}`)
    }

    const storage = await getStorage()
    const obj = await storage.get(replayAttachment.storageKey)
    let decompressed: Buffer
    try {
      decompressed = gunzipSync(Buffer.from(obj.bytes))
    } catch (e) {
      throw mcpError(
        "INVALID_INPUT",
        `replay attachment for ticket ${input.ticketId} could not be decompressed: ${
          e instanceof Error ? e.message : String(e)
        }`,
      )
    }
    if (decompressed.byteLength > REPLAY_RAW_DEFAULT_CAP && !input.acknowledgeSize) {
      throw mcpError(
        "PAYLOAD_TOO_LARGE",
        `replay events are ${decompressed.byteLength} bytes (cap ${REPLAY_RAW_DEFAULT_CAP}). Re-call with acknowledgeSize: true to receive the full payload.`,
      )
    }
    const events = JSON.parse(decompressed.toString("utf-8")) as RrwebEvent[]

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ events, byteCount: decompressed.byteLength }, null, 2),
        },
      ],
    }
  },
}

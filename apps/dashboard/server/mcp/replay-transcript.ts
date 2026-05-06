// rrweb event-stream → text timeline reducer.
//
// This module is intentionally pure (no DB, no network) so it can be tested
// against fixtures and used from any tool handler that needs to surface a
// session-replay summary. Privacy: masked input values arrive masked from
// the recorder (•••) and we never unmask them here.

export type RrwebEventType = 0 | 1 | 2 | 3 | 4 | 5 | 6
export type RrwebSource =
  | 0 // Mutation
  | 1 // MouseMove
  | 2 // MouseInteraction
  | 3 // Scroll
  | 4 // ViewportResize
  | 5 // Input
  | 6 // TouchMove
  | 7 // MediaInteraction
  | 8 // StyleSheetRule
  | 9 // CanvasMutation
  | 10 // Font
  | 11 // Log
  | 12 // Drag
  | 13 // StyleDeclaration
  | 14 // Selection

export interface RrwebEvent {
  type: RrwebEventType
  timestamp: number
  data: Record<string, unknown>
}

export interface BuildReplayTranscriptOptions {
  verbosity: "summary" | "detailed"
  maxBytes?: number
}

export interface ReplayTranscript {
  transcript: string
  eventCount: number
  durationMs: number
  truncated: boolean
}

const DEFAULT_MAX_BYTES_SUMMARY = 4 * 1024
const DEFAULT_MAX_BYTES_DETAILED = 16 * 1024

interface NodeMeta {
  tag: string
  attrs: Record<string, string>
  text: string | null
  parent: number | null
}

function buildDomMapFromFullSnapshot(events: RrwebEvent[]): Map<number, NodeMeta> {
  const map = new Map<number, NodeMeta>()
  const fullSnapshot = events.find((e) => e.type === 2)
  if (!fullSnapshot) return map
  const root = (fullSnapshot.data as { node?: unknown }).node
  if (!root || typeof root !== "object") return map
  walkNode(root as Record<string, unknown>, null, map)
  return map
}

function walkNode(
  node: Record<string, unknown>,
  parentId: number | null,
  out: Map<number, NodeMeta>,
): void {
  const id = typeof node.id === "number" ? node.id : null
  const type = typeof node.type === "number" ? node.type : null
  if (id != null && type === 2) {
    // Element
    out.set(id, {
      tag: typeof node.tagName === "string" ? node.tagName.toLowerCase() : "unknown",
      attrs: (node.attributes as Record<string, string>) ?? {},
      text: null,
      parent: parentId,
    })
  } else if (id != null && type === 3 && typeof node.textContent === "string") {
    // Text
    out.set(id, { tag: "#text", attrs: {}, text: node.textContent, parent: parentId })
  }
  const children = Array.isArray(node.childNodes) ? (node.childNodes as unknown[]) : []
  for (const child of children) {
    if (child && typeof child === "object") {
      walkNode(child as Record<string, unknown>, id, out)
    }
  }
}

function resolveSelector(id: number, dom: Map<number, NodeMeta>): string {
  const node = dom.get(id)
  if (!node) return `<unknown element ${id}>`
  if (node.tag === "#text") return `text "${(node.text ?? "").trim().slice(0, 40)}"`
  const name = node.attrs.name
  const ariaLabel = node.attrs["aria-label"]
  const type = node.attrs.type
  const className = node.attrs.class?.split(/\s+/).find(Boolean)
  const innerText = collectInnerText(id, dom).trim().slice(0, 40)
  if (name) return `${node.tag}[name="${name}"]`
  if (ariaLabel) return `${node.tag}[aria-label="${ariaLabel}"]`
  if (type && (node.tag === "button" || node.tag === "input")) return `${node.tag}[type="${type}"]`
  if (innerText && (node.tag === "button" || node.tag === "a")) return `${node.tag} "${innerText}"`
  if (className) return `${node.tag}.${className}`
  return `<${node.tag}>`
}

function collectInnerText(id: number, dom: Map<number, NodeMeta>): string {
  let out = ""
  for (const [, meta] of dom) {
    if (meta.parent === id && meta.tag === "#text") out += meta.text ?? ""
  }
  return out
}

export function buildReplayTranscript(
  events: RrwebEvent[],
  opts: BuildReplayTranscriptOptions,
): ReplayTranscript {
  if (events.length === 0) {
    return {
      transcript: "Replay (0 events)",
      eventCount: 0,
      durationMs: 0,
      truncated: false,
    }
  }
  // maxBytes is wired here so later tasks (Task 6) can reference it without
  // altering the function signature.
  const maxBytes =
    opts.maxBytes ??
    (opts.verbosity === "summary" ? DEFAULT_MAX_BYTES_SUMMARY : DEFAULT_MAX_BYTES_DETAILED)
  void maxBytes

  const dom = buildDomMapFromFullSnapshot(events)
  const startTs = events[0]!.timestamp
  const endTs = events[events.length - 1]!.timestamp
  const lines: string[] = []

  for (const e of events) {
    if (e.type === 3 && (e.data as { source?: number }).source === 2) {
      const id = (e.data as { id?: number }).id
      if (typeof id !== "number") continue
      const t = ((e.timestamp - startTs) / 1000).toFixed(1)
      lines.push(`[+${t}s] click ${resolveSelector(id, dom)}`)
    }
  }

  const transcript =
    `Replay (${((endTs - startTs) / 1000).toFixed(1)}s, ${events.length} events)\n\n` +
    lines.join("\n")

  return {
    transcript,
    eventCount: events.length,
    durationMs: endTs - startTs,
    truncated: false,
  }
}

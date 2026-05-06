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
  // Real reduction lands in subsequent tasks. For now the empty-stream branch
  // is the only branch any test exercises. maxBytes is wired here so later
  // tasks can reference it without altering the function signature.
  const maxBytes =
    opts.maxBytes ??
    (opts.verbosity === "summary" ? DEFAULT_MAX_BYTES_SUMMARY : DEFAULT_MAX_BYTES_DETAILED)
  void maxBytes
  return {
    transcript: `Replay (${events.length} events)`,
    eventCount: events.length,
    durationMs: events[events.length - 1]!.timestamp - events[0]!.timestamp,
    truncated: false,
  }
}

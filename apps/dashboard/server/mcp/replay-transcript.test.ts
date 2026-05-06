import { describe, expect, it } from "bun:test"
import { buildReplayTranscript } from "./replay-transcript"

describe("buildReplayTranscript", () => {
  it("returns a no-events placeholder for an empty stream", () => {
    const out = buildReplayTranscript([], { verbosity: "summary" })
    expect(out.eventCount).toBe(0)
    expect(out.durationMs).toBe(0)
    expect(out.truncated).toBe(false)
    expect(out.transcript).toBe("Replay (0 events)")
  })
})

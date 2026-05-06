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

  it("emits an unknown-element placeholder when no FullSnapshot is present", async () => {
    const fixture = await Bun.file(`${import.meta.dir}/__fixtures__/no-fullsnapshot.json`).json()
    const out = buildReplayTranscript(fixture.events, { verbosity: "summary" })
    expect(out.transcript).toContain("<unknown element")
    expect(out.eventCount).toBe(fixture.events.length)
  })

  it("emits navigation, masked-stays-masked typing, click, and console.error", async () => {
    const fixture = await Bun.file(`${import.meta.dir}/__fixtures__/checkout-error.json`).json()
    const out = buildReplayTranscript(fixture.events, { verbosity: "summary" })
    expect(out.transcript).toContain("loaded /checkout?cart=abc-123")
    expect(out.transcript).toContain('typed "alice@example.com" into input[name="email"]')
    expect(out.transcript).toContain('typed "•••" into input[name="cardNumber"]')
    expect(out.transcript).toContain('click button[type="submit"]')
    expect(out.transcript).toContain("console.error")
    expect(out.transcript).toContain("loaded /checkout/error")
  })
})

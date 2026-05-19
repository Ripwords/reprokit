import { describe, expect, test } from "bun:test"
import { pollUntil } from "../../app/composables/use-poll-until"

const noSleep = async (): Promise<void> => {}

describe("pollUntil", () => {
  test("returns true as soon as the predicate is satisfied", async () => {
    let calls = 0
    const fetcher = async () => ++calls
    const ok = await pollUntil(fetcher, (n) => n >= 3, {
      attempts: 10,
      intervalMs: 1,
      sleep: noSleep,
    })
    expect(ok).toBe(true)
    expect(calls).toBe(3)
  })

  test("returns false after exhausting attempts without satisfying the predicate", async () => {
    let calls = 0
    const fetcher = async () => ++calls
    const ok = await pollUntil(fetcher, () => false, {
      attempts: 4,
      intervalMs: 1,
      sleep: noSleep,
    })
    expect(ok).toBe(false)
    expect(calls).toBe(4)
  })

  test("returns true on the first attempt when already satisfied", async () => {
    let calls = 0
    const fetcher = async () => ++calls
    const ok = await pollUntil(fetcher, () => true, {
      attempts: 5,
      intervalMs: 1,
      sleep: noSleep,
    })
    expect(ok).toBe(true)
    expect(calls).toBe(1)
  })

  test("does not sleep after the final attempt", async () => {
    let sleeps = 0
    const sleep = async () => {
      sleeps++
    }
    await pollUntil(
      async () => 0,
      () => false,
      { attempts: 3, intervalMs: 1, sleep },
    )
    // 3 attempts → at most 2 inter-attempt sleeps.
    expect(sleeps).toBe(2)
  })
})

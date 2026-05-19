/**
 * Bounded async poll. Calls `fetcher` up to `attempts` times, returning
 * `true` as soon as `done(result)` is truthy, or `false` once attempts are
 * exhausted. Sleeps `intervalMs` between attempts (never after the last).
 *
 * `sleep` is injectable so callers/tests can substitute timing. Default uses
 * a real timer.
 *
 * Used by the triage sidebar: GitHub-issue creation is processed by an
 * async in-process worker, so the report row gains its `githubIssueNumber`
 * a beat after the POST resolves. Poll until it lands before refetching.
 */
export interface PollOptions {
  attempts: number
  intervalMs: number
  sleep?: (ms: number) => Promise<void>
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export async function pollUntil<T>(
  fetcher: () => Promise<T>,
  done: (value: T) => boolean,
  opts: PollOptions,
): Promise<boolean> {
  const sleep = opts.sleep ?? realSleep
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    const value = await fetcher()
    if (done(value)) return true
    if (attempt < opts.attempts) await sleep(opts.intervalMs)
  }
  return false
}

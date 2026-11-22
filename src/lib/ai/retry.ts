/**
 * Bounded exponential backoff for temporary Gemini failures (503 overloaded,
 * 500/502/504). Pure and dependency-free so it can be unit-tested with a fake
 * clock. Never retries forever: at most `maxRetries` extra attempts.
 */

export const MAX_GEMINI_RETRIES = 3
export const BASE_RETRY_DELAY_MS = 2_000
export const MAX_RETRY_DELAY_MS = 16_000

/**
 * Delay before retry number `retry` (1-based): base · 2^(retry−1), capped,
 * with "equal jitter" (50–100 % of that) so many clients don't retry in sync.
 * Defaults give roughly 1–2 s, 2–4 s, 4–8 s.
 */
export function backoffDelayMs(
  retry: number,
  { baseMs = BASE_RETRY_DELAY_MS, maxMs = MAX_RETRY_DELAY_MS, random = Math.random } = {},
): number {
  const exponential = Math.min(maxMs, baseMs * 2 ** Math.max(0, retry - 1))
  return Math.round(exponential / 2 + (exponential / 2) * random())
}

export type RetryEvent = { retry: number; delayMs: number; error: unknown }

export type RetryOptions = {
  maxRetries?: number
  /** Return true only for errors that are worth retrying. */
  shouldRetry: (error: unknown) => boolean
  onRetry?: (event: RetryEvent) => void
  sleep?: (ms: number) => Promise<void>
  random?: () => number
  baseMs?: number
  /** Epoch ms after which no new attempt is started (the request's time budget). */
  deadline?: number
  /** An attempt is only started if at least this much time is left before `deadline`. */
  minAttemptMs?: number
  now?: () => number
}

export class RetriesExhaustedError extends Error {
  constructor(
    readonly lastError: unknown,
    readonly attempts: number,
    /** True when retrying stopped because the time budget ran out, not the retry count. */
    readonly outOfTime = false,
  ) {
    super(lastError instanceof Error ? lastError.message : String(lastError))
    this.name = "RetriesExhaustedError"
  }
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Runs `operation`; on a retryable error waits and tries again, up to
 * `maxRetries` times. A non-retryable error is rethrown immediately (as is);
 * when retries run out a RetriesExhaustedError wraps the last error. With a
 * `deadline`, a retry that could not finish in time is not started.
 */
export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  {
    maxRetries = MAX_GEMINI_RETRIES,
    shouldRetry,
    onRetry,
    sleep = realSleep,
    random,
    baseMs,
    deadline,
    minAttemptMs = MIN_ATTEMPT_MS,
    now = Date.now,
  }: RetryOptions,
): Promise<{ value: T; attempts: number }> {
  const limit = Math.max(0, Math.min(maxRetries, 10))
  for (let attempt = 1; ; attempt++) {
    try {
      return { value: await operation(attempt), attempts: attempt }
    } catch (error) {
      if (!shouldRetry(error)) throw error
      if (attempt > limit) throw new RetriesExhaustedError(error, attempt)
      const delayMs = backoffDelayMs(attempt, { random, baseMs })
      if (deadline !== undefined && now() + delayMs + minAttemptMs > deadline) {
        throw new RetriesExhaustedError(error, attempt, true)
      }
      onRetry?.({ retry: attempt, delayMs, error })
      await sleep(delayMs)
    }
  }
}

/*
 * Time budget. Vercel Hobby stops a function after 300 s (the route declares
 * `maxDuration = 300`). SellerOS stops starting new Gemini work after 270 s so
 * there is always time left to clean up and return a useful "retry" answer
 * instead of a platform 504.
 */

/** Vercel Hobby's maximum function duration, in seconds. */
export const FUNCTION_MAX_DURATION_S = 300
/** Work must finish this long before the platform limit. */
export const SAFETY_MARGIN_MS = 30_000
/** The time a request may spend on AI work: 270 s. */
export const REQUEST_TIME_BUDGET_MS = FUNCTION_MAX_DURATION_S * 1000 - SAFETY_MARGIN_MS
/** Don't start a call (or retry) with less than this left: it could not finish usefully. */
export const MIN_ATTEMPT_MS = 15_000

/** The deadline for a request that started at `startedAt` (epoch ms). */
export const requestDeadline = (startedAt: number = Date.now()) =>
  startedAt + REQUEST_TIME_BUDGET_MS

/** Milliseconds left before `deadline` (Infinity without one). */
export const remainingMs = (deadline: number | undefined, now: number = Date.now()) =>
  deadline === undefined ? Infinity : deadline - now

/** A per-call timeout that never runs past the deadline (at least 1 s). */
export const timeoutWithin = (
  defaultMs: number,
  deadline: number | undefined,
  now: number = Date.now(),
) => Math.max(1_000, Math.min(defaultMs, remainingMs(deadline, now)))

/** True once there is not enough time left to start another call. */
export const isOutOfTime = (deadline: number | undefined, now: number = Date.now()) =>
  remainingMs(deadline, now) < MIN_ATTEMPT_MS

/** Raised when the request's time budget ran out before the AI work finished. */
export class TimeBudgetExceededError extends Error {
  constructor(readonly stage: string) {
    super(`Time budget exceeded during ${stage}`)
    this.name = "TimeBudgetExceededError"
  }
}

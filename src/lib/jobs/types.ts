/**
 * Slow work (video analysis, bulk listing generation) runs as a "job".
 *
 * For the college demo, jobs run directly inside a server request and record
 * their progress in the database so the UI can show it. If SellerOS grows into
 * a real SaaS, a queue (e.g. Inngest) can run the same JobHandler functions
 * without changing any feature code. The table and runner arrive in Phase 2.
 */

export type JobStatus = "queued" | "running" | "succeeded" | "failed"

export type JobContext = {
  jobId: string
  organizationId: string
  /** Record progress (0–100) and an optional human-readable step name. */
  reportProgress(percent: number, step?: string): Promise<void>
}

export type JobHandler<Input, Output> = (input: Input, context: JobContext) => Promise<Output>

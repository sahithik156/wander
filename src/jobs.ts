/**
 * Background-job handler — invoked by AppJobRoom (worker.ts) for every job
 * picked up from the queue. Dispatch on `job.type`; return a JSON-serializable
 * result (captured as `job.result`) or throw to fail (retried up to
 * `maxAttempts`).
 *
 * Enqueue from a client with `useJobs(SCOPE_ID).enqueue(type, payload)` (the
 * SDK stamps `job.enqueuedBy` from the verified session), or from worker code
 * with `enqueueJob(env.JOB_ROOMS, \`app:${env.DEEPSPACE_APP_ID}\`, type, payload)`.
 *
 * Job types:
 *   - build-tour { tourId }: Wikipedia places -> stops (src/server/build-tour.ts)
 */

import type { Job, JobContext } from 'deepspace/worker'
import type { Env } from '../worker'
import { buildTour } from './server/build-tour'

export async function runJob(job: Job, ctx: JobContext, env: Env): Promise<unknown> {
  switch (job.type) {
    case 'build-tour':
      return buildTour(job, ctx, env)
    default:
      throw new Error(`Unknown job type: ${job.type}`)
  }
}

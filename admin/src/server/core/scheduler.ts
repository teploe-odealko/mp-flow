import cron from "node-cron"

export interface Job {
  name: string
  schedule: string
  handler: (container: any) => Promise<void>
}

const tasks: Map<string, cron.ScheduledTask> = new Map()

let _container: any = null

export function setSchedulerContainer(container: any) {
  _container = container
}

export function scheduleJob(job: Job): void {
  if (tasks.has(job.name)) {
    console.warn(`Job "${job.name}" already scheduled, skipping`)
    return
  }

  const task = cron.schedule(job.schedule, async () => {
    console.log(`[cron] Running job: ${job.name}`)
    try {
      await job.handler(_container)
      console.log(`[cron] Job "${job.name}" completed`)
    } catch (err) {
      console.error(`[cron] Job "${job.name}" failed:`, err)
    }
  })

  tasks.set(job.name, task)
  console.log(`[cron] Scheduled job: ${job.name} (${job.schedule})`)
}

export function stopAllJobs(): void {
  for (const [name, task] of tasks) {
    task.stop()
    console.log(`[cron] Stopped job: ${name}`)
  }
  tasks.clear()
}

import cron from "node-cron";
const tasks = new Map();
let _container = null;
let _orm = null;
export function setSchedulerContext(container, orm) {
    _container = container;
    _orm = orm;
}
export function scheduleJob(job) {
    if (tasks.has(job.name)) {
        console.warn(`Job "${job.name}" already scheduled, skipping`);
        return;
    }
    const task = cron.schedule(job.schedule, async () => {
        console.log(`[cron] Running job: ${job.name}`);
        try {
            if (!_container || !_orm)
                throw new Error("Scheduler context not set");
            // Create a request-scoped container for each job run
            const { createRequestScope } = await import("./request-scope.js");
            const { scope, em } = createRequestScope(_container, _orm);
            try {
                await job.handler(scope);
            }
            finally {
                em.clear();
            }
            console.log(`[cron] Job "${job.name}" completed`);
        }
        catch (err) {
            console.error(`[cron] Job "${job.name}" failed:`, err);
        }
    });
    tasks.set(job.name, task);
    console.log(`[cron] Scheduled job: ${job.name} (${job.schedule})`);
}
export function stopAllJobs() {
    for (const [name, task] of tasks) {
        task.stop();
        console.log(`[cron] Stopped job: ${name}`);
    }
    tasks.clear();
}
//# sourceMappingURL=scheduler.js.map
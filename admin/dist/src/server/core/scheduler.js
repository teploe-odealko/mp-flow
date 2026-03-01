import cron from "node-cron";
const tasks = new Map();
const jobPluginMap = new Map(); // job name → plugin name
const jobDefinitions = new Map(); // job name → Job definition
let _container = null;
let _orm = null;
export function setSchedulerContext(container, orm) {
    _container = container;
    _orm = orm;
}
export function scheduleJob(job, pluginName) {
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
    jobDefinitions.set(job.name, job);
    if (pluginName)
        jobPluginMap.set(job.name, pluginName);
    console.log(`[cron] Scheduled job: ${job.name} (${job.schedule})`);
}
export function stopAllJobs() {
    for (const [name, task] of tasks) {
        task.stop();
        console.log(`[cron] Stopped job: ${name}`);
    }
    tasks.clear();
}
export function stopJobsByPlugin(pluginName) {
    for (const [jobName, owner] of jobPluginMap) {
        if (owner === pluginName) {
            const task = tasks.get(jobName);
            if (task) {
                task.stop();
                console.log(`[cron] Stopped job: ${jobName} (plugin: ${pluginName})`);
            }
        }
    }
}
export function startJobsByPlugin(pluginName) {
    for (const [jobName, owner] of jobPluginMap) {
        if (owner === pluginName) {
            const existing = tasks.get(jobName);
            if (existing) {
                existing.start();
                console.log(`[cron] Restarted job: ${jobName} (plugin: ${pluginName})`);
            }
            else {
                // Re-schedule from stored definition
                const job = jobDefinitions.get(jobName);
                if (job) {
                    scheduleJob(job, pluginName);
                }
            }
        }
    }
}
//# sourceMappingURL=scheduler.js.map
import { prisma } from "@commerceos/database";
import { triggerAutomations } from "./automation-engine.js";

const POLL_MS = 1000;
const STALE_MS = 15 * 60 * 1000;
const HEARTBEAT_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

let running = false;

const processOne = async (): Promise<void> => {
  const staleBefore = new Date(Date.now() - STALE_MS);
  await prisma.automationJob.updateMany({
    where: { status: "RUNNING", lockedAt: { lt: staleBefore } },
    data: { status: "QUEUED", lockedAt: null, availableAt: new Date() },
  });

  const job = await prisma.automationJob.findFirst({
    where: { status: "QUEUED", availableAt: { lte: new Date() } },
    orderBy: { createdAt: "asc" },
  });
  if (!job) return;

  const claimedAt = new Date();
  const claimed = await prisma.automationJob.updateMany({
    where: { id: job.id, status: "QUEUED" },
    data: { status: "RUNNING", lockedAt: claimedAt, attempts: { increment: 1 } },
  });
  if (claimed.count !== 1) return;

  let heartbeat: NodeJS.Timeout | undefined;
  const startHeartbeat = () => {
    heartbeat = setInterval(() => {
      void prisma.automationJob.updateMany({
        where: { id: job.id, status: "RUNNING", lockedAt: claimedAt },
        data: { lockedAt: new Date() },
      }).catch(error => console.error("Automation job heartbeat error", error));
    }, HEARTBEAT_MS);
    heartbeat.unref();
  };
  const stopHeartbeat = () => {
    if (heartbeat) clearInterval(heartbeat);
  };

  try {
    startHeartbeat();
    await triggerAutomations({
      tenantId: job.tenantId,
      trigger: job.trigger as "ORDER_PLACED" | "ORDER_STATUS_CHANGED" | "CUSTOMER_CREATED" | "INVENTORY_LOW",
      eventId: job.eventId,
      customerId: job.customerId,
      data: job.data as Record<string, unknown>,
    });

    const failedExecutions = await prisma.automationExecution.count({
      where: { tenantId: job.tenantId, triggerEventId: job.eventId, status: "FAILED" },
    });

    if (failedExecutions > 0 && job.attempts < MAX_ATTEMPTS) {
      const delay = Math.min(60_000, 2 ** job.attempts * 1000);
      await prisma.automationJob.updateMany({
        where: { id: job.id, status: "RUNNING" },
        data: { status: "QUEUED", lockedAt: null, availableAt: new Date(Date.now() + delay), lastError: `automation execution failed (${failedExecutions})` },
      });
      return;
    }

    await prisma.automationJob.updateMany({
      where: { id: job.id, status: "RUNNING" },
      data: { status: failedExecutions > 0 ? "FAILED" : "SUCCEEDED", lockedAt: null, finishedAt: new Date(), lastError: failedExecutions > 0 ? `automation execution failed (${failedExecutions})` : null },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "automation_job_failed";
    if (job.attempts < MAX_ATTEMPTS) {
      const delay = Math.min(60_000, 2 ** job.attempts * 1000);
      await prisma.automationJob.updateMany({
        where: { id: job.id, status: "RUNNING" },
        data: { status: "QUEUED", lockedAt: null, availableAt: new Date(Date.now() + delay), lastError: message },
      });
    } else {
      await prisma.automationJob.updateMany({
        where: { id: job.id, status: "RUNNING" },
        data: { status: "FAILED", lockedAt: null, finishedAt: new Date(), lastError: message },
      });
    }
  } finally {
    stopHeartbeat();
  }
};

export const startAutomationWorker = (): (() => void) => {
  if (running) return () => undefined;
  running = true;
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try { await processOne(); } catch (error) { console.error("Automation worker error", error); }
    if (!stopped) setTimeout(tick, POLL_MS).unref();
  };
  void tick();
  return () => { stopped = true; running = false; };
};
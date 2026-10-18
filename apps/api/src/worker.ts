import { prisma } from "@commerceos/database";
import { startAutomationWorker } from "./automation-worker.js";
import { startWebhookWorker } from "./webhook-worker.js";

const stop = startAutomationWorker();
const stopWebhooks = startWebhookWorker();
console.log("CommerceOS automation worker started");

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  await Promise.all([stop(), stopWebhooks()]);
  await prisma.$disconnect();
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
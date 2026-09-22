import { prisma } from "@commerceos/database";
import { startAutomationWorker } from "./automation-worker.js";

const stop = startAutomationWorker();
console.log("CommerceOS automation worker started");

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  await stop();
  await prisma.$disconnect();
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
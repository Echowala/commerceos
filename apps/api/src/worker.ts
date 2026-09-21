import { prisma } from "@commerceos/database";
import { startAutomationWorker } from "./automation-worker.js";

const stop = startAutomationWorker();
console.log("CommerceOS automation worker started");

const shutdown = async () => {
  stop();
  await prisma.$disconnect();
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

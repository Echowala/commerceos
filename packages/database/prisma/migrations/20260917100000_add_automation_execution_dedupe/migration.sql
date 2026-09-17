CREATE UNIQUE INDEX "AutomationExecution_automationId_triggerEventId_key"
ON "AutomationExecution"("automationId", "triggerEventId");

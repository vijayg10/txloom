// Worker process entrypoint. BullMQ Worker instances for generate-partition,
// stream-drive, and report-build queues register here as each job lands (US1/US4).

console.log("txloom worker: no queue consumers registered yet");

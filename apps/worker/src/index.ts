// Phase 1 placeholder. Phase 3 will replace this with a BullMQ worker
// processing jobs from Redis. For now we just stay alive and log a heartbeat
// so container orchestration sees a healthy process.

const HEARTBEAT_MS = 30_000;

function heartbeat(): void {
  // Structured-ish log; pino comes in when we wire real jobs.
  console.log(JSON.stringify({ level: 'info', msg: 'worker idle', ts: new Date().toISOString() }));
}

heartbeat();
setInterval(heartbeat, HEARTBEAT_MS);

const shutdown = (signal: string): void => {
  console.log(JSON.stringify({ level: 'info', msg: 'worker shutting down', signal }));
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

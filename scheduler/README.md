# EmailReach Scheduler (Chronos)

Background scheduler that keeps EmailReach sending while no browser tab is open.
Vendored from [udaykiran4383/chronos-job-scheduler](https://github.com/udaykiran4383/chronos-job-scheduler)
(commit `a532736`). Only the backend (`src/`, `deploy/`, `docs/`) was copied; the demo dashboard UI was left out.

Every tick calls `GET {EMAILREACH_URL}/api/cron` with `Authorization: Bearer {CRON_SECRET}`. One tick scans for
bounces, syncs replies, sends the next drip emails and sends follow-ups that are due. EmailReach enforces the
daily limit, send window and random delay between emails itself. A faster tick never sends faster than those limits allow.

## Lite mode (recommended for a laptop or a single server)

No Kafka, etcd or Redis. One process calls the cron endpoint on an interval and skips a tick if the previous one is still running.

```bash
cd scheduler
cp .env.example .env      # set CRON_SECRET (same value as the app) and EMAILREACH_URL
npm install
npm run lite
```

Run only one lite process at a time.

## Full mode (distributed, fault-tolerant)

- **Scheduler nodes** hold an etcd leader election. Only the leader dispatches an `emailreach-tick` job each
  `EMAILREACH_TICK_SECONDS`.
- **Job ids** are derived from the tick window (`emailreach-tick-<window>`) and claimed with Redis `SET NX`, so a
  leader failover never dispatches the same tick twice.
- **Workers** consume ticks from Kafka. A failed tick is retried up to 3 times, with backoff of 2s and then 4s.
- **Monitoring:** Prometheus scrapes `/metrics` on the schedulers (ports 3101 and 3102; port 3000 is left for Next.js).

```bash
cd scheduler
CRON_SECRET=... docker compose -f deploy/docker-compose.yml up --build
```

Inside Docker, the app running on your host is reached at `http://host.docker.internal:3000` (this is the default).
For Kubernetes, see `deploy/k8s/` and `docs/DEPLOYMENT.md`. The workers read `EMAILREACH_URL` and `CRON_SECRET`
from a secret named `emailreach`.

## Environment

| Variable | Default | Used by |
|---|---|---|
| `EMAILREACH_URL` | `http://localhost:3000` | lite, worker |
| `CRON_SECRET` | none (required) | lite, worker |
| `EMAILREACH_TICK_SECONDS` | `60` (minimum 10) | lite, scheduler |
| `ETCD_HOSTS`, `KAFKA_BROKERS`, `REDIS_URL`, `PORT` | see `.env.example` | full mode |

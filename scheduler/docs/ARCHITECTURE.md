# Chronos Architecture Deep Dive

## System Design Principles

### 1. **Separation of Concerns**
- **Scheduler:** Coordinates job scheduling and leader election
- **Worker:** Executes jobs independently
- **Kafka:** Decouples job submission from execution
- **Etcd:** Handles distributed consensus
- **Redis:** Manages state and idempotency

### 2. **Fault Tolerance**
- Single points of failure are eliminated via replication
- Graceful degradation when services fail
- Automatic recovery without manual intervention

### 3. **Horizontal Scalability**
- Stateless services (workers) scale linearly
- Kafka partitions enable parallel processing
- Load automatically distributed across replicas

---

## Component Architecture

### Scheduler Service

**Responsibility:** API server + leader coordination

```typescript
// Core lifecycle
1. Initialize Etcd connection (leader election)
2. Start Express HTTP server
3. Campaign for leadership
4. If elected leader:
   - Start periodic job scheduler (5s interval)
   - Generate auto-scheduled jobs from database
   - Push jobs to Kafka
5. If demoted to follower:
   - Stop scheduler loop
   - Remain ready for failover
```

**Key Endpoints:**
- `POST /submit` - User-submitted jobs
- `GET /jobs/:jobId` - Job status lookup
- `GET /status` - Node leadership status
- `GET /health` - Health check (liveness probe)
- `GET /metrics` - Prometheus metrics

**Scaling:** Fixed at 3 replicas, only 1 is active (leader)

### Worker Service

**Responsibility:** Job execution and result handling

```typescript
// Core lifecycle
1. Connect to Kafka consumer group
2. Subscribe to 'chronos-jobs' topic
3. Enter message loop:
   - Consume message from Kafka
   - Deserialize job JSON
   - Execute job handler (email, report, etc)
   - Record metrics (success/failure)
   - Commit offset (at-least-once semantics)
4. Handle graceful shutdown (finish in-flight jobs)
```

**Job Processing:**
```
Kafka Message
    ↓
Deserialize Job
    ↓
Check Redis (idempotency) - skip if exists
    ↓
Execute job handler
    ├─ Email: send via SMTP
    ├─ Report: generate PDF/Excel
    ├─ Data: process ETL pipeline
    └─ Custom: user-defined logic
    ↓
Update Redis status
    ↓
Record Prometheus metrics
    ↓
Commit Kafka offset
```

**Scaling:** Horizontal (1→100+ replicas)
- Each replica joins consumer group
- Kafka auto-distributes partitions
- Adding workers increases throughput

### Etcd (Leader Election)

**Mechanism:** Distributed consensus via Raft algorithm

```
┌─────────────────────────────────────────┐
│          Etcd Cluster (3 nodes)         │
├─────────────────────────────────────────┤
│                                         │
│  Key: /chronos/leader                  │
│  Value: "scheduler-xyz789" (node ID)   │
│  TTL: 30 seconds (auto-renew by leader)│
│                                         │
│  Election logic:                        │
│  - Every scheduler campaigns (compare)  │
│  - If no leader or key expired → win   │
│  - If different leader → wait for TTL  │
│  - Raft consensus ensures 1 leader     │
│                                         │
└─────────────────────────────────────────┘
```

**Failure Scenario:**
```
Time: 0s   Leader (node-A) holds key, TTL=30s
Time: 15s  Leader refreshes: TTL reset to 30s
Time: 25s  Leader crashes (dies)
Time: 30s  Key expires in Etcd
Time: 30s+ Other nodes see empty key
Time: 31s  Node-B wins election, becomes new leader
           Jobs continue processing seamlessly
```

### Kafka (Job Distribution)

**Design:** Pub/Sub event streaming

```
┌─────────────────────────────────────────┐
│      Topic: chronos-jobs (6 partitions) │
├─────────────────────────────────────────┤
│                                         │
│  Partition 0: Messages 0, 6, 12, ...   │
│  Partition 1: Messages 1, 7, 13, ...   │
│  Partition 2: Messages 2, 8, 14, ...   │
│  ... (more partitions)                 │
│                                         │
│  Consumer Group: chronos-worker-group  │
│  ├─ Worker-1: Consumes P0, P3         │
│  ├─ Worker-2: Consumes P1, P4         │
│  ├─ Worker-3: Consumes P2, P5         │
│  └─ More workers: get assigned...     │
│                                         │
│  Guarantees:                            │
│  - At-least-once: Offset committed     │
│  - Order: Per-partition ordering       │
│  - Durability: Broker replication      │
│                                         │
└─────────────────────────────────────────┘
```

**Message Format:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "type": "email",
  "payload": {
    "to": "user@example.com",
    "subject": "Hello"
  },
  "createdAt": "2024-01-15T10:30:00Z"
}
```

### Redis (Idempotency + State)

**Pattern:** Distributed cache with TTL

```
Key Format: job:{jobId}
Value: "queued" | "processing" | "completed"
TTL: Varies
  - While processing: 1 hour
  - After completion: 24 hours

Use Case 1: Duplicate Prevention
  Request 1: POST /submit (jobId: ABC)
    → Check Redis: MISS
    → SET job:ABC "queued" EX 3600
    → Send to Kafka
    → Response 202

  Request 2: POST /submit (same jobId)
    → Check Redis: HIT (value: "queued")
    → Return 409 Conflict
    → Skip Kafka send

Use Case 2: Status Tracking
  Query: GET /jobs/{jobId}
    → Lookup Redis: job:{jobId}
    → Return status if exists
    → Return 404 if expired/missing
```

**Data Persistence:**
```bash
redis-cli
> KEYS job:*
> GET job:550e8400-e29b-41d4-a716-446655440000
"queued"
> TTL job:550e8400-e29b-41d4-a716-446655440000
3456 (seconds remaining)
```

### Prometheus (Observability)

**Metrics Collection:**

```
chronos_jobs_submitted_total
└─ Counter: incremented on each /submit request
   Labels: type (email, report, etc)
   Use: Calculate submission rate
   Query: rate(chronos_jobs_submitted_total[5m])

chronos_jobs_processed_total
└─ Counter: incremented on job completion
   Labels: type, result (success/failure)
   Use: Calculate processing rate
   Query: rate(chronos_jobs_processed_total[5m])

chronos_job_processing_duration_seconds
└─ Histogram: distribution of job processing times
   Buckets: 0.1s, 0.5s, 1s, 2s, 5s, 10s
   Use: Calculate p50, p95, p99 latencies
   Query: histogram_quantile(0.95, rate(...[5m]))

chronos_queue_depth
└─ Gauge: current number of pending jobs
   Use: Detect queue buildup
   Query: chronos_queue_depth

chronos_active_workers
└─ Gauge: number of active worker pods
   Use: Monitor worker pool utilization
   Query: chronos_active_workers

chronos_leader_election_changes_total
└─ Counter: number of leadership transitions
   Use: Detect stability issues
   Query: rate(chronos_leader_election_changes_total[1h])
```

---

## Data Flow

### Complete Request Lifecycle

```
User Request
  │
  ├─→ POST /submit
  │    │
  │    ├─ Validate input
  │    ├─ Generate UUID (jobId)
  │    ├─ Check Redis: job exists? → 409 Conflict
  │    ├─ Mark Redis: job:ABC = "queued"
  │    ├─ Serialize to JSON
  │    ├─ Send to Kafka:chronos-jobs (partition by jobId)
  │    └─ Response: 202 Accepted
  │
  ├─→ Kafka Broker Replication
  │    ├─ Broker 1: stores message
  │    ├─ Broker 2: replicates
  │    ├─ Broker 3: replicates
  │    └─ All ACK → response to scheduler
  │
  ├─→ Worker Consumption
  │    ├─ Worker-1 consumer group polls Kafka
  │    ├─ Gets message from assigned partition
  │    ├─ Deserialize job JSON
  │    ├─ Execute job handler (e.g., send email)
  │    ├─ Update Redis: job:ABC = "completed"
  │    ├─ Record metrics: jobs_processed_total++
  │    ├─ Commit offset to Kafka
  │    └─ Return to message loop
  │
  └─→ Query Status
       ├─ GET /jobs/ABC
       ├─ Lookup Redis: job:ABC
       ├─ Return status
       └─ Response: 200 OK
```

---

## Failure Scenarios & Recovery

### Scenario 1: Leader Dies

```
T=0:    Leader has key /chronos/leader (TTL 30s)
T=15:   Leader crash (SIGKILL)
T=30:   Key expires in Etcd
T=31:   Another scheduler's campaign succeeds
        - Becomes leader
        - Starts scheduler loop
        - Auto-scheduled jobs resume
        
Result: RTO < 2 minutes
        RPO < 5 minutes (jobs already in Kafka)
```

### Scenario 2: Worker Pod Crashes

```
T=0:    Worker-3 processing job "report-123" (took 30s)
        Kafka offset: 5000
        
T=30:   Worker-3 crashes mid-job
        Job NOT marked complete in Redis
        Kafka offset NOT committed
        
T=35:   Kubernetes restarts Worker-3
        Consumer group rebalance triggers
        Kafka re-assigns partitions
        
T=40:   Worker-4 (new) consumes from offset 5000
        "report-123" redelivered
        Redis check: job NOT marked complete
        Re-executes job
        
Result: At-least-once processing
        (May execute job twice on failure)
```

### Scenario 3: Kafka Broker Failure

```
Kafka Cluster: 3 brokers, replication factor = 3

T=0:    Broker-1 dies
T=1:    ISR (in-sync replicas) shrinks from [1,2,3] to [2,3]
T=2:    Kafka still operational on brokers 2 & 3
        Scheduler can still send jobs
        
T=5:    Broker-1 rejoins cluster
T=6:    ISR recovers to [1,2,3]
        Normal operation resumes
        
Result: No data loss (replicated 3x)
        Brief latency increase during rebalance
```

### Scenario 4: Network Partition

```
Scheduler cluster: [A, B, C]
Network split: {A} isolated vs {B, C}

Partition 1 (A):
  - Can't reach Etcd (majority in other partition)
  - Loses leadership (key expires)
  - Stops job generation
  - Continues accepting API requests (read-only)

Partition 2 (B, C):
  - Has Etcd quorum
  - B or C becomes leader
  - Jobs continue generation
  - API accepts requests

When healed:
  - Single leader elected (based on Raft term)
  - Duplicate jobs in Kafka handled by Redis idempotency
  
Result: CAP theorem - chose Consistency & Availability
```

---

## Performance Characteristics

### Throughput Analysis

```
Single Scheduler:
  - API latency: ~5-10ms (network I/O)
  - Kafka send latency: ~1-2ms
  - Redis check latency: <1ms
  - Total: ~7-13ms per submit

Single Worker:
  - Kafka poll: batches 100-500 messages
  - Job processing: 500ms-5s (depends on job type)
  - Throughput: ~100-200 jobs/second per worker
  
Cluster Throughput:
  10 Workers × 150 jobs/sec = 1500 jobs/second
  100 Workers × 150 jobs/sec = 15,000 jobs/second
  
Kafka Throughput (internal):
  - 6 partitions × 3 brokers × 10MB/s = 180MB/s theoretical
  - ~1 million jobs/second (at 200 bytes per job)
```

### Latency Distribution

```
Submission to Completion (at-scale):
  ├─ Network latency (submit): 5-10ms
  ├─ Kafka write + replication: 1-5ms
  ├─ Kafka poll + consumer lag: 10-100ms
  ├─ Job execution: 500ms-5s (variable)
  ├─ Metric recording + offset commit: 1-2ms
  └─ Total p95: 1-10s (job-dependent)
  
Queue latency (when backlogged):
  ├─ No backlog: <1s
  ├─ 10k jobs backlog: ~10-20s
  ├─ 100k jobs backlog: ~100-200s
  └─ Solution: Scale workers, add Kafka partitions
```

---

## Security Considerations

### Network Security
- Use mTLS between services
- Kafka SASL/SCRAM authentication
- Etcd encrypted endpoints
- Redis AUTH protocol

### Data Security
- Job payloads encrypted at rest (Redis/Kafka)
- API TLS/HTTPS
- Sensitive fields masked in logs
- Audit logging for compliance

### Access Control
- Kubernetes RBAC for pod execution
- Service accounts for inter-pod communication
- Network policies for ingress/egress
- API key authentication (future enhancement)

---

## Cost Optimization

### Kubernetes Cluster Sizing

```
Minimum (dev/staging):
  - 3 K8s nodes (t3.medium)
  - 6GB RAM total
  - Etcd: 1GB
  - Kafka: 2GB
  - Workers: 2GB

Recommended (production):
  - 6+ K8s nodes (c5.xlarge or better)
  - 48GB+ RAM
  - Etcd: 4GB (HA setup)
  - Kafka: 16GB (3 replicas)
  - Workers: 20GB (scales 5-50 replicas)

Cost estimate (AWS):
  - 6 × c5.xlarge: ~$5000/month
  - EBS volumes (PVCs): ~$500/month
  - Data transfer: ~$200/month
  - Total: ~$5700/month for HA setup
```

### Optimization Strategies

1. **Auto-scaling:**
   - HPA scales workers down to 0 during low traffic
   - Schedule batch jobs during off-peak hours
   - Cost savings: 40-60%

2. **Resource Efficiency:**
   - Kafka compression (gzip) reduces network I/O
   - Worker batching reduces Kafka polls
   - Cost savings: 20-30%

3. **Reserved Instances:**
   - Purchase 1-year RIs for baseline capacity
   - Cost savings: 30-40%

---

## Monitoring & Alerts

### Critical Alerts

```yaml
- Alert: LeaderElectionFailure
  Condition: rate(leader_changes[5m]) > 1/min
  Action: Page on-call engineer
  
- Alert: QueueBacklog
  Condition: queue_depth > 10000
  Action: Auto-scale workers or page team
  
- Alert: HighFailureRate
  Condition: failure_rate > 0.05 (5%)
  Action: Investigate logs, check external dependencies
  
- Alert: WorkerPodCrashing
  Condition: rate(pod_restarts[5m]) > 0
  Action: Review logs, check resource limits
```

---

## Future Enhancements

1. **Dead Letter Queue (DLQ)**
   - Store failed jobs for later retry
   - Implement exponential backoff strategy

2. **gRPC Interface**
   - Use gRPC for inter-service communication
   - Reduce latency vs REST/JSON

3. **Multi-region Deployment**
   - Etcd federation across regions
   - Kafka cluster linking (cross-region replication)
   - Global job routing

4. **Machine Learning Integration**
   - Predict job execution time
   - Auto-scale workers based on forecast
   - Anomaly detection for failures

5. **Database Integration**
   - Store job history in PostgreSQL
   - Enable complex queries (filter by date, type, etc)
   - Compliance audit trails

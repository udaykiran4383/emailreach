# Chronos - Visual Architecture Guide

## System Topology

```
┌────────────────────────────────────────────────────────────────────────────┐
│                              EXTERNAL CLIENTS                              │
│                    (REST API, Job Submission Requests)                     │
└──────────────────────┬──────────────────────────────────────────────────────┘
                       │
                       │ HTTP POST /submit
                       │ HTTP GET /jobs/:id
                       │ HTTP GET /metrics
                       ↓
┌──────────────────────────────────────────────────────────────────────────┐
│                    SCHEDULER CLUSTER (3 nodes)                          │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         │
│  │  Scheduler 1    │  │  Scheduler 2    │  │  Scheduler 3    │         │
│  │   (LEADER)      │  │  (FOLLOWER)     │  │  (FOLLOWER)     │         │
│  │                 │  │                 │  │                 │         │
│  │ • API Server    │  │ • API Server    │  │ • API Server    │         │
│  │ • Etcd Client   │  │ • Etcd Client   │  │ • Etcd Client   │         │
│  │ • Metrics       │  │ • Metrics       │  │ • Metrics       │         │
│  │ • Job Generator │  │ • Idle          │  │ • Idle          │         │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘         │
│           │                    │                    │                   │
│           └────────────────────┼────────────────────┘                   │
│                                │                                        │
│                        Leader Election via                              │
│                        Etcd Consensus (Raft)                           │
│                                                                         │
└─────────────────────────────┬──────────────────────────────────────────┘
                              │
                ┌─────────────┴──────────────┐
                │                            │
                ↓                            ↓
    ┌───────────────────┐      ┌───────────────────┐
    │  ETCD CLUSTER     │      │  KAFKA CLUSTER    │
    │  (Consensus)      │      │  (Event Streaming)│
    ├───────────────────┤      ├───────────────────┤
    │                   │      │                   │
    │ • Leader Key      │      │ Topic: jobs       │
    │ • TTL: 30s        │      │ Partitions: 6     │
    │ • Raft Election   │      │ Replication: 3    │
    │                   │      │ Retention: 24h    │
    └─────────┬─────────┘      └───────────┬───────┘
              │                            │
              │                            │
              │                ┌───────────┴───────────┐
              │                │                       │
              │                ↓                       ↓
              │           ┌──────────────┐      ┌──────────────┐
              │           │  Kafka Broker│      │  Kafka Broker│
              │           │    #1        │      │    #2        │
              │           └──────────────┘      └──────────────┘
              │                │                       │
              │                └───────────┬───────────┘
              │                            │
              │                            ↓
              │                ┌───────────────────┐
              │                │  Message Stream   │
              │                │  (Job Data)       │
              │                │                   │
              │                │ {id, type,       │
              │                │  payload, ts}    │
              │                └─────────┬─────────┘
              │                          │
              │                          │
              │        ┌─────────────────┼─────────────────┐
              │        │                 │                 │
              │        ↓                 ↓                 ↓
              │    ┌─────────┐      ┌─────────┐      ┌─────────┐
              │    │ Worker 1│      │ Worker 2│      │ Worker 3│
              │    └─────────┘      └─────────┘      └─────────┘
              │        │                 │                 │
              │        └─────────────────┼─────────────────┘
              │                          │
              │                          ↓
              │              ┌───────────────────┐
              │              │  REDIS CACHE      │
              │              │  (Idempotency)    │
              │              ├───────────────────┤
              │              │                   │
              │              │ Key: job:{id}     │
              │              │ Val: status       │
              │              │ TTL: 1-24h        │
              │              │                   │
              │              └───────────────────┘
              │
              ↓
    ┌───────────────────┐
    │  PROMETHEUS       │
    │  (Metrics)        │
    ├───────────────────┤
    │                   │
    │ • Counters        │
    │ • Histograms      │
    │ • Gauges          │
    │ • Time Series     │
    │                   │
    └───────────────────┘
```

## Data Flow - Job Lifecycle

```
STEP 1: JOB SUBMISSION
┌──────────────────────┐
│  User/Application    │
│  (HTTP Client)       │
└──────────┬───────────┘
           │
           │ POST /submit
           │ {type: "email", payload: {...}}
           ↓
┌──────────────────────┐
│  Scheduler Service   │
│  (Express.js)        │
├──────────────────────┤
│ 1. Validate input    │
│ 2. Generate UUID     │
│ 3. Check Redis       │
│ 4. SET Redis key     │
└──────────┬───────────┘
           │
           │ 202 Accepted
           ↓
        [Client]
        
        
STEP 2: KAFKA PUBLISHING
┌──────────────────────┐
│  Scheduler Service   │
│  (Producer)          │
├──────────────────────┤
│ 1. Serialize job     │
│ 2. Partition by ID   │
│ 3. Send to Kafka     │
│ 4. Wait for ACK      │
└──────────┬───────────┘
           │
           │ Message
           ↓
┌──────────────────────┐
│  Kafka Broker        │
│  (Topic: jobs)       │
├──────────────────────┤
│ 1. Replicate 3x      │
│ 2. Store in log      │
│ 3. Return ACK        │
└──────────┬───────────┘
           │
           │ Durable
           ↓
        [Durable]
        
        
STEP 3: WORKER CONSUMPTION
┌──────────────────────┐
│  Worker Pod          │
│  (Kafka Consumer)    │
├──────────────────────┤
│ 1. Poll Kafka        │
│ 2. Deserialize       │
│ 3. Execute handler   │
│ 4. Update Redis      │
│ 5. Commit offset     │
└──────────┬───────────┘
           │
           │ Processing
           ↓
        [Complete]
        
        
STEP 4: STATUS QUERY
┌──────────────────────┐
│  User/Application    │
│  (HTTP Client)       │
├──────────────────────┤
│ GET /jobs/{jobId}    │
└──────────┬───────────┘
           │
           ↓
┌──────────────────────┐
│  Scheduler Service   │
├──────────────────────┤
│ 1. Lookup Redis      │
│ 2. Return status     │
└──────────┬───────────┘
           │
           │ {status: "completed"}
           ↓
        [Client]
```

## Failure Recovery - Leader Election

```
TIME 0: HEALTHY STATE
┌─────────────────────────────────────────────────────┐
│ Scheduler Cluster (Etcd Consensus)                 │
├─────────────────────────────────────────────────────┤
│                                                     │
│ ┌──────────────┐  ┌──────────────┐ ┌──────────────┐│
│ │ Scheduler 1  │  │ Scheduler 2  │ │ Scheduler 3  ││
│ │   LEADER     │  │  FOLLOWER    │ │  FOLLOWER    ││
│ │ /leader=S1   │  │              │ │              ││
│ │ TTL:30s      │  │              │ │              ││
│ └──────────────┘  └──────────────┘ └──────────────┘│
│       ↑                                              │
│     Renew                                            │
│     every                                            │
│     10s                                              │
│                                                     │
└─────────────────────────────────────────────────────┘


TIME 15: LEADER CRASH
┌─────────────────────────────────────────────────────┐
│ Scheduler Cluster (Etcd Consensus)                 │
├─────────────────────────────────────────────────────┤
│                                                     │
│ ┌──────────────┐  ┌──────────────┐ ┌──────────────┐│
│ │ Scheduler 1  │  │ Scheduler 2  │ │ Scheduler 3  ││
│ │   CRASHED    │  │  FOLLOWER    │ │  FOLLOWER    ││
│ │ ✗            │  │              │ │              ││
│ └──────────────┘  └──────────────┘ └──────────────┘│
│                         ↑                  ↑        │
│                      Campaign            Campaign   │
��                                                     │
└─────────────────────────────────────────────────────┘


TIME 30: KEY EXPIRES IN ETCD
┌─────────────────────────────────────────────────────┐
│ Etcd Cluster                                        │
├─────────────────────────────────────────────────────┤
│                                                     │
│ /leader = <expired>  ← TTL hit, key deleted        │
│                                                     │
└─────────────────────────────────────────────────────┘


TIME 31: NEW LEADER ELECTED (Raft Consensus)
┌─────────────────────────────────────────────────────┐
│ Scheduler Cluster (Etcd Consensus)                 │
├─────────────────────────────────────────────────────┤
│                                                     │
│ ┌──────────────┐  ┌──────────────┐ ┌──────────────┐│
│ │ Scheduler 1  │  │ Scheduler 2  │ │ Scheduler 3  ││
│ │   CRASHED    │  │   LEADER     │ │  FOLLOWER    ││
│ │ ✗            │  │ /leader=S2   │ │              ││
│ │              │  │ TTL:30s      │ │              ││
│ └──────────────┘  └──────────────┘ └──────────────┘│
│                       ↑                              │
│                     Running job                     │
│                     scheduler loop                  │
│                                                     │
└─────────────────────────────────────────────────────┘

RESULT: RTO < 30 seconds, Zero job loss
        Jobs already in Kafka, processing continues
```

## Scaling Pattern - Worker Expansion

```
SCENARIO 1: LOW LOAD
┌─────────────────────────────────────────────────────┐
│ Kafka Topic: chronos-jobs (6 partitions)           │
├─────────────────────────────────────────────────────┤
│                                                     │
│ Partition 0 ──┐                                     │
│ Partition 1 ──┤                                     │
│ Partition 2 ──┼─→ Consumer Group (2 workers)       │
│ Partition 3 ──┤   • Worker 1: P0, P2, P4           │
│ Partition 4 ──┤   • Worker 2: P1, P3, P5           │
│ Partition 5 ──┘                                     │
│                                                     │
│ Queue depth: 100 messages                          │
│ Processing rate: 200 msgs/sec → Idle 95% of time  │
│                                                     │
└─────────────────────────────────────────────────────┘


SCENARIO 2: HIGH LOAD (SCALE UP)
┌─────────────────────────────────────────────────────┐
│ Kafka Topic: chronos-jobs (6 partitions)           │
├─────────────────────────────────────────────────────┤
│                                                     │
│ Partition 0 ──┐                                     │
│ Partition 1 ──┼─→ Consumer Group (6 workers)       │
│ Partition 2 ──┼─→ • Worker 1: P0                   │
│ Partition 3 ──┼─→ • Worker 2: P1                   │
│ Partition 4 ──┼─→ • Worker 3: P2                   │
│ Partition 5 ──┴─→ • Worker 4: P3                   │
│                   • Worker 5: P4                   │
│                   • Worker 6: P5                   │
│                   (1:1 partition mapping)          │
│                                                     │
│ Queue depth: 10,000 messages                       │
│ Processing rate: 1,200 msgs/sec → Fully utilized  │
│ New: 1,200 × 6 workers = 7,200 msgs/sec max       │
│                                                     │
└─────────────────────────────────────────────────────┘

ADD MORE PARTITIONS:

Kafka Topic: chronos-jobs (12 partitions)
├─────────────────────────────────────────────────────┤
│ Can now add 6 more workers for even higher load    │
│ Max throughput: 1,200 msgs/sec × 12 workers       │
│                = 14,400 msgs/sec total            │
│                                                     │
│ This is how we achieve 15,000+ jobs/second        │
└─────────────────────────────────────────────────────┘
```

## Kubernetes Deployment Topology

```
┌────────────────────────────────────────────────────────────────┐
│ Kubernetes Cluster (chronos namespace)                        │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ Infrastructure (StatefulSets)                           │  │
│  ├─────────────────────────────────────────────────────────┤  │
│  │                                                         │  │
│  │ ┌──────────┐  ┌──────────┐  ┌──────────┐              │  │
│  │ │ Etcd-0   │  │ Redis-0  │  │ Kafka-0  │              │  │
│  │ │ (1 pod)  │  │ (1 pod)  │  │ (3 pods) │              │  │
│  │ │ 10GB PVC │  │ 10GB PVC │  │ 20GB PVC │              │  │
│  │ └──────────┘  └──────────┘  ├──────────┤              │  │
│  │                             │ Kafka-1  │              │  │
│  │                             ├──────────┤              │  │
│  │                             │ Kafka-2  │              │  │
│  │                             └──────────┘              │  │
│  │                                                         │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                                │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ Scheduler Cluster (Deployment + HPA)                   │  │
│  ├─────────────────────────────────────────────────────────┤  │
│  │                                                         │  │
│  │ ┌──────────────────────────────────────────────────┐   │  │
│  │ │ Replicas: 3 (min), 10 (max)                      │   │  │
│  │ │ HPA: scales on CPU (70%) & Memory (80%)         │   │  │
│  │ │                                                  │   │  │
│  │ │  Pod: scheduler-0        Pod: scheduler-1       │   │  │
│  │ │  ┌──────────────────┐   ┌──────────────────┐   │   │  │
│  │ │  │ scheduler:3000   │   │ scheduler:3000   │   │   │  │
│  │ │  │ 256Mi, 250m CPU  │   │ 256Mi, 250m CPU  │   │   │  │
│  │ │  └──────────────────┘   └──────────────────┘   │   │  │
│  │ │                                                  │   │  │
│  │ │  (more pods as needed)                           │   │  │
│  │ │                                                  │   │  │
│  │ └──────────────────────────────────────────────────┘   │  │
│  │                     │                                   │  │
│  │           Service: chronos-scheduler-service           │  │
│  │           Type: ClusterIP                              │  │
│  │           Port: 3000                                   │  │
│  │                                                         │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                                │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ Worker Pool (Deployment + HPA)                         │  │
│  ├─────────────────────────────────────────────────────────┤  │
│  │                                                         │  │
│  │ ┌──────────────────────────────────────────────────┐   │  │
│  │ │ Replicas: 5 (min), 20 (max)                      │   │  │
│  │ │ HPA: scales on CPU (75%) & Memory (85%)         │   │  │
│  │ │                                                  │   │  │
│  │ │ ┌──────────┐ ┌──────────┐ ┌──────────┐ ...      │   │  │
│  │ │ │ worker-0 │ │ worker-1 │ │ worker-2 │         │   │  │
│  │ │ │512Mi,500m│ │512Mi,500m│ │512Mi,500m│         │   │  │
│  │ │ └──────────┘ └──────────┘ └──────────┘         │   │  │
│  │ │                                                  │   │  │
│  │ └──────────────────────────────────────────────────┘   │  │
│  │                                                         │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                                │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ Monitoring (Deployment)                               │  │
│  ├─────────────────────────────────────────────────────────┤  │
│  │                                                         │  │
│  │ ┌──────────────────────────────────────────────────┐   │  │
│  │ │ Prometheus:9090 (1 replica)                      │   │  │
│  │ │ Scrapes: localhost:3000/metrics (schedulers)    │   │  │
│  │ │                                                  │   │  │
│  │ │ Service: prometheus-service (ClusterIP)         │   │  │
│  │ │                                                  │   │  │
│  │ └──────────────────────────────────────────────────┘   │  │
│  │                                                         │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

## Metrics Collection Pipeline

```
APPLICATIONS
    │
    │ Generate metrics
    │
    ↓
┌──────────────────────────────────────┐
│ Prometheus Client Library (prom-client)
├──────────────────────────────────────┤
│                                      │
│ Counters:                            │
│ • jobs_submitted_total               │
│ • jobs_processed_total               │
│ • jobs_failed_total                  │
│ • leader_election_changes_total      │
│                                      │
│ Histograms:                          │
│ • job_processing_duration_seconds    │
│                                      │
│ Gauges:                              │
│ • queue_depth                        │
│ • active_workers                     │
│                                      │
└───────────────┬──────────────────────┘
                │
                │ /metrics endpoint
                │ (Prometheus format)
                ↓
         ┌─────────────────┐
         │ Prometheus      │
         │ (TSDB)          │
         ├─────────────────┤
         │                 │
         │ Scrape every:   │
         │ 10 seconds      │
         │                 │
         │ Retention:      │
         │ 7 days (local)  │
         │                 │
         └────────┬────────┘
                  │
        ┌─────────┼─────────┐
        │         │         │
        ↓         ↓         ↓
    ┌────────┐ ┌────────┐ ┌────────┐
    │Grafana │ │Alerts  │ │API     │
    │Dashboard│ │Engine  │ │(curl)  │
    └────────┘ └────────┘ └────────┘
```

## Complete Request Journey

```
USER REQUEST:
┌─────────────────────────────────────────────────────────────┐
│ curl -X POST http://api.example.com/submit                 │
│      -H "Content-Type: application/json"                   │
│      -d '{"type":"email","payload":{"to":"user@ex.com"}}'  │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ↓
         ┌───────────────────────┐
         │ SCHEDULER CLUSTER     │
         │ (Load Balanced)       │
         └───────┬───────────────┘
                 │
                 ├─→ [Express Handler]
                 │   1. Parse JSON
                 │   2. Validate input
                 │   3. Generate UUID: abc-123
                 │
                 ├─→ [Redis Check]
                 │   GET job:abc-123
                 │   Response: nil
                 │
                 ├─→ [Redis Store]
                 │   SET job:abc-123 "queued" EX 3600
                 │   Response: OK
                 │
                 ├─→ [Kafka Send]
                 │   Topic: chronos-jobs
                 │   Key: abc-123
                 │   Value: {id, type, payload, ts}
                 │   Partition: hash(key) % 6 = 2
                 │   Replicas: 3x
                 │
                 └─→ [HTTP Response]
                     Status: 202 Accepted
                     {
                       "jobId": "abc-123",
                       "status": "queued"
                     }

                     ↓ (Async continues...)

                     Kafka replicates to 3 brokers
                     Worker polls from partition 2
                     Worker processes job:
                       1. Deserialize
                       2. Execute handler
                       3. Update Redis: "completed"
                       4. Commit offset
                     
                     Query status:
                     GET /jobs/abc-123
                     → Lookup Redis: "completed"
                     → Response 200
```

This visual guide helps you understand the system at a glance. Use it when explaining the architecture to others!

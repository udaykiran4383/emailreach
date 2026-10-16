# Chronos API Examples

## Testing the Job Scheduler

### 1. Health Check

```bash
curl -X GET http://localhost:3000/health
```

Response:
```json
{
  "status": "ok",
  "nodeId": "scheduler-xyz789",
  "isLeader": true,
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### 2. Submit Email Job

```bash
curl -X POST http://localhost:3000/submit \
  -H "Content-Type: application/json" \
  -d '{
    "type": "email",
    "payload": {
      "to": "user@example.com",
      "subject": "Welcome to Chronos",
      "body": "Your job has been queued for processing!"
    }
  }'
```

Response:
```json
{
  "status": "queued",
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "message": "Job has been queued for processing"
}
```

### 3. Submit Report Generation Job

```bash
curl -X POST http://localhost:3000/submit \
  -H "Content-Type: application/json" \
  -d '{
    "type": "report",
    "payload": {
      "reportType": "sales-summary",
      "filters": {
        "startDate": "2024-01-01",
        "endDate": "2024-01-31",
        "region": "North America"
      }
    }
  }'
```

### 4. Submit Custom Job

```bash
curl -X POST http://localhost:3000/submit \
  -H "Content-Type: application/json" \
  -d '{
    "type": "data-processing",
    "payload": {
      "source": "s3://bucket/data.csv",
      "destination": "postgres://db:5432/processed",
      "transformation": "normalize_and_deduplicate"
    }
  }'
```

### 5. Check Job Status

```bash
# Replace {jobId} with actual job ID from submit response
curl -X GET http://localhost:3000/jobs/550e8400-e29b-41d4-a716-446655440000
```

Response:
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "checkedAt": "2024-01-15T10:35:00Z"
}
```

### 6. Get Node Status (Leadership Info)

```bash
curl -X GET http://localhost:3000/status
```

Response:
```json
{
  "nodeId": "scheduler-xyz789",
  "isLeader": true,
  "role": "LEADER",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### 7. Get Prometheus Metrics

```bash
curl -X GET http://localhost:3000/metrics
```

Response:
```
# HELP chronos_jobs_submitted_total Total number of jobs submitted via API
# TYPE chronos_jobs_submitted_total counter
chronos_jobs_submitted_total 2451

# HELP chronos_jobs_processed_total Total number of jobs successfully processed
# TYPE chronos_jobs_processed_total counter
chronos_jobs_processed_total 2440

# HELP chronos_jobs_failed_total Total number of jobs that failed
# TYPE chronos_jobs_failed_total counter
chronos_jobs_failed_total 11

# HELP chronos_job_processing_duration_seconds Time taken to process a job in seconds
# TYPE chronos_job_processing_duration_seconds histogram
chronos_job_processing_duration_seconds_bucket{le="0.1"} 145
chronos_job_processing_duration_seconds_bucket{le="0.5"} 1203
chronos_job_processing_duration_seconds_bucket{le="1"} 1892
chronos_job_processing_duration_seconds_bucket{le="2"} 2301
chronos_job_processing_duration_seconds_bucket{le="5"} 2405
chronos_job_processing_duration_seconds_bucket{le="10"} 2440
chronos_job_processing_duration_seconds_bucket{le="+Inf"} 2440

# HELP chronos_queue_depth Current number of jobs in the queue
# TYPE chronos_queue_depth gauge
chronos_queue_depth 23

# HELP chronos_active_workers Number of active worker instances
# TYPE chronos_active_workers gauge
chronos_active_workers 5

# HELP chronos_leader_election_changes_total Total number of leader changes
# TYPE chronos_leader_election_changes_total counter
chronos_leader_election_changes_total 2
```

## Batch Testing Script

Save as `test-api.sh`:

```bash
#!/bin/bash

BASE_URL="http://localhost:3000"
JOB_IDS=()

echo "=== Testing Chronos Job Scheduler ==="

# Test 1: Health check
echo -e "\n1. Health Check"
curl -s -X GET "$BASE_URL/health" | jq .

# Test 2: Submit 5 jobs
echo -e "\n2. Submitting 5 Jobs"
for i in {1..5}; do
  JOB_ID=$(curl -s -X POST "$BASE_URL/submit" \
    -H "Content-Type: application/json" \
    -d "{
      \"type\": \"email\",
      \"payload\": {
        \"to\": \"user$i@example.com\",
        \"subject\": \"Test Email $i\",
        \"body\": \"This is test email number $i\"
      }
    }" | jq -r '.jobId')
  
  JOB_IDS+=("$JOB_ID")
  echo "  Job $i: $JOB_ID"
done

# Test 3: Check status of submitted jobs
echo -e "\n3. Checking Job Status"
sleep 2
for JOB_ID in "${JOB_IDS[@]}"; do
  STATUS=$(curl -s -X GET "$BASE_URL/jobs/$JOB_ID" | jq -r '.status')
  echo "  Job $JOB_ID: $STATUS"
done

# Test 4: Node status
echo -e "\n4. Node Status (Leadership)"
curl -s -X GET "$BASE_URL/status" | jq .

# Test 5: Metrics snapshot
echo -e "\n5. Metrics (JSON parsed)"
curl -s -X GET "$BASE_URL/metrics" | grep chronos_jobs_processed_total | head -1

echo -e "\n=== Tests Complete ==="
```

Run the script:
```bash
chmod +x test-api.sh
./test-api.sh
```

## Load Testing with Apache Bench

```bash
# Submit single job 100 times
ab -n 100 -c 10 -p payload.json -T application/json http://localhost:3000/submit

# Create payload.json:
{
  "type": "test",
  "payload": {
    "message": "load test"
  }
}
```

## Load Testing with k6

Save as `load-test.js`:

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

export let options = {
  stages: [
    { duration: '30s', target: 20 },
    { duration: '1m30s', target: 100 },
    { duration: '30s', target: 0 },
  ],
};

export default function () {
  let res = http.post('http://localhost:3000/submit', JSON.stringify({
    type: 'load-test',
    payload: {
      iteration: __VU,
      timestamp: Date.now(),
    },
  }), {
    headers: { 'Content-Type': 'application/json' },
  });

  check(res, {
    'status is 202': (r) => r.status === 202,
    'has jobId': (r) => r.json('jobId') !== null,
  });

  sleep(1);
}
```

Run load test:
```bash
k6 run load-test.js
```

## Monitoring Queries (Prometheus)

### Job Throughput
```promql
rate(chronos_jobs_submitted_total[5m])
```

### Job Success Rate
```promql
rate(chronos_jobs_processed_total[5m]) / (rate(chronos_jobs_processed_total[5m]) + rate(chronos_jobs_failed_total[5m]))
```

### Job Latency (p95)
```promql
histogram_quantile(0.95, rate(chronos_job_processing_duration_seconds_bucket[5m]))
```

### Queue Backlog
```promql
chronos_queue_depth
```

### Active Workers
```promql
chronos_active_workers
```

### Leader Changes per Hour
```promql
rate(chronos_leader_election_changes_total[1h])
```

# Chronos Deployment Guide

## Local Development Setup

### Prerequisites
- Docker 20.10+
- Docker Compose 2.0+
- Node.js 18+ (for direct TypeScript compilation)
- 4GB RAM minimum

### Quick Start

1. **Clone and setup:**
```bash
git clone <repo-url>
cd chronos-scheduler
npm install
```

2. **Start infrastructure:**
```bash
docker-compose -f deploy/docker-compose.yml up --build
```

This starts:
- 1 Etcd node (leader election)
- 1 Zookeeper node (Kafka coordination)
- 1 Kafka broker with auto-topic creation
- 1 Redis node (caching)
- 2 Scheduler nodes (1 leader, 1 follower)
- 2 Worker nodes (parallel job processing)
- Prometheus (metrics collection)

3. **Verify services are healthy:**
```bash
# Check all containers running
docker-compose -f deploy/docker-compose.yml ps

# Expected output: All containers should be "Up"
CONTAINER ID   IMAGE                          STATUS
abc123         chronos-scheduler:latest        Up (healthy)
def456         chronos-scheduler:latest        Up (healthy)
ghi789         chronos-worker:latest           Up
jkl012         chronos-worker:latest           Up
mno345         confluentinc/cp-kafka:7.5.0     Up (healthy)
...
```

4. **Test the API:**
```bash
curl http://localhost:3000/health
# Should return: {"status":"ok","isLeader":true,...}
```

### Development Workflow

**In one terminal (watching scheduler):**
```bash
npm run dev:scheduler
```

**In another terminal (watching worker):**
```bash
npm run dev:worker
```

**In a third terminal (infrastructure):**
```bash
npm run dev:infra
```

Or run all in parallel:
```bash
npm run dev
```

### Debugging

**View scheduler logs:**
```bash
docker-compose -f deploy/docker-compose.yml logs -f scheduler-1
```

**View worker logs:**
```bash
docker-compose -f deploy/docker-compose.yml logs -f worker-1
```

**Access Prometheus UI:**
```
http://localhost:9090
```

Go to Graph tab and query:
- `chronos_jobs_submitted_total` - total jobs submitted
- `chronos_queue_depth` - pending jobs
- `rate(chronos_jobs_processed_total[1m])` - processing rate

**Access Kafka topics:**
```bash
# List topics
docker-compose -f deploy/docker-compose.yml exec kafka \
  kafka-topics.sh --list --bootstrap-server localhost:9092

# Consume from chronos-jobs topic
docker-compose -f deploy/docker-compose.yml exec kafka \
  kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 \
  --topic chronos-jobs \
  --from-beginning
```

**Check Redis:**
```bash
docker-compose -f deploy/docker-compose.yml exec redis redis-cli
> KEYS job:*
> GET job:550e8400-e29b-41d4-a716-446655440000
```

---

## Production Deployment (Kubernetes)

### Prerequisites
- Kubernetes cluster 1.24+ (EKS, GKE, AKS, or local Minikube)
- kubectl configured
- Docker registry access (ECR, GCR, Docker Hub, etc.)
- 8GB+ cluster resources

### Architecture

```
┌─────────────────────────────────────────┐
│      Kubernetes Cluster (Chronos NS)    │
├─────────────────────────────────────────┤
│                                         │
│  StatefulSet: Etcd (1 pod)             │
│  StatefulSet: Redis (1 pod)            │
│  StatefulSet: Kafka (3 pods)           │
│                                         │
│  Deployment: Scheduler (3 pods)        │
│    - HPA: scales 3-10 based on CPU/mem │
│    - Service: ClusterIP                │
│                                         │
│  Deployment: Worker (5 pods)           │
│    - HPA: scales 5-20 based on CPU/mem │
│                                         │
│  Deployment: Prometheus (1 pod)        │
│  Deployment: ServiceMonitor (optional) │
│                                         │
└─────────────────────────────────────────┘
```

### Step 1: Build and Push Docker Images

```bash
# Tag images with your registry
docker tag chronos-scheduler:latest your-registry/chronos-scheduler:latest
docker tag chronos-worker:latest your-registry/chronos-worker:latest

# Push to registry
docker push your-registry/chronos-scheduler:latest
docker push your-registry/chronos-worker:latest
```

**Using AWS ECR:**
```bash
# Create repository
aws ecr create-repository --repository-name chronos-scheduler
aws ecr create-repository --repository-name chronos-worker

# Get login token
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com

# Build and push
docker build -f deploy/Dockerfile.scheduler -t <ecr-uri>/chronos-scheduler:latest .
docker push <ecr-uri>/chronos-scheduler:latest
```

### Step 2: Deploy Infrastructure

```bash
# Create namespace and deploy Etcd, Kafka, Redis
kubectl apply -f deploy/k8s/infrastructure.yaml

# Wait for StatefulSets to be ready
kubectl wait --for=condition=ready pod -l app=etcd -n chronos --timeout=120s
kubectl wait --for=condition=ready pod -l app=redis -n chronos --timeout=120s
kubectl wait --for=condition=ready pod -l app=kafka -n chronos --timeout=180s

# Verify
kubectl get pods -n chronos
```

### Step 3: Update Image References

Edit `deploy/k8s/scheduler-deployment.yaml` and `deploy/k8s/worker-deployment.yaml`:

Replace:
```yaml
image: chronos-scheduler:latest
imagePullPolicy: Never  # Local image only
```

With:
```yaml
image: your-registry/chronos-scheduler:latest
imagePullPolicy: IfNotPresent
```

### Step 4: Deploy Scheduler Cluster and Workers

```bash
# Deploy schedulers with HPA
kubectl apply -f deploy/k8s/scheduler-deployment.yaml

# Deploy workers with HPA
kubectl apply -f deploy/k8s/worker-deployment.yaml

# Wait for deployments
kubectl wait --for=condition=available --timeout=300s \
  deployment/chronos-scheduler -n chronos
kubectl wait --for=condition=available --timeout=300s \
  deployment/chronos-worker -n chronos

# Verify all pods running
kubectl get pods -n chronos
```

### Step 5: Test the Deployment

**Port forward to test locally:**
```bash
kubectl port-forward -n chronos svc/chronos-scheduler-service 3000:3000 &

# Submit a job
curl -X POST http://localhost:3000/submit \
  -H "Content-Type: application/json" \
  -d '{
    "type": "email",
    "payload": {"to": "test@example.com"}
  }'

# Check metrics
curl http://localhost:3000/metrics | grep chronos_jobs
```

**Scale workers up:**
```bash
kubectl scale deployment chronos-worker -n chronos --replicas=10
```

**Monitor HPA:**
```bash
kubectl get hpa -n chronos
kubectl describe hpa chronos-scheduler-hpa -n chronos
```

### Step 6: Setup Monitoring (Optional but Recommended)

**Access Prometheus:**
```bash
kubectl port-forward -n chronos svc/prometheus-service 9090:9090 &
# Open http://localhost:9090
```

**Install Grafana (optional):**
```bash
helm repo add grafana https://grafana.github.io/helm-charts
helm install grafana grafana/grafana -n chronos \
  --set adminPassword=admin

kubectl port-forward -n chronos svc/grafana 3000:80 &
# Open http://localhost:3000, username: admin, password: admin
```

---

## Scaling Strategies

### Horizontal Scaling

**Increase Worker Count:**
```bash
# Manual scale
kubectl scale deployment chronos-worker -n chronos --replicas=20

# Or update HPA max replicas
kubectl patch hpa chronos-worker-hpa -n chronos \
  --type='json' -p='[{"op": "replace", "path": "/spec/maxReplicas", "value": 30}]'
```

**Monitor scaling:**
```bash
watch kubectl get hpa -n chronos
```

### Vertical Scaling

Edit `deploy/k8s/scheduler-deployment.yaml`:
```yaml
resources:
  requests:
    memory: "512Mi"      # Increase these
    cpu: "500m"
  limits:
    memory: "1Gi"
    cpu: "1000m"
```

Apply changes:
```bash
kubectl apply -f deploy/k8s/scheduler-deployment.yaml
```

### Performance Tuning

**Kafka Partition Count:**
```bash
# Increase partitions for parallel consumption
kubectl exec -n chronos kafka-0 -- \
  kafka-topics.sh \
  --bootstrap-server localhost:9092 \
  --alter \
  --topic chronos-jobs \
  --partitions 6
```

**Redis Memory:**
```bash
# Update Redis StatefulSet
kubectl set env statefulset/redis -n chronos MAXMEMORY=1gb
```

---

## High Availability (HA) Configuration

### Multi-Region Deployment

1. Deploy to multiple K8s clusters in different regions
2. Use Kafka replication across regions
3. Setup cross-cluster Etcd federation

```yaml
# etcd.yaml - Enable clustering
ETCD_INITIAL_CLUSTER_PEERS: "etcd-0=...,etcd-1=...,etcd-2=..."
```

### Database Integration (Optional)

For production, integrate with a database to persist job history:

```typescript
// scheduler/index.ts
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Store job metadata
await pool.query(
  'INSERT INTO jobs (id, type, status, created_at) VALUES ($1, $2, $3, NOW())',
  [jobId, type, 'queued']
);
```

---

## Troubleshooting

### Issue: Scheduler pods stuck in CrashLoopBackOff

**Cause:** Can't connect to Etcd or Kafka

```bash
# Check logs
kubectl logs -n chronos -l app=chronos-scheduler --tail=50

# Verify services are running
kubectl get pods -n chronos | grep -E "etcd|kafka|redis"

# Test connectivity from pod
kubectl exec -n chronos pod/chronos-scheduler-0 -- \
  nslookup etcd-service.chronos.svc.cluster.local
```

### Issue: Queue depth keeps increasing (workers not keeping up)

```bash
# Monitor queue depth
kubectl exec -n chronos scheduler-1 -- curl -s http://localhost:3000/metrics | grep queue_depth

# Scale up workers
kubectl scale deployment chronos-worker -n chronos --replicas=20

# Check worker logs for errors
kubectl logs -n chronos -l app=chronos-worker --tail=100
```

### Issue: Leader election not working

```bash
# Check Etcd status
kubectl exec -n chronos etcd-0 -- etcdctl member list

# Check election key
kubectl exec -n chronos etcd-0 -- etcdctl get /chronos/leader

# Restart election
kubectl restart statefulset/etcd -n chronos
```

### Issue: High memory usage

```bash
# Check memory per pod
kubectl top pods -n chronos

# Identify high-memory pods
kubectl describe pod -n chronos <pod-name>

# Reduce max memory or increase replicas
kubectl scale deployment chronos-worker -n chronos --replicas=30
```

---

## Backup and Recovery

### Backup Etcd Data

```bash
# Take snapshot
kubectl exec -n chronos etcd-0 -- \
  etcdctl snapshot save /tmp/backup.db

# Copy snapshot out
kubectl cp chronos/etcd-0:/tmp/backup.db ./backup.db
```

### Backup Redis Data

```bash
# Redis persists to PVC automatically (--appendonly yes)
# Backup PVC
kubectl get pvc -n chronos
kubectl snapshot create redis-backup -n chronos
```

---

## Cleanup

**Remove local Docker environment:**
```bash
docker-compose -f deploy/docker-compose.yml down -v
```

**Delete Kubernetes deployment:**
```bash
kubectl delete namespace chronos
```

---

## Next Steps

1. Setup GitOps (ArgoCD) for continuous deployment
2. Add Ingress for external access
3. Setup TLS/mTLS for inter-service communication
4. Add network policies for security
5. Setup backup automation
6. Configure alerting rules for critical metrics

# Kubernetes

An agent can report a Kubernetes cluster: its **nodes** and its
**workloads** (Deployments, StatefulSets and DaemonSets), which nodes each
workload runs on, its services and the host names of the Ingresses that
route to it. It reads the API with a service account that can only **get
and list** — never Secrets or ConfigMaps.

What is sent per workload: namespace, name, kind, container images, ready
replicas, the nodes where its pods run, its services (name, type, ports,
load-balancer IPs) and Ingress host names. Labels and selectors are only
used on the agent to join objects; environment variables, arguments,
volumes and annotations are never decoded.

Needs agent **0.6.0** and an InfraMole server **0.13.0** or later.

:::steps

### Create a read-only service account

Apply this in the cluster (`kubectl apply -f inframole-reader.yaml`):

```yaml
apiVersion: v1
kind: ServiceAccount
metadata: { name: inframole, namespace: kube-system }
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata: { name: inframole-reader }
rules:
  - apiGroups: [""]
    resources: [nodes, pods, services]
    verbs: [get, list]
  - apiGroups: [apps]
    resources: [deployments, statefulsets, daemonsets, replicasets]
    verbs: [get, list]
  - apiGroups: [networking.k8s.io]
    resources: [ingresses]
    verbs: [get, list]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata: { name: inframole-reader }
roleRef: { apiGroup: rbac.authorization.k8s.io, kind: ClusterRole, name: inframole-reader }
subjects: [{ kind: ServiceAccount, name: inframole, namespace: kube-system }]
```

### Give the agent a token

On the machine with the agent (any server that can reach the API, often a
node itself):

```sh
kubectl -n kube-system create token inframole --duration 8760h \
  | sudo sh -c 'umask 077; cat > /etc/inframole/k8s.token'
# The cluster CA, to verify the API certificate:
kubectl config view --raw -o jsonpath='{.clusters[0].cluster.certificate-authority-data}' \
  | base64 -d | sudo tee /etc/inframole/k8s-ca.crt > /dev/null
```

Tokens created this way expire: create a new one before the date (or use a
long-lived token Secret if your policy allows it).

### Enable the collector

In the agent's configuration file:

```json
{
  "collectors": {
    "kubernetes": {
      "cluster": "prod",
      "url": "https://k8s-api.corp.local:6443",
      "tokenFile": "/etc/inframole/k8s.token",
      "caFile": "/etc/inframole/k8s-ca.crt"
    }
  }
}
```

- `cluster`: the name shown in InfraMole (tags `k8s:prod`).
- System namespaces (`kube-system`, `kube-public`, `kube-node-lease`) are
  skipped; `"includeSystemNamespaces": true` adds them.
- Running the agent **inside** the cluster: `"inCluster": true` uses the
  pod's mounted service account instead of `url` / `tokenFile` / `caFile`.
- `intervalSec` (optional): default 3600, between 300 and 86400.

### Test, then restart the service

```sh
sudo inframole-agent dry-run --inventory --window 2s
```

The output ends with a `kubernetes` section. If it looks right, restart the
service.

:::

## How it appears

- **Nodes** → servers (tag `kubernetes`). A node that also runs the agent
  is the same server, not a second one.
- **Workloads** → applications named `namespace/name`, or **databases**
  when the image is a database engine (PostgreSQL, MySQL, Redis…), each
  **running on** the nodes of its pods.
- **Ingress host names** → domains that **depend on** the workload.
- **Load-balancer IPs** belong to the workload, so connections to them are
  suggested to it. An IP that is a node's own address (k3s and similar)
  stays with the node.

Everything starts as **Discovered**; a workload or node that disappears
becomes **Stale** after the next collection.

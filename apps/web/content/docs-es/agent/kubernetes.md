# Kubernetes

Un agente puede informar de un clúster de Kubernetes: sus **nodos** y sus
**workloads** (Deployments, StatefulSets y DaemonSets), en qué nodos corre
cada workload, sus servicios y los nombres de host de los Ingress que
enrutan hacia él. Lee la API con una cuenta de servicio que solo puede
**get y list** — nunca Secrets ni ConfigMaps.

Qué se envía de cada workload: namespace, nombre, tipo, imágenes de
contenedor, réplicas listas, los nodos donde corren sus pods, sus servicios
(nombre, tipo, puertos, IP de balanceador) y los nombres de host de los
Ingress. Las etiquetas y selectores solo se usan en el agente para unir
objetos; las variables de entorno, argumentos, volúmenes y anotaciones
nunca se decodifican.

Necesita el agente **0.6.0** y un servidor InfraMole **0.13.0** o posterior.

:::steps

### Crea una cuenta de servicio de solo lectura

Aplica esto en el clúster (`kubectl apply -f inframole-reader.yaml`):

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

### Dale un token al agente

En la máquina con el agente (cualquier servidor que llegue a la API, a
menudo un propio nodo):

```sh
kubectl -n kube-system create token inframole --duration 8760h \
  | sudo sh -c 'umask 077; cat > /etc/inframole/k8s.token'
# La CA del clúster, para verificar el certificado de la API:
kubectl config view --raw -o jsonpath='{.clusters[0].cluster.certificate-authority-data}' \
  | base64 -d | sudo tee /etc/inframole/k8s-ca.crt > /dev/null
```

Los tokens creados así caducan: crea uno nuevo antes de la fecha (o usa un
Secret de token de larga duración si tu política lo permite).

### Activa el colector

En el fichero de configuración del agente:

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

- `cluster`: el nombre que se muestra en InfraMole (etiquetas `k8s:prod`).
- Los namespaces de sistema (`kube-system`, `kube-public`,
  `kube-node-lease`) se omiten; `"includeSystemNamespaces": true` los añade.
- Agente **dentro** del clúster: `"inCluster": true` usa la cuenta de
  servicio montada en el pod en lugar de `url` / `tokenFile` / `caFile`.
- `intervalSec` (opcional): por defecto 3600, entre 300 y 86400.

### Prueba y reinicia el servicio

```sh
sudo inframole-agent dry-run --inventory --window 2s
```

La salida termina con una sección `kubernetes`. Si cuadra, reinicia el
servicio.

:::

## Cómo aparece

- **Nodos** → servidores (etiqueta `kubernetes`). Un nodo que además ejecuta
  el agente es el mismo servidor, no un segundo.
- **Workloads** → aplicaciones llamadas `namespace/nombre`, o **bases de
  datos** cuando la imagen es un motor de base de datos (PostgreSQL, MySQL,
  Redis…), cada una **ejecutándose en** los nodos de sus pods.
- **Nombres de host de Ingress** → dominios que **dependen de** el
  workload.
- **IP de balanceador**: pertenecen al workload, así que las conexiones
  hacia ellas se le sugieren. Una IP que es la propia dirección de un nodo
  (k3s y similares) se queda con el nodo.

Todo empieza como **Discovered**; un workload o nodo que desaparece pasa a
**Stale** tras la siguiente recogida.

# txloom Helm chart

Runs the API, worker and web UI in **one container** (they share run artifacts on `/data`), backed by an external MySQL 8 and Redis.

```sh
helm install txloom oci://ghcr.io/vijayg10/charts/txloom --version 0.1.0 \
  --set mysql.host=<host> --set mysql.password=<pw> \
  --set redis.url=redis://<host>:6379
kubectl port-forward svc/txloom-txloom 3000:3000
```

Use `existingSecret` (keys `mysql-password`, `redis-url`, `instance-key`) instead of plain values in production. Back up `instance-key`: it decrypts saved connection credentials. Always one replica; the data PVC is `ReadWriteOnce` by default and kept on uninstall.

Releasing: bump `version` and `appVersion` in `Chart.yaml`, then push a matching `vX.Y.Z` tag. CI publishes the image and the chart.

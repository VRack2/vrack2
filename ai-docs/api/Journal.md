# vrack2.Journal

Unified platform journal (master level). Events, outgoing port pushes and metrics of every container are stored in ONE vrack2-journal-db store `journals/vrack2`: tables `service_event` / `service_port` / `service_metric` (clustered by `svc, device, ...`; metrics have Graphite-style retention tiers with min/max/sum/count/last/first rollups). The worker forwards its service container's events/ports/metrics and its main container's metrics to the master; the master journals its own container's events and metrics too (channels: `error/notify/alert/terminal/event/terminate`). All commands below are answered by the main process — they work whether or not the service is running.

`svc` namespace (the `service` parameter): `<service-id>` = the service container (events, ports, device metrics), `worker::<service-id>` = the service process (vrack2 `Service` device metrics: `memory.*`, 5s cadence), `vrack2` = the master process (its own device events via `serviceLog`, plus `System` device `memory.*`, `WSProvider` `byte.*`, ... via `serviceDeviceMetric`).

Capture toggles — flat keys in `<id>.meta.json`: `journalEvents` (default on), `journalMetrics` (default on), `journalPorts` (default **off** — opt-in). Journal options: `journalsDir` (`./journals`), `store` (`vrack2`), `eventRetention`/`portRetention` (`1s:30d`), `metricRetention` (`5s:10m, 1m:2h, 15m:1d, 1h:1w, 6h:1mon, 1d:1y`).

## serviceLog
Read a service's journal entries (device events + outgoing port pushes); consecutive identical values are compacted into one record (`t`/`l`/`n`).
- params: `service` (required), `limit` (default 20, max 100000), `device` (filter, empty = all), `type` (filter: `port|notify|alert|event|terminal|error|terminate`, empty = all), `since` / `until` (ms or `now-1h`-like specs)
- returns: `{ entries: [{ t, l, n, type, device, port?, value }], total }`

## serviceLogStats
Per-bucket statistics over a period: who (device) sent what (by type) and how much.
- params: `service` (required), `period` (`"start:end"`, default `now-24h:now`), `interval` (bucket size, default `1h`), `types` / `devices` (filters, empty = all), `maxBuckets` (default 5000)
- returns: `{ start, end, interval, total, buckets: [{ start, end, senders: [{ device, byType }] }] }`

## serviceLogSet
Set per-service capture toggles (persisted in the service meta, applied live on a running service).
- params: `service` (required), `journal` = `{ events, ports, metrics }` booleans or `null` = defaults (events/metrics on, ports off)
- returns: `{ journal }` — effective config

## serviceLogClear
Remove a service's rows from `service_event`/`service_port` (other services untouched; metric tiers are kept).
- params: `service` (required)
- returns: `{ cleared, removedRows }`

## serviceDeviceMetric
The single metrics read API for every container.
- params: `service` (container id: `<service-id>` / `worker::<service-id>` / `vrack2`), `device` (device id), `metric` (metric path), `period` (e.g. `now-1h:now`), `precision` (bucket size: interval string or point count), `func` (default `last`; last|first|min|max|avg|sum)
- returns: `{ relevant, start, end, rows: [{ time, value }] }` (`relevant: false` — no data in the period)
- note: there is no `serviceMetric` / `systemMetric` anymore — the container id in `service` is the namespace

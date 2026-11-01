# vrack2.System

Host/system info, master-process metrics, and persisted container structures (master level).

## systemInfo
- params: none
- returns: `{ os: {platform, type, release, arch}, cpu: {model, cores, speed}, node: {version, v8, openssl, pid, uptime}, user: {hostname, homedir, userInfo}, network }`

## systemMetric
Read a master-process metric (master's own memory: `memory.rss`, `memory.heaptotal`, `memory.heapused`, `memory.external`, `memory.arraybuffers` — written every 5s).
- params: `service` (unused, pass anything), `device` (required), `metric` (required, e.g. `memory.rss`), `period` (required, e.g. `now-1h:now`), `precision` (required, e.g. `30s`), `func` (default `last`; last|first|min|max|avg|sum)
- returns: `{ relevant, start, end, rows: [{ time, value }] }`

## structureGet
- params: `id` string (required) — container id
- returns: persisted container structure (IContainerStructure)

## structureUpdate
- params: `id` (required), `structure` object (required)
- returns: `{}`
- note: level 1 (admin) — overwrites the stored structure

# vrack2.System

Host/system info and persisted container structures (master level). The master's own metrics (`memory.*`, 5s cadence) are journaled by [Journal.md](./Journal.md) — read them with `serviceDeviceMetric { service: 'vrack2', device: 'System', ... }`.

## systemInfo
- params: none
- returns: `{ os: {platform, type, release, arch}, cpu: {model, cores, speed}, node: {version, v8, openssl, pid, uptime}, user: {hostname, homedir, userInfo}, network }`

## structureGet
- params: `id` string (required) — container id
- returns: persisted container structure (IContainerStructure)

## structureUpdate
- params: `id` (required), `structure` object (required)
- returns: `{}`
- note: level 1 (admin) — overwrites the stored structure

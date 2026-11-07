# VRack2 — AGENTS.md

The VRack2 platform device (`devices/vrack2`): the master process that runs and controls other VRack2 services. This file describes platform concepts; device-authoring API lives in `vrack2-core` — do not duplicate it here.

## What VRack2 is

An attempt to systematize automation by drawing boundaries between **sufficiently large units** so the system reads top-down. Not a flow tool: in Node-RED the wires are the program; here the logic lives **inside devices** and the graph is only the map of their connections — so a service diagram is an architecture map, not a spaghetti of small nodes.

- **Device** = a coarse-grained boundary modeled on a real device (ports, state, controls, metrics) — deliberately not a function, not a "node". Splitting logic into tiny reusable pieces is the anti-pattern.
- The model is **microservices inside one service**: isolation (per-vendor dependencies), mobility (devices move between services unchanged), predictability (explicit boundaries, observable state). Running many services is the same principle at the next scale.
- **VRack2 runs on itself**: the master is just another service — the model has no privileged layer, and that is the proof it holds.
- core + runner + platform are one instrument, not three separable products.

## Three layers

1. `vrack2-core` — framework: `Device`, `Port`, `Metric`, `Rule`, `ErrorManager`. Canonical guide: `vrack2-core/AGENTS.md`.
2. `vrack2-service` — the runner: `node ./run/index [graph.json]`.
3. **This platform** — itself a service (master graph `vrack2.json`) that spawns other services in worker threads and exposes their API over WS + MCP.

## Runtime architecture

```
node ./run/index
  └─ MainProcess
       ├─ vrack2.json         ← master's device graph
       ├─ vrack2.conf.json    ← extra devices merged in (Mcp, ServiceManager options)
       │
       ├─ Master              ← command controller: command%d, register%d, submaster(out)
       ├─ ServiceManager      ← service lifecycle → WorkersManager
       ├─ WorkersManager      ← worker_threads pool (one worker per running service)
       ├─ Guard               ← auth + routing: client level vs command level → Master.command
       ├─ WSProvider          ← WS server :4044
       ├─ Broadcaster         ← fan-out journal/events to clients
       ├─ KeyManager          ← API keys (keys.json)
       ├─ System              ← system commands
       ├─ Journal             ← logs/metrics/ports; answers for any service, running or not
       ├─ DeviceInfo          ← transient worker graph for device queries
       ├─ InterService        ← run service commands from inside a service (port command%d)
       │
       └─ Workers (one per running service)
            process.json: Master + WorkerProvider + Service
            Service loads services/<id>.json
```

**Submaster routing**: unknown command → `submaster` → ServiceManager → worker of target service. `service` param in `data` is required.

## Service = two files

- `services/<id>.json` — the device graph (structure): devices, options, connections.
- `services/<id>.meta.json` — `{ name, group, autoStart, autoReload, description }`.

ServiceManager scans `servicesDirs` from `vrack2.conf.json` — services also live inside vendor device dirs (e.g. `./devices/zlab-weather/services`); `generate: true` enables service-file generation there. Editing a service graph of a running service with `autoReload: true` hot-reloads it.

## Platform command surface

Top-Master commands (owner → device):

| Owner | Commands |
|-------|----------|
| ServiceManager | `serviceList`, `serviceUpdateList`, `service`, `serviceMeta`, `serviceStart`, `serviceStop`, `serviceCheck`, `serviceErrors(Clear)` |
| Master | `vendorList`, `vendorDevices`, `vendorDeviceInfo`, `structureGet/Update`, `commandsList` |
| KeyManager | `apiKey`, `apiKeyList`, `apiKeyAdd`, `apiKeyUpdate`, `apiKeyDelete` |
| System | `systemInfo` |
| Journal | `serviceLog`, `serviceLogSet`, `serviceLogStats`, `serviceLogClear`, `serviceDeviceMetric` |

Submaster commands (inside a running service): `serviceCommandsList`, then `serviceStructure`, `serviceDeviceAction`, `serviceDevicePush`, `serviceDeviceShares`, `deviceProcess`, `deviceStop`, `deviceStatus`, …

**Journal caveat**: `serviceLog*` / `serviceDeviceMetric` are master-level Journal commands, not submaster ones — they work for stopped services too. `service="vrack2"` reads the platform's own journal.

## Access model

Every registered command has a `level`; every client connection has a `level` (Guard checks client ≥ command). API keys (`keys.json`, KeyManager) grant a level over WS :4044. Details: `docs/Authentication.md`.

## Inter-service calls

`InterService` device (inside a service) pushes `{ command, data }` to its `command%d` port to execute platform/service commands from another service — cross-service actions and control without going through an external client.

## File layout

```
src/              TypeScript source (edit here)
  interfaces/     platform contracts: IGuardMessage, ICommandRegister, IServiceMeta, IServiceConfig, …
devices/          compiled JS + .d.ts — do NOT edit directly
vrack2.json       master's primary device graph
vrack2.conf.json  extra devices merged into the graph
process.json      container template per service worker
device-info.json  transient worker graph (DeviceInfo)
list.json         device name → class path (registry; add new device classes here)
ai-docs/api/      per-device command/port API cards
```

## Build

```bash
npx tsc -p devices/vrack2/tsconfig.json   # from vrack2-service/ root
```

Restart master after changes (require cache).

## Testing/interaction — MCP tools (the only way to talk to a live platform)

| Tool | Purpose |
|------|---------|
| `commands_list` | full command catalog (platform + `serviceCommandsList`/`serviceCommandInfo`) |
| `command_info {name}` | command card: params, level, return shape |
| `command_execute {name, data}` | run any command; submaster commands auto-route by `service` param |

Discover a running service's own API: `command_execute {name: "serviceCommandsList", data: {service: "<id>"}}`.

## Docs map (link, don't duplicate)

- `../../ai-doc-en/00-ai-start.md` — canonical AI onboarding (mental model, MCP workflows, traps); depth in `01`–`05`.
- `docs/` — user/platform docs (RU): `Service.md`, `ServiceFile.md`, `Devices.md`, `Api.md`, `Authentication.md`, `FirstService.md`.
- `ai-docs/api/` — per-device API cards.
- `vrack2-core/AGENTS.md` — device API contract (Device/Port/Metric/Rule) — the only place for it.

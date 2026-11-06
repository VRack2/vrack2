# VRack2 — AGENTS.md

Platform vendor devices (`devices/vrack2`). The master loads `vrack2.json` as its own graph. Monorepo: `vrack2-service`. Core: `vrack2-core`.

## Runtime architecture

```
node ./run/index
  └─ MainProcess
       ├─ vrack2.json         ← master's device graph
       ├─ vrack2.conf.json    ← extra devices merged in
       │
       ├─ Master              ← command controller: command%d, register%d, submaster(out)
       ├─ ServiceManager      ← service lifecycle → WorkersManager
       ├─ WorkersManager      ← worker_threads pool
       ├─ Guard               ← auth + routing client → Master.command
       ├─ WSProvider          ← WS server :4044
       ├─ Broadcaster         ← fan-out to clients
       ├─ KeyManager          ← API keys
       ├─ System              ← system commands
       ├─ Journal             ← events/metrics/ports (works for stopped services)
       ├─ DeviceInfo          ← transient device queries into running services
       │
       └─ Workers (one per running service)
            process.json: Master + WorkerProvider + Service
            Service loads services/<id>.json
```

**Submaster routing**: unknown command → `submaster` → ServiceManager → worker of target service. Require `service` param in `data`.

## Device contract

```typescript
class MyDevice extends Device {
  description(): string                          // self-doc markdown
  checkOptions(): Record<string, BasicType>      // Rule validation at boot
  inputs(): Record<string, BasicPort>            // Port.standard() | Port.return(); .dynamic(n)
  outputs(): Record<string, BasicPort>           // this.ports.output['name'].push(data)
  actions(): Record<string, ...>                 // request/response handler
  metrics(): Record<string, MetricOne>           // Metric.one() | Metric.group()
  shares: object                                 // mutable state, update via this.render()
  storage: object                                // persists only on this.save()

  onRegister(): void    // before ports wired
  onStart(): void       // sync init
  onStartAsync(): void  // async init, container awaits
}
```

- **Port** = push (no response). **Action** = call + response. **Return port** = push returns Promise.


## File layout

```
src/              TypeScript source (edit here)
  interfaces/     cross-device contracts (IGuardMessage, ICommandRegister, IServiceMeta, …)
devices/          compiled JS + .d.ts — do NOT edit directly
vrack2.json       master's primary device graph
vrack2.conf.json  extra devices merged into the graph
process.json      container template per service worker
device-info.json  transient worker graph (DeviceInfo)
list.json         device name → class path
ai-docs/api/      per-device command/port API cards
```

## Build

```bash
npx tsc -p devices/vrack2/tsconfig.json   # from vrack2-service/ root
```

Restart master after changes (require cache).

## MCP tools (the only way to test/interact with devices)

| Tool | Purpose |
|------|---------|
| `commands_list` | full command catalog |
| `command_info {name}` | params + return shape |
| `command_execute {name, data}` | run command; unknown → submaster auto-routes (pass `service` param) |

Discover service-scoped commands: `command_execute {name: "serviceCommandsList", data: {service: "<id>"}}`

## Key interfaces (src/interfaces/)

| Interface | Fields / purpose |
|-----------|-----------------|
| `IGuardMessage` | level, command, data — Guard → Master envelope |
| `ICommandRegister` | name, level, rules, handler — registered command |
| `IServiceMeta` | autoStart, autoReload, isolated, journalToggles |
| `IDeviceActionRequest` | service, device, action, data |
| `IDevicePushRequest` | service, device, port, data |


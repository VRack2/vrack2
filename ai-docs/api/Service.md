# vrack2.Service

Runs inside each service worker (NOT in the master). These are "submaster" commands: the master routes any command whose `data.service` matches a running service into that worker. Always pass `service` = service id.

## serviceCommandsList
Catalog of all commands registered in this service (full rule cards). Call it first to discover the service's command set.
- params: none
- returns: `{ [commandName]: { command, description, level, rules, owner, short, icon, return } }`

## serviceStructure
- params: `service` (required), `compact` boolean (default true)
- returns: compact — `{ [deviceId]: { type, ports: [{port, direct, description}], outputs: { [port]: [{device, port}] }, inputs: { [port]: [{device, port}] } } }`; `compact: false` — full IContainerStructure

## serviceDeviceAction
Call a device action (request/response, guaranteed answer).
- params: `service`, `device`, `action` (dot-style action name), `data` object (required)
- returns: the action's result
- level 2

## serviceDevicePush
Push data into a device input port (fire-and-forget, no answer from the device).
- params: `service`, `device`, `port` (input port name), `data` any (required)
- errors: CONT_DEVICE_NF, CONT_DEVICE_PORT_NF

## serviceDeviceShares
- params: `service`, `device`
- returns: the device's current `shares` object

## serviceShares
Push current shares of ALL devices to their broadcast channels. No return value.
- params: `service`

## deviceProcess / deviceStop / deviceStatus
Per-device lifecycle inside a running service.
- params: `service`, `device`
- `deviceProcess` — start the device (onStart/onStartAsync), idempotent -> `{ device, started: true }`
- `deviceStop` — stop the device (onStop/onStopAsync), idempotent -> `{ device, started: false }`
- `deviceStatus` — read-only -> `{ device, started, status: { id, type, state: registered|started|stopped, since, lastAlert, lastError, alertCount, errorCount } }`
- errors: CONT_DEVICE_NF

## serviceDeviceOutputListen
One-shot capture of the next data emitted on a device output port.
- params: `service`, `device`, `port` (output port name), `timeout` ms (default 5000, max 20000)
- returns: the captured data
- errors: SERVICE_CAPTURE_PORT_TIMEOUT, CONT_DEVICE_NF, CONT_DEVICE_PORT_NF

## serviceDeviceMetric
Read a device metric from the service journal-db.
- params: `service`, `device`, `metric` (e.g. `temperature`), `period` (e.g. `now-1h:now`), `precision` (e.g. `30s`), `func` (default `last`; last|first|min|max|avg|sum)
- returns: `{ relevant, start, end, rows: [{ time, value }] }`

## serviceMetric
Read a metric of the worker container itself (e.g. `memory.rss` of the Service device, 5s cadence). Same params/returns as serviceDeviceMetric.

## internal (level 0, hidden from catalogs)
`serviceStart`, `serviceCheck`, `serviceStop`, `serviceParentEvent` — invoked by ServiceManager, not by clients.

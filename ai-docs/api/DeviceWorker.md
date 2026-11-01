# vrack2.DeviceWorker

Worker-side implementation of the vendor/device info commands — the same three as DeviceInfo. It runs inside an isolated worker process (service `device-info.json`), which DeviceInfo spawns per query and stops afterwards. Clients normally call DeviceInfo's commands at the master; this device matters only when reading the worker's own command catalog.

## vendorList / vendorDevices / vendorDeviceInfo
Identical signatures and returns as in DeviceInfo.md:
- `vendorList` — no params -> `[vendorName, ...]`
- `vendorDevices` — `vendor` (required) -> `[deviceName, ...]`
- `vendorDeviceInfo` — `vendor`, `device` (required) -> `{ actions, metrics, inputs, outputs, checkOptions, description }`

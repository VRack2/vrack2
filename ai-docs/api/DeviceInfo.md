# vrack2.DeviceInfo

Fresh device metadata: vendor list, device list per vendor, full device contract. Each query runs in a throwaway isolated worker (DeviceWorker) so class require-caching can never return stale ports/actions/options.

## vendorList
- params: none
- returns: `[vendorName, ...]`

## vendorDevices
- params: `vendor` string (required)
- returns: `[deviceName, ...]`

## vendorDeviceInfo
- params: `vendor` string (required), `device` string (required)
- returns: `{ actions, metrics, inputs, outputs, checkOptions, description }` — the device contract: action names with rules, metric ids, input/output ports, option validation rules, description

# vrack2.ServiceManager

Service lifecycle: discovery in `servicesDirs`, start/stop/check, errors, meta. Each service runs in a separate worker thread (`UniversalWorker`; a separate process when the service meta sets `isolated: true`); this device manages those workers.

Service object: `{ id, errors, filePath, metaPath, configPath, processPath, startedAt?, run, autoReload, deleted }`.

## serviceList
- params: none
- returns: `{ [serviceId]: { ...service, ...meta } }`

## serviceUpdateList
Rescan the services dirs (pick up added/removed files) and return the same shape as serviceList.
- params: none

## service
- params: `service` string (required) — service id
- returns: service object
- errors: SM_SERVICE_NOT_FOUND

## serviceMeta
- params: `service` (required)
- returns: `{ name, group, description, system, autoStart, autoReload, isolated, parentChannels }`

## serviceStart
- params: `service` (required)
- returns: service object (`run: true`)
- errors: SM_SERVICE_NOT_FOUND, SM_SERVICE_RUNNING
- note: a manual start disables autoReload for that run; worker errors accumulate in serviceErrors

## serviceStop
- params: `service` (required)
- returns: service object (`run: false`)
- errors: SM_SERVICE_NOT_RUN. Graceful stop waits `stopTimeout` (default 5000 ms) for the worker to self-exit, then force-kills it (SM_SERVICE_STOP_TIMEOUT is recorded in the error list).

## serviceCheck
Validate the service config in a throwaway worker without starting it. Errors are added to the service error list.
- params: `service` (required)
- returns: `{}`

## serviceErrors
- params: `service` (required)
- returns: `[CoreError, ...]` — newest first, nested vAddErrors expanded to top level

## serviceErrorsClear
- params: `service` (required)
- returns: `{}`

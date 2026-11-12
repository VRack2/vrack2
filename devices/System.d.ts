import { BasicType, Device, MetricOne } from "vrack2-core";
import { IContainerStructure } from "vrack2-core/lib/Container";
import BasicPort from "vrack2-core/lib/ports/BasicPort";
export default class System extends Device {
    description(): string;
    outputs(): {
        [key: string]: BasicPort;
    };
    checkOptions(): {
        [key: string]: BasicType;
    };
    metrics(): {
        [key: string]: MetricOne;
    };
    /** Memory-metrics interval handle (cleared on onStop) */
    protected memTimer?: NodeJS.Timeout;
    onStart(): void;
    /**
     * Release the memory-metrics interval owned by this device. Without this the
     * interval keeps the event loop alive after Container.stopAll(), so the
     * process only exits because the shutdown chain calls process.exit()
     * explicitly, and restarting the device stacks a second interval.
     */
    onStop(): void;
    /**
     * Graceful shutdown of the master container on SIGINT/SIGTERM.
     *
     * The framework does not manage the host process lifecycle, so this device
     * (the platform's own System device) owns it: on a termination signal it
     * runs the canonical teardown — `Container.stopAll()` (devices stopped in
     * reverse start order: ServiceManager.onStopAsync stops every service, so
     * their final journal batches reach the still-open Journal tables; Journal
     * is started first and therefore stopped last, flushing its segments) then
     * `Bootstrap.destroyAll()` (boot-class stores closed) — and only then exits
     * the process.
     *
     * Idempotent latch: the journal-db Shutdown hook re-raises the same signal
     * synchronously after draining the WAL; that re-entrant call is ignored. A
     * genuine second signal (a real second Ctrl+C, > 1s later) force-exits.
     */
    protected bindShutdown(): void;
    /**
     * Getting the service structure
     * Allows you to retrieve the structure of any service by container ID
    */
    apiStructureGet(data: {
        id: string;
    }): Promise<IContainerStructure>;
    /**
     * Update the service structure
     * Allows you to update the structure of any service by container ID
    */
    apiStructureUpdate(data: {
        id: string;
        structure: IContainerStructure;
    }): Promise<{}>;
    /**
     * Returns a list of device vendors
     */
    apiVendorList(): Promise<Array<string>>;
    /**
     * Getting the list of devices by its vendor
    */
    apiVendorDevices(data: {
        vendor: string;
    }): Promise<Array<string>>;
    /**
     * Getting information about the device
    */
    apiVendorDeviceInfo(data: {
        vendor: string;
        device: string;
    }): Promise<any>;
    /**
     * Getting system infomation
     *
    */
    apiGetSystemInfo(): Promise<any>;
}

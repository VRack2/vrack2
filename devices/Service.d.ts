import { Container, Device, MainProcess, BasicMetric } from "vrack2-core";
import BasicPort from "vrack2-core/lib/ports/BasicPort";
import BasicType from "vrack2-core/lib/validator/types/BasicType";
import IGuardMessage from "./interfaces/IGuardMessage";
import IServiceConfig from './interfaces/IServiceConfig';
import IServiceMeta from "./interfaces/IServiceMeta";
import IDeviceActionRequest from "./interfaces/IDeviceActionRequest";
import IDeviceMetricRequest from "./interfaces/IDeviceMetricRequest";
import IDevicePushRequest from "./interfaces/IDevicePushRequest";
export default class Serivce extends Device {
    description(): string;
    outputs(): {
        [key: string]: BasicPort;
    };
    inputs(): {
        [key: string]: BasicPort;
    };
    checkOptions(): {
        [key: string]: BasicType;
    };
    metrics(): {
        [key: string]: BasicMetric;
    };
    /**
     * Devices events list
    */
    eventsChannels: {
        [key: string]: string;
    };
    MainProcess?: MainProcess;
    /**
     * Service container
    */
    ServiceContainer: Container;
    /**
     * Service info (getting from service manager)
    */
    Serviceinfo: IServiceConfig;
    /**
     * Service meta (getting from service manager)
    */
    ServiceMeta: IServiceMeta;
    /**
     * Индекс для захвата порта устройства
     */
    captureIndex: number;
    /**
     * Пулл для хранения таймаутов захвата порта устройства
    */
    capturePull: Map<any, any>;
    onStart(): void;
    /**                 API SERVICE METHODS                 **/
    /**
     * Internal method for starting service
     *
     * @param {Object} data  action data
     * @param {IServiceConfig} data.info ServiceManager internal service info
     * @param {IServiceMeta} data.meta ServiceManager internal serivce meta
    */
    apiServiceStart(data: {
        info: IServiceConfig;
        meta: IServiceMeta;
    }, gData: IGuardMessage): Promise<{}>;
    /**
     * Internal method for starting service
     *
     * @param {Object} data  action data
     * @param {IServiceConfig} data.info ServiceManager internal service info
     * @param {IServiceMeta} data.meta ServiceManager internal serivce meta
    */
    apiServiceCheck(data: {
        info: IServiceConfig;
        meta: IServiceMeta;
    }, gData: IGuardMessage): Promise<void>;
    /**
     * Real service start method
     *
     * @param {Object} data  action data
     * @param {IServiceConfig} data.info ServiceManager internal service info
     * @param {IServiceMeta} data.meta ServiceManager internal serivce meta
    */
    apiServiceStartSafe(data: {
        info: IServiceConfig;
        meta: IServiceMeta;
    }, gData: IGuardMessage): Promise<void>;
    /**
     * Sends the current shares of all service devices to subscribers
      *
     * @param {Object} data - not used receive params
     */
    apiServiceShares(data: {
        service: string;
    }, gData: IGuardMessage): Promise<void>;
    /**
     * Calling a device action
    */
    apiServiceDeviceAction(data: IDeviceActionRequest, gData: IGuardMessage): Promise<any>;
    /**
     * Calling a device port push
    */
    apiServiceDevicePush(data: IDevicePushRequest, gData: IGuardMessage): Promise<any>;
    /**
     * Get current shares data of a device
    */
    apiServiceDeviceShares(data: {
        service: string;
        device: string;
    }, gData: IGuardMessage): Promise<Record<string, any>>;
    /**
     * Stop a running device in the service container
     *
     * Delegates to `Container.stopDevice()`: calls device `onStop()`, then
     * `await onStopAsync()`, then marks it stopped. Reversible (can be started
     * again via `deviceProcess`) and idempotent - a device that is not running
     * is a no-op. Throws CONT_DEVICE_NF if the device id is unknown.
     */
    apiDeviceStop(data: {
        service: string;
        device: string;
    }, gData: IGuardMessage): Promise<{
        device: string;
        started: boolean;
    }>;
    /**
     * Start (process) a device in the service container
     *
     * Delegates to `Container.startDevice()`: calls device `onStart()`, then
     * `await onStartAsync()`, then marks it started. Idempotent - an already
     * started device is a no-op. Throws CONT_DEVICE_NF if the device id is unknown.
     */
    apiDeviceProcess(data: {
        service: string;
        device: string;
    }, gData: IGuardMessage): Promise<{
        device: string;
        started: boolean;
    }>;
    /**
     * Read the lifecycle status of a device in the service container
     *
     * Delegates to `Container.getDeviceStatus()`: the container-maintained
     * record (state registered/started/stopped, since, last alert/error,
     * counters). Read-only - no mutations. Throws CONT_DEVICE_NF if the
     * device id is unknown.
     */
    apiDeviceStatus(data: {
        service: string;
        device: string;
    }, gData: IGuardMessage): Promise<{
        device: string;
        started: boolean;
        status: import("vrack2-core").IDeviceStatus;
    }>;
    /**
     * Захват выхода устройства
    */
    apiServiceDeviceOutputListen(data: {
        service: string;
        device: string;
        port: string;
        timeout: number;
    }): Promise<unknown>;
    /**
     * Get service commands list
     *
    */
    apiCommandList(): Promise<any>;
    /**
     * Getting device metric
    */
    apiServiceDeviceMetric(data: IDeviceMetricRequest, gData: IGuardMessage): Promise<any>;
    /**
     * Getting device metric
     * Obtaining system metrics. Those that were initialized at the VRack2 level
     */
    apiServiceMetric(data: IDeviceMetricRequest, gData: IGuardMessage): Promise<any>;
    /**
     * Выполняет внутреннюю передачу события из основного родительского контейнера
     *
    */
    apiServiceParentEvent(data: {
        channel: string;
        data: any;
    }): Promise<void>;
    /**
     * Bind container device terminate event
    */
    protected bindTerminate(): Promise<void>;
    /**
     * Bind container devices events
     *
     * Listens to device events and sends specialized broadcasts to the service manager
     *
     * @see eventsChannels device events list
    */
    protected bindContainerDeviceEvents(): Promise<void>;
    /**
     * Bind render device event
      *
     * Broadcast the device render payload directly to subscribers
     */
    protected bindRenderEvent(): Promise<void>;
    /**
     * Convert object to string using util.inspect
    */
    protected makeBroadcastTrace(trace: any): any;
    /**
     * Make broadcast channel name
     *
     * @param device DeviceID
     * @param target Specific channel of device
    */
    protected makeBroadcastChannel(device: string, target: string): string;
    /**
     * Send broadcast data to ServiceManager
    */
    protected broadcast(channel: string, data: any): void;
    /**
     * Graceful stop of the running service container and worker self-exit.
     *
     * 1) `Container.stopAll()` — graceful shutdown of user devices (their `onStop()` / `await onStopAsync()` hooks).
     * 2) Our own container `stopAll()` — ServiceLogger's `onStopAsync()` flushes the journal to disk;
     *    Container.stopDevice awaits each device's onStopAsync(), so the write completes before exit.
     * 3) The worker exits on its own: this thread was spawned for the service, and nobody else will terminate it.
     *    On the main side the pending request is rejected with WM_WORKER_EXIT by the exit handler — a normal outcome.
     */
    apiServiceStop(data: {
        service: string;
    }, gData: IGuardMessage): Promise<void>;
    /**
     * Send termiate errro and terminate service process
     */
    protected serviceTerminate(error: Error): void;
    protected exit(): Promise<void>;
    protected getNextCaptureIndex(): number;
}

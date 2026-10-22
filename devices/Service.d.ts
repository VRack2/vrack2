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
    /**
     * Main process instance of the started service (kept for graceful stop:
     * MainProcess.stop() stops the container and destroys boot classes,
     * which flushes the journal stores to disk)
     */
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
    /***
     * Render pull for service shares data
     */
    renderPull: Set<string>;
    /**
     * Render timer
     */
    renderTimer: boolean | NodeJS.Timeout;
    /**
     * Memory metrics timer (setInterval from onStart)
     */
    memTimer: NodeJS.Timeout | null;
    /**
     * Индекс для захвата порта устройства
     */
    captureIndex: number;
    /**
     * Пулл для хранения таймаутов захвата порта устройства
    */
    capturePull: Map<any, any>;
    onStart(): void;
    onStop(): void;
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
     * Get the structure schema of the running service container
     *
     * Takes the live Container structure (the same data StructureStorage
     * persists to disk). By default (compact:true) it is trimmed to devices +
     * ports + connections only: no metrics, no actions, no display settings.
     * compact:false returns the full container structure.
     */
    apiServiceStructure(data: {
        service: string;
        compact?: boolean;
    }, gData: IGuardMessage): Promise<{
        [key: string]: {
            type: string;
            ports: Array<{
                port: string;
                direct: string;
                description?: string;
            }>;
            outputs: {
                [key: string]: Array<{
                    device: string;
                    port: string;
                }>;
            };
            inputs: {
                [key: string]: Array<{
                    device: string;
                    port: string;
                }>;
            };
        };
    }>;
    /**
     * Read device metric from a container
     */
    protected readDeviceMetric(container: Container, data: IDeviceMetricRequest): {
        relevant: boolean;
        start: number;
        end: number;
        rows: {
            time: number;
            value: number | null;
        }[];
    };
    /**
     * Getting device metric
     */
    apiServiceDeviceMetric(data: IDeviceMetricRequest, gData: IGuardMessage): Promise<any>;
    /**
     * Getting service metric (worker container, VRack2 level)
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
     * Create the service MainProcess and attach it to the worker
     * (parent container, MainProcess/ServiceContainer/Serviceinfo/ServiceMeta fields).
     * @param start true — full start (confFile + container.meta), false — check only
     */
    protected createMainProcess(info: IServiceConfig, meta: IServiceMeta, start: boolean): Promise<MainProcess>;
    /**
     * Bind container device terminate event
     */
    protected bindTerminate(): void;
    /**
     * Bind container devices events
     *
     * Listens to device events and sends specialized broadcasts to the service manager
     *
     * @see eventsChannels device events list
    */
    protected bindContainerDeviceEvents(): void;
    /**
     * Bind render device event
     *
     * Update render pull
     *
     * @see renderPull
     */
    protected bindRenderEvent(): void;
    /**
     * Send broadcast for device render event
     *
     * @see bindRenderEvent
     */
    protected serviceRender(): void;
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
     * Все завершающие процедуры — в единственной точке shutdown() (см. там).
     * Main сбросил conf.autoReload перед командой, поэтому exit не вызовет автоперезапуск.
     */
    apiServiceStop(data: {
        service: string;
    }, gData: IGuardMessage): Promise<void>;
    /**
     * Завершение воркера сервиса: уведомить main об ошибке (если есть),
     * остановить сервис (MainProcess.stop() — устройства + boot-классы),
     * остановить воркер-контейнер, process.exit(0).
     * Сюда сходятся все пути: команда stop, device.terminate,
     * uncaughtException, ошибки start/check.
     */
    protected shutdown(error?: Error): Promise<void>;
    protected notifyMainError(error: Error): void;
    /**
     * Терминальная ошибка сервиса: уведомление + завершение через единственную точку shutdown()
     */
    protected serviceTerminate(error: Error): Promise<void>;
    protected getNextCaptureIndex(): number;
    /**
     * Normalize a service's `bootstrap` entries.
     *
     * `mergeBootList` (vrack2-core) requires every boot entry to carry an
     * `options` object, so a bare `{ "path": "..." }` — the natural way for a
     * service to override our default `DeviceMetrics` — would throw
     * BTSP_BAD_BOOTLIST. Fill `options: {}` where it is missing.
     */
    protected normalizeServiceBootstrap(service: any): any;
}

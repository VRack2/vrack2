/// <reference types="node" />
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
    /***
     * Render pull for service shares data
    */
    renderPull: Set<string>;
    /**
     * Render data for send to service manager
    */
    renderData: Map<string, any>;
    /**
     * Render timer
    */
    renderTimer: boolean | NodeJS.Timeout;
    /**
     * Индекс для захвата порта устройства
    */
    captureIndex: number;
    /**
     * Пулл для хранения таймаутов захвата порта устройства
    */
    capturePull: Map<any, any>;
    process(): void;
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
     * Queues all shares data to be sent
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
     * Update render pull & render data
     *
     * @see renderPull
     * @see renderData
    */
    protected bindRenderEvent(): Promise<void>;
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
     * Send termiate errro and terminate service process
    */
    protected serviceTerminate(error: Error): void;
    protected exit(): Promise<void>;
    protected getNextCaptureIndex(): number;
}

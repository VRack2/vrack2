import { BasicMetric, Device } from "vrack2-core";
import { IContainerStructure } from "vrack2-core/lib/Container";
import BasicPort from "vrack2-core/lib/ports/BasicPort";
import IGuardMessage from "./interfaces/IGuardMessage";
import IDeviceMetricRequest from "./interfaces/IDeviceMetricRequest";
export default class System extends Device {
    outputs(): {
        [key: string]: BasicPort;
    };
    metrics(): {
        [key: string]: BasicMetric;
    };
    process(): void;
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
     * Getting device metric
     * Obtaining system metrics. Those that were initialized at the VRack2 level
    */
    apiSystemMetric(data: IDeviceMetricRequest, gData: IGuardMessage): Promise<any>;
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

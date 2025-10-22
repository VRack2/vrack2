import { Device, BasicPort } from "vrack2-core";
export default class DeviceWorker extends Device {
    outputs(): {
        [key: string]: BasicPort;
    };
    process(): void;
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
}

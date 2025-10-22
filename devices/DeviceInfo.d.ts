import { Device, BasicPort } from "vrack2-core";
export default class DeviceInfo extends Device {
    outputs(): {
        [key: string]: BasicPort;
    };
    process(): void;
    /**
     * Returns a list of device vendors
    */
    apiVendorList(data: {
        vendor: string;
    }): Promise<any>;
    /**
     * Getting the list of devices by its vendor
    */
    apiVendorDevices(data: {
        vendor: string;
    }): Promise<any>;
    /**
     * Getting information about the device
    */
    apiVendorDeviceInfo(data: {
        vendor: string;
        device: string;
    }): Promise<any>;
    /**
     * Поскольку у нас при импорте устройств происходит кеширование класса по пути
     * нам необходимо каждый раз, при запросе информации об устройсвах возвращать не кешированный результат
     * Что бы гарантировать это - будем использовать создание воркера и выполнение команды внутри него
    */
    workerCommand(command: string, data: any): Promise<any>;
}

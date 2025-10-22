import { Device, BasicPort, BasicType } from "vrack2-core";
/**
 * A device that can execute commands outside its service (the service of VRack2 itself).
 * This allows executing actions or accessing ports of another service.
 * As well as control other VRack2 services
*/
export default class InterService extends Device {
    inputs(): {
        [key: string]: BasicPort;
    };
    checkOptions(): {
        [key: string]: BasicType;
    };
    preProcess(): void;
    process(): void;
    /**
     * Run internal command WorkerProvider.
     * The method is transparent. Error handling takes place at the command call level of this device,
     * i.e. in the area of responsibility of the device higher up
     *
     * @see WorkerProvider
    */
    inputCommand(data: {
        command: string;
        data: any;
    }): Promise<unknown>;
}

import { Device } from "vrack2-core";
import BasicPort from "vrack2-core/lib/ports/BasicPort";
import BasicType from "vrack2-core/lib/validator/types/BasicType";
import IGuardMessage from "./interfaces/IGuardMessage";
interface IInternalMessage extends IGuardMessage {
    internal?: boolean;
    iIndex?: number;
    result: string;
    resultData: any;
}
export default class WorkerProvider extends Device {
    outputs(): {
        [key: string]: BasicPort;
    };
    inputs(): {
        [key: string]: BasicPort;
    };
    checkOptions(): {
        [key: string]: BasicType;
    };
    protected queue: Map<number, {
        resolve: (ret: any) => void;
        reject: (ret: any) => void;
    }>;
    protected qIndex: number;
    process(): void;
    /**
     * Receiving and processing a command from the main VRack2 service
     *
     * @see WorkerProvider.process()
    */
    inputCommand(command: IInternalMessage): Promise<void>;
    /**
     * Sends the brodcast to the main VRack2 service
    */
    inputBroadcast(data: {
        channel: string;
        data: any;
    }): void;
    /**
     * Sends the command that VRack2 should execute through Master for execution
    */
    inputInternal(data: {
        command: string;
        data: any;
    }): Promise<unknown>;
    /**
     * Sending raw data to VRack2
    */
    inputSend(data: any): void;
    /**
     * Send data to ServiceManager after service loaded
    */
    protected loaded(): void;
    /**
     * Processes the response of an internal command that was sent from the same
     * service to the main service
     *
     *
    */
    protected internalResponse(command: IInternalMessage): void;
    /**
     * Return next queue index
    */
    protected queueIndex(): number;
    /**
     * Send raw data to parentPort
    */
    protected postMessage(data: any): void;
}
export {};

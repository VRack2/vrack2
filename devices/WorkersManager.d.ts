import { Device } from "vrack2-core";
import BasicPort from "vrack2-core/lib/ports/BasicPort";
import BasicType from "vrack2-core/lib/validator/types/BasicType";
import IBroadcast from "./interfaces/IBroadcast";
/**
 * Message that a service receives from a child service
*/
interface IWorkerMessage extends IBroadcast {
    /** Whether the message is an internal command  */
    internal?: boolean;
    /** Hidden message index */
    __index: number;
    /** Command name */
    command: string;
    /** An error message may be returned */
    error?: Error;
    /** success/error message */
    result: string;
    /** Result data  */
    resultData: any;
}
export default class WorkersManager extends Device {
    inputs(): {
        [key: string]: BasicPort;
    };
    outputs(): {
        [key: string]: BasicPort;
    };
    checkOptions(): {
        [key: string]: BasicType;
    };
    /**
     * Message index
    */
    private mIndex;
    /**
     * Worker index
    */
    private wIndex;
    /**
     * Message Queue. When a message is sent inside the service, `resolve` `reject` is rolled into this queue
    */
    private Queue;
    /**
     * List of workers
    */
    private workers;
    /**
     * Contains a list of messages that are queued for a particular worker
    */
    private workersQueue;
    preProcess(): void;
    /**
     * Creating a Worker - VRack2 service.
     *
     * Сreates a vorker and passes to it the data required for operation.
     * After creation it handles such events as message, exit, error.
     *
     * @param {Object} data
     * @param data.data Data for send to worker
     * @param data.onError onError Callback call that will be after an error worker
     * @param data.onExit onExit Callback call that will be after an exit worker
    */
    inputWorkerAdd(data: {
        isolated: boolean;
        data: any;
        onError: (error: any) => void;
        onExit: () => void;
    }): Promise<unknown>;
    /**
     * Stop worker by id
     * After stopping, the event exit will be triggered
    */
    inputWorkerStop(data: {
        id: number;
    }): Promise<void>;
    /**
     * Всегда возвращает ошибку при закрытии воркера.
     * В штатном режиме возрващает WM_WORKER_EXIT
     *
     * @param {Object} data
     * @param {number} data.id Идентификатор воркера
    */
    workerStopPromise(data: {
        id: number;
    }): Promise<unknown>;
    /**
     * Sending a message to a Worker
     *
     * @param {Object} data
     * @param data.id Worker ID
     * @param data.data Data for send to worker
    */
    inputWorkerRequest(data: {
        id: number;
        data: any;
    }): Promise<unknown>;
    /**
     * Called when there is a message index in the response from the Worker.
     * And there is a message with this index in the queue
    */
    protected queueMaintenance(id: number, mData: IWorkerMessage): {} | undefined;
    /**
     * Internal Message Processing.
     * Executes the Master command and returns the result back to the Worker
     *
     * @param id Worker ID
     * @param data Data from Worker service
    */
    protected internal(id: number, data: any): Promise<void>;
    /**
     * Adding a new job to the Worker queue
     *
     * @param id Worker id
     * @param resolve Resolve callback
     * @param reject Reject callback
    */
    private addWorkerQueue;
    /**
     * Return next message index
    */
    protected messageIndex(): number;
    /**
     * Return next worker index
    */
    protected workerIndex(): number;
}
export {};

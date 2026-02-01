import { CoreError, Device, ErrorManager, Port, Rule, UniversalWorker } from "vrack2-core";
import BasicPort from "vrack2-core/lib/ports/BasicPort";
import BasicType from "vrack2-core/lib/validator/types/BasicType";
import IGuardMessage from "./interfaces/IGuardMessage";
// import { workerData, threadId } from "worker_threads"

interface IInternalMessage extends IGuardMessage {
    internal?: boolean;
    iIndex?: number;
    result: string;
    resultData: any;
}

ErrorManager.register('WorkerProvider', 'O0LWU331YS7J', 'WP_INTERNAL_COMMAND_ERROR',
    'An error occurred while executing an internal command that the service sent to VRACK.')

export default class WorkerProvider extends Device {

    outputs(): { [key: string]: BasicPort; } {
        return {
            command: Port.return().description('Port for client command request'),
        }
    }

    inputs(): { [key: string]: BasicPort; } {
        return {
            send: Port.standart().description('Send data to parent process'),
            broadcast: Port.standart().description('Send broadcast to client'),
            internal: Port.return().description('Request internal command'),
        }
    }

    checkOptions(): { [key: string]: BasicType; } {
        return {}
    }

    protected queue = new Map<number, { resolve: (ret: any) => void, reject: (ret: any) => void }>()
    protected qIndex = 1
    process(): void {
        // Bind loaded method for send signal to service manager
        this.Container.on('loaded', this.loaded.bind(this))
        UniversalWorker.onMessage(this.inputCommand.bind(this))
        // parentPort?.on('message', this.inputCommand.bind(this))
    }

    /**
     * Receiving and processing a command from the main VRack2 service  
     * 
     * @see WorkerProvider.process()
    */
    async inputCommand(command: IInternalMessage) {
        /**
         * internal command processing (if flag internal is true)
        */
        if (command.internal && command.iIndex) {
            if (this.queue.has(command.iIndex)) {
                const promise = this.queue.get(command.iIndex)
                if (!promise) return
                this.queue.delete(command.iIndex)
                if (command.result === 'success') {
                    promise.resolve(command.resultData)
                } else if (command.result === 'error') {
                    promise.reject((ErrorManager.make('WP_INTERNAL_COMMAND_ERROR')).import(command.resultData))
                }
            }
            return
        }
        try {
            const result = await this.ports.output['command'].push(command)
            command.result = 'success'
            command.resultData = result
            this.postMessage(command)
        } catch (err) {
            command.result = 'error'
            command.resultData = CoreError.objectify(err)
            this.postMessage(command)
        }
    }

    /**
     * Sends the brodcast to the main VRack2 service
    */
    inputBroadcast(data: {channel: string, data: any} ) {
        this.postMessage({
            command: 'broadcast',
            channel: data.channel,
            data: data.data
        })
    }

    /**
     * Sends the command that VRack2 should execute through Master for execution
    */
    inputInternal(data: { command: string, data: any }) {
        return new Promise((resolve, reject) => {
            const index = this.queueIndex()
            this.queue.set(index, { resolve, reject })
            this.postMessage({
                command: data.command,
                data: data.data,
                iIndex: index,
                internal: true
            })
        })
    }

    /**
     * Sending raw data to VRack2
    */
    inputSend(data: any){
        this.postMessage(data)
    }

    /**
     * Send data to ServiceManager after service loaded
    */
    protected loaded() {
        const workerData = UniversalWorker.getWorkerData()
        this.inputSend({
            __index: workerData.__index,
            __id: workerData.__id,
            resultData: workerData.__id
        })
    }

    /**
     * Processes the response of an internal command that was sent from the same 
     * service to the main service
     * 
     * 
    */
    protected internalResponse(command: IInternalMessage){
        if (!command.internal || !command.iIndex) return 
        if (!this.queue.has(command.iIndex)) return
        const promise = this.queue.get(command.iIndex)
        if (!promise) return
        this.queue.delete(command.iIndex)
        if (command.result === 'success') promise.resolve(command.resultData)
        else if (command.result === 'error') promise.reject((ErrorManager.make('WP_INTERNAL_COMMAND_ERROR')).import(command.resultData))
        return
    }

    /**
     * Return next queue index
    */
    protected queueIndex() { return this.qIndex++ }

    /**
     * Send raw data to parentPort
    */
    protected postMessage(data: any) {
        UniversalWorker.sendMessage(data)
        // parentPort?.postMessage(data)
    }
}
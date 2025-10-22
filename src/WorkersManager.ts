import { join } from "path";
import { CoreError, Device, ErrorManager, Port, Rule } from "vrack2-core";
import BasicPort from "vrack2-core/lib/ports/BasicPort";
import BasicType from "vrack2-core/lib/validator/types/BasicType";
import { Worker } from "worker_threads";
import IGuardMessage from "./interfaces/IGuardMessage";
import IBroadcast from "./interfaces/IBroadcast";

ErrorManager.register('WorkersManager','ASF6TC4U7J6P', 'WM_INTERNAL_ERROR', 'An error occurred within the service being used, causing it to terminate.')
ErrorManager.register('WorkersManager','U4HUK15C0UVO', 'WM_WORKER_EXIT', 'The workers job was terminated, all tasks were deleted.')


/**
 * Message that a service receives from a child service
*/
interface IWorkerMessage extends IBroadcast{
    /** Whether the message is an internal command  */
    internal?: boolean,
    /** Hidden message index */
    __index: number,
    /** Command name */
    command: string,
    /** An error message may be returned */
    error?: Error,
    /** success/error message */
    result: string,
    /** Result data  */
    resultData: any
}

export default class WorkersManager extends Device {
    
    inputs(): { [key: string]: BasicPort; } {
        return {
            'worker%d.add': Port.return().requirement(
                Rule.object().require().fields({
                    data: Rule.object().description('Data for sending to worker at start'),
                    onError: Rule.function().description('On error callback'),
                    onExit: Rule.function().description('On onExit callback')
                })
            )
            .dynamic(this.options.workerInputs)
            .description('Add new worker'),

            'worker%d.stop': Port.return().requirement(
                Rule.object().require().fields({
                    id: Rule.object().description('Worker ID'),
                }))
            .dynamic(this.options.workerInputs)
            .description('Stop worker port'),

            'worker%d.request': Port.return().requirement(Rule.object().require().fields({
                id: Rule.object().description('Worker ID'),
            }))
            .dynamic(this.options.workerInputs)
            .description('Send request to worker')
        }
    }

    outputs(): { [key: string]: BasicPort; } {
        return {
            'master.command': Port.return(),
            'broadcast': Port.standart()
        }
    }

    checkOptions(): { [key: string]: BasicType; } {
        return {
            workerInputs: Rule.number().default(3).description('Number of workers control group input ports'),
            workderIndexPath: Rule.string().default(join(process.cwd(),'run','index.js')).description('Path to index.js file of vrack2-service')
        }
    }
    /**
     * Message index
    */
    private mIndex = 1

    /**
     * Worker index
    */
    private wIndex = 1

    /**
     * Message Queue. When a message is sent inside the service, `resolve` `reject` is rolled into this queue
    */
    private Queue = new Map<number, { resolve: (ret: any) => void, reject: (ret: any) => void }>()

    /**
     * List of workers
    */
    private workers = new Map<number, Worker>()

    /**
     * Contains a list of messages that are queued for a particular worker
    */
    private workersQueue: Array<Array<number>> = []

    preProcess(): void {
        for (let i = 1; i<= this.options.workerInputs; i++){
            this.addInputHandler(`worker${i}.add`, this.inputWorkerAdd.bind(this))
            this.addInputHandler(`worker${i}.stop`, this.inputWorkerStop.bind(this))
            this.addInputHandler(`worker${i}.request`, this.inputWorkerRequest.bind(this))
        }
    }

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
    inputWorkerAdd(data: { data: any, onError: (error: any) => void, onExit: () => void }) {
        return new Promise((resolve, reject) => {
            const id = this.workerIndex()
            const index = this.addWorkerQueue(id, resolve, reject)
            this.workersQueue[id] = []
            data.data.__index = index
            data.data.__id = id
            const nWorker = new Worker(this.options.workderIndexPath, { workerData: data.data })
            this.workers.set(id, nWorker)
            nWorker.on('message', (mData: IWorkerMessage)=>{
                if (mData.internal) return this.internal(id, mData)
                if (mData.command === 'broadcast') return this.ports.output['broadcast'].push(mData)
                if (mData.command === 'error') return nWorker.emit('error', ErrorManager.make('WM_INTERNAL_ERROR').add(mData.error as Error))
                if (mData.__index && this.Queue.has(mData.__index)) return this.queueMaintenance(id, mData)
            })
            nWorker.on('exit', ()=>{
                for (const queue of this.workersQueue[id]) {
                    const prom = this.Queue.get(queue)
                    if (!prom) continue
                    this.Queue.delete(queue)
                    prom.reject(ErrorManager.make('WM_WORKER_EXIT'))
                }
                this.workers.delete(id)
                delete this.workersQueue[id]
            }) 
            nWorker.on('error', data.onError)
            nWorker.on('exit', data.onExit)
        })
    }

    /**
     * Stop worker by id
     * After stopping, the event exit will be triggered
    */
    async inputWorkerStop(data: {id: number}) {
        if (!this.workers.has(data.id)) return
        try {
            await this.workerStopPromise(data)
        }catch(err){
            if (err instanceof CoreError){
                if (err.vShort === "WM_WORKER_EXIT") return 
            }
            throw err
        }
    }

    /**
     * Всегда возвращает ошибку при закрытии воркера.
     * В штатном режиме возрващает WM_WORKER_EXIT
     * 
     * @param {Object} data
     * @param {number} data.id Идентификатор воркера
    */
    workerStopPromise(data: {id: number}){
        return new Promise((resolve, reject) => {
            this.addWorkerQueue(data.id, resolve, reject)
            this.workers.get(data.id)?.terminate()
        })
    }

    /**
     * Sending a message to a Worker 
     * 
     * @param {Object} data 
     * @param data.id Worker ID
     * @param data.data Data for send to worker
    */
    inputWorkerRequest(data: {id: number, data: any}) {
        return new Promise((resolve, reject) => {
            const index = this.addWorkerQueue(data.id, resolve, reject)
            try {
                data.data.__index = index
                if (!this.workers.get(data.id)) throw ErrorManager.make('WM_WORKER_EXIT')
                this.workers.get(data.id)?.postMessage(data.data)
            } catch (error) {
                this.Queue.delete(index)
                reject(error)
            }
        })
    }

    /**
     * Called when there is a message index in the response from the Worker. 
     * And there is a message with this index in the queue
    */
    protected queueMaintenance(id: number,mData: IWorkerMessage){
        const prom = this.Queue.get(mData.__index)
        if (!prom) return {}
        this.Queue.delete(mData.__index)
        const index = this.workersQueue[id].indexOf(mData.__index)
        if (index !== -1) this.workersQueue[id].splice(index, 1)
        if (mData.result === 'error') {
          prom.reject((ErrorManager.make('WM_INTERNAL_ERROR')).import(mData.resultData))
        }
        prom.resolve(mData.resultData)
    }

    /**
     * Internal Message Processing.
     * Executes the Master command and returns the result back to the Worker
     * 
     * @param id Worker ID
     * @param data Data from Worker service
    */
    protected async internal(id: number, data: any){

        const notInternalCommand: IGuardMessage = {
            providerType: 'internal',
            providerId: 0,
            clientId: 0,
            level: 0,
            command: data.command,
            data: data.data
        }
        data.result = 'success'
        try { 
            data.resultData = await this.ports.output['master.command'].push(notInternalCommand)
        } catch (error) {
            data.resultData = CoreError.objectify(error)
            data.result = 'error'
        }
        this.workers.get(id)?.postMessage(data)
    }
    
    /**
     * Adding a new job to the Worker queue
     * 
     * @param id Worker id
     * @param resolve Resolve callback
     * @param reject Reject callback
    */
    private addWorkerQueue(id: number, resolve: (ret: any) => void, reject: (ret: any) => void) {
        const index = this.messageIndex()
        this.Queue.set(index, { resolve, reject })
        if (!this.workersQueue[id]) this.workersQueue[id] = []
        this.workersQueue[id].push(index)
        return index
    }

    /**
     * Return next message index
    */
    protected messageIndex() { return this.mIndex++ }
    /**
     * Return next worker index
    */
    protected workerIndex() { return this.wIndex++ }
}
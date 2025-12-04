"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = require("path");
const vrack2_core_1 = require("vrack2-core");
const worker_threads_1 = require("worker_threads");
vrack2_core_1.ErrorManager.register('WorkersManager', 'ASF6TC4U7J6P', 'WM_INTERNAL_ERROR', 'An error occurred within the service being used, causing it to terminate.');
vrack2_core_1.ErrorManager.register('WorkersManager', 'U4HUK15C0UVO', 'WM_WORKER_EXIT', 'The workers job was terminated, all tasks were deleted.');
class WorkersManager extends vrack2_core_1.Device {
    constructor() {
        super(...arguments);
        /**
         * Message index
        */
        this.mIndex = 1;
        /**
         * Worker index
        */
        this.wIndex = 1;
        /**
         * Message Queue. When a message is sent inside the service, `resolve` `reject` is rolled into this queue
        */
        this.Queue = new Map();
        /**
         * List of workers
        */
        this.workers = new Map();
        /**
         * Contains a list of messages that are queued for a particular worker
        */
        this.workersQueue = [];
    }
    inputs() {
        return {
            'worker%d.add': vrack2_core_1.Port.return().requirement(vrack2_core_1.Rule.object().required().fields({
                data: vrack2_core_1.Rule.object().description('Data for sending to worker at start'),
                onError: vrack2_core_1.Rule.function().description('On error callback'),
                onExit: vrack2_core_1.Rule.function().description('On onExit callback')
            }))
                .dynamic(this.options.workerInputs)
                .description('Add new worker'),
            'worker%d.stop': vrack2_core_1.Port.return().requirement(vrack2_core_1.Rule.object().required().fields({
                id: vrack2_core_1.Rule.object().description('Worker ID'),
            }))
                .dynamic(this.options.workerInputs)
                .description('Stop worker port'),
            'worker%d.request': vrack2_core_1.Port.return().requirement(vrack2_core_1.Rule.object().required().fields({
                id: vrack2_core_1.Rule.object().description('Worker ID'),
            }))
                .dynamic(this.options.workerInputs)
                .description('Send request to worker')
        };
    }
    outputs() {
        return {
            'master.command': vrack2_core_1.Port.return(),
            'broadcast': vrack2_core_1.Port.standart()
        };
    }
    checkOptions() {
        return {
            workerInputs: vrack2_core_1.Rule.number().default(3).description('Number of workers control group input ports'),
            workderIndexPath: vrack2_core_1.Rule.string().default((0, path_1.join)(process.cwd(), 'run', 'index.js')).description('Path to index.js file of vrack2-service')
        };
    }
    preProcess() {
        for (let i = 1; i <= this.options.workerInputs; i++) {
            this.addInputHandler(`worker${i}.add`, this.inputWorkerAdd.bind(this));
            this.addInputHandler(`worker${i}.stop`, this.inputWorkerStop.bind(this));
            this.addInputHandler(`worker${i}.request`, this.inputWorkerRequest.bind(this));
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
    inputWorkerAdd(data) {
        return new Promise((resolve, reject) => {
            const id = this.workerIndex();
            const index = this.addWorkerQueue(id, resolve, reject);
            this.workersQueue[id] = [];
            data.data.__index = index;
            data.data.__id = id;
            const nWorker = new worker_threads_1.Worker(this.options.workderIndexPath, { workerData: data.data });
            this.workers.set(id, nWorker);
            nWorker.on('message', (mData) => {
                if (mData.internal)
                    return this.internal(id, mData);
                if (mData.command === 'broadcast')
                    return this.ports.output['broadcast'].push(mData);
                if (mData.command === 'error')
                    return nWorker.emit('error', vrack2_core_1.ErrorManager.make('WM_INTERNAL_ERROR').add(mData.error));
                if (mData.__index && this.Queue.has(mData.__index))
                    return this.queueMaintenance(id, mData);
            });
            nWorker.on('exit', () => {
                for (const queue of this.workersQueue[id]) {
                    const prom = this.Queue.get(queue);
                    if (!prom)
                        continue;
                    this.Queue.delete(queue);
                    prom.reject(vrack2_core_1.ErrorManager.make('WM_WORKER_EXIT'));
                }
                this.workers.delete(id);
                delete this.workersQueue[id];
            });
            nWorker.on('error', data.onError);
            nWorker.on('exit', data.onExit);
        });
    }
    /**
     * Stop worker by id
     * After stopping, the event exit will be triggered
    */
    inputWorkerStop(data) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.workers.has(data.id))
                return;
            try {
                yield this.workerStopPromise(data);
            }
            catch (err) {
                if (err instanceof vrack2_core_1.CoreError) {
                    if (err.vShort === "WM_WORKER_EXIT")
                        return;
                }
                throw err;
            }
        });
    }
    /**
     * Всегда возвращает ошибку при закрытии воркера.
     * В штатном режиме возрващает WM_WORKER_EXIT
     *
     * @param {Object} data
     * @param {number} data.id Идентификатор воркера
    */
    workerStopPromise(data) {
        return new Promise((resolve, reject) => {
            var _a;
            this.addWorkerQueue(data.id, resolve, reject);
            (_a = this.workers.get(data.id)) === null || _a === void 0 ? void 0 : _a.terminate();
        });
    }
    /**
     * Sending a message to a Worker
     *
     * @param {Object} data
     * @param data.id Worker ID
     * @param data.data Data for send to worker
    */
    inputWorkerRequest(data) {
        return new Promise((resolve, reject) => {
            var _a;
            const index = this.addWorkerQueue(data.id, resolve, reject);
            try {
                data.data.__index = index;
                if (!this.workers.get(data.id))
                    throw vrack2_core_1.ErrorManager.make('WM_WORKER_EXIT');
                (_a = this.workers.get(data.id)) === null || _a === void 0 ? void 0 : _a.postMessage(data.data);
            }
            catch (error) {
                this.Queue.delete(index);
                reject(error);
            }
        });
    }
    /**
     * Called when there is a message index in the response from the Worker.
     * And there is a message with this index in the queue
    */
    queueMaintenance(id, mData) {
        const prom = this.Queue.get(mData.__index);
        if (!prom)
            return {};
        this.Queue.delete(mData.__index);
        const index = this.workersQueue[id].indexOf(mData.__index);
        if (index !== -1)
            this.workersQueue[id].splice(index, 1);
        if (mData.result === 'error') {
            prom.reject((vrack2_core_1.ErrorManager.make('WM_INTERNAL_ERROR')).import(mData.resultData));
        }
        prom.resolve(mData.resultData);
    }
    /**
     * Internal Message Processing.
     * Executes the Master command and returns the result back to the Worker
     *
     * @param id Worker ID
     * @param data Data from Worker service
    */
    internal(id, data) {
        var _a;
        return __awaiter(this, void 0, void 0, function* () {
            const notInternalCommand = {
                providerType: 'internal',
                providerId: 0,
                clientId: 0,
                level: 0,
                command: data.command,
                data: data.data
            };
            data.result = 'success';
            try {
                data.resultData = yield this.ports.output['master.command'].push(notInternalCommand);
            }
            catch (error) {
                data.resultData = vrack2_core_1.CoreError.objectify(error);
                data.result = 'error';
            }
            (_a = this.workers.get(id)) === null || _a === void 0 ? void 0 : _a.postMessage(data);
        });
    }
    /**
     * Adding a new job to the Worker queue
     *
     * @param id Worker id
     * @param resolve Resolve callback
     * @param reject Reject callback
    */
    addWorkerQueue(id, resolve, reject) {
        const index = this.messageIndex();
        this.Queue.set(index, { resolve, reject });
        if (!this.workersQueue[id])
            this.workersQueue[id] = [];
        this.workersQueue[id].push(index);
        return index;
    }
    /**
     * Return next message index
    */
    messageIndex() { return this.mIndex++; }
    /**
     * Return next worker index
    */
    workerIndex() { return this.wIndex++; }
}
exports.default = WorkersManager;

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
const vrack2_core_1 = require("vrack2-core");
const worker_threads_1 = require("worker_threads");
const worker_threads_2 = require("worker_threads");
vrack2_core_1.ErrorManager.register('WorkerProvider', 'O0LWU331YS7J', 'WP_INTERNAL_COMMAND_ERROR', 'An error occurred while executing an internal command that the service sent to VRACK.');
class WorkerProvider extends vrack2_core_1.Device {
    constructor() {
        super(...arguments);
        this.queue = new Map();
        this.qIndex = 1;
    }
    outputs() {
        return {
            command: vrack2_core_1.Port.return().description('Port for client command request'),
        };
    }
    inputs() {
        return {
            send: vrack2_core_1.Port.standart().description('Send data to parent process'),
            broadcast: vrack2_core_1.Port.standart().description('Send broadcast to client'),
            internal: vrack2_core_1.Port.return().description('Request internal command'),
        };
    }
    checkOptions() {
        return {};
    }
    process() {
        // Bind loaded method for send signal to service manager
        this.Container.on('loaded', this.loaded.bind(this));
        worker_threads_1.parentPort === null || worker_threads_1.parentPort === void 0 ? void 0 : worker_threads_1.parentPort.on('message', this.inputCommand.bind(this));
    }
    /**
     * Receiving and processing a command from the main VRack2 service
     *
     * @see WorkerProvider.process()
    */
    inputCommand(command) {
        return __awaiter(this, void 0, void 0, function* () {
            /**
             * internal command processing (if flag internal is true)
            */
            if (command.internal && command.iIndex) {
                if (this.queue.has(command.iIndex)) {
                    const promise = this.queue.get(command.iIndex);
                    if (!promise)
                        return;
                    this.queue.delete(command.iIndex);
                    if (command.result === 'success') {
                        promise.resolve(command.resultData);
                    }
                    else if (command.result === 'error') {
                        promise.reject((vrack2_core_1.ErrorManager.make('WP_INTERNAL_COMMAND_ERROR')).import(command.resultData));
                    }
                }
                return;
            }
            try {
                const result = yield this.ports.output['command'].push(command);
                command.result = 'success';
                command.resultData = result;
                this.postMessage(command);
            }
            catch (err) {
                command.result = 'error';
                command.resultData = vrack2_core_1.CoreError.objectify(err);
                this.postMessage(command);
            }
        });
    }
    /**
     * Sends the brodcast to the main VRack2 service
    */
    inputBroadcast(data) {
        this.postMessage({
            command: 'broadcast',
            channel: data.channel,
            data: data.data
        });
    }
    /**
     * Sends the command that VRack2 should execute through Master for execution
    */
    inputInternal(data) {
        return new Promise((resolve, reject) => {
            const index = this.queueIndex();
            this.queue.set(index, { resolve, reject });
            this.postMessage({
                command: data.command,
                data: data.data,
                iIndex: index,
                internal: true
            });
        });
    }
    /**
     * Sending raw data to VRack2
    */
    inputSend(data) {
        this.postMessage(data);
    }
    /**
     * Send data to ServiceManager after service loaded
    */
    loaded() {
        this.inputSend({
            __index: worker_threads_2.workerData.__index,
            __id: worker_threads_2.workerData.__id,
            resultData: worker_threads_2.workerData.__id
        });
    }
    /**
     * Processes the response of an internal command that was sent from the same
     * service to the main service
     *
     *
    */
    internalResponse(command) {
        if (!command.internal || !command.iIndex)
            return;
        if (!this.queue.has(command.iIndex))
            return;
        const promise = this.queue.get(command.iIndex);
        if (!promise)
            return;
        this.queue.delete(command.iIndex);
        if (command.result === 'success')
            promise.resolve(command.resultData);
        else if (command.result === 'error')
            promise.reject((vrack2_core_1.ErrorManager.make('WP_INTERNAL_COMMAND_ERROR')).import(command.resultData));
        return;
    }
    /**
     * Return next queue index
    */
    queueIndex() { return this.qIndex++; }
    /**
     * Send raw data to parentPort
    */
    postMessage(data) {
        worker_threads_1.parentPort === null || worker_threads_1.parentPort === void 0 ? void 0 : worker_threads_1.parentPort.postMessage(data);
    }
}
exports.default = WorkerProvider;

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vrack2_core_1 = require("vrack2-core");
vrack2_core_1.ErrorManager.register('InterService', 'SC3AHS7GZUTZ', 'INTER_SERVICE_PROCESS_ERROR', 'You are trying to run a device outside of a service container. This device can only run inside a service with WorkerProvider');
/**
 * A device that can execute commands outside its service (the service of VRack2 itself).
 * This allows executing actions or accessing ports of another service.
 * As well as control other VRack2 services
*/
class InterService extends vrack2_core_1.Device {
    inputs() {
        return {
            'command%d': vrack2_core_1.Port.return().dynamic(this.options.inputs).requirement(vrack2_core_1.Rule.object().fields({
                command: vrack2_core_1.Rule.string().example('serviceStart').maxLength(120).description('VRack2 general service master command'),
                data: vrack2_core_1.Rule.object().example({}).description('Command data')
            })).return(vrack2_core_1.Rule.boolean()).description('Port for run internal VRack2 service command')
        };
    }
    checkOptions() {
        return {
            inputs: vrack2_core_1.Rule.number().integer().min(0).default(1).required().description('Count input command ports')
        };
    }
    preProcess() {
        for (let i = 1; i <= this.options.inputs; i++)
            this.addInputHandler('command' + i, this.inputCommand.bind(this));
    }
    process() {
        var _a;
        if (!this.Container.parent)
            throw vrack2_core_1.ErrorManager.make('INTER_SERVICE_PROCESS_ERROR');
        if (!((_a = this.Container.parent) === null || _a === void 0 ? void 0 : _a.devices['WorkerProvider']))
            throw vrack2_core_1.ErrorManager.make('INTER_SERVICE_PROCESS_ERROR');
    }
    /**
     * Run internal command WorkerProvider.
     * The method is transparent. Error handling takes place at the command call level of this device,
     * i.e. in the area of responsibility of the device higher up
     *
     * @see WorkerProvider
    */
    inputCommand(data) {
        var _a;
        const WorkerProvider = (_a = this.Container.parent) === null || _a === void 0 ? void 0 : _a.devices['WorkerProvider'];
        return WorkerProvider.inputInternal(data);
    }
}
exports.default = InterService;

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
class DeviceWorker extends vrack2_core_1.Device {
    outputs() {
        return {
            'register.command': vrack2_core_1.Port.standart().description('Register command into master'),
        };
    }
    process() {
        this.ports.output['register.command'].push({
            command: 'vendorList',
            short: 'Get vendors list',
            description: 'Getting device vendors',
            level: 3,
            owner: this.type,
            icon: 'globe',
            handler: this.apiVendorList.bind(this),
            rules: {},
            return: vrack2_core_1.Rule.array().content(vrack2_core_1.Rule.string().example('vrack').description('Vendor name (vendor unique ID)')).description('Array of vendor list')
        });
        this.ports.output['register.command'].push({
            command: 'vendorDevices',
            short: 'Get devices list',
            description: 'Getting device vendors',
            level: 3,
            owner: this.type,
            icon: 'hdd-stack',
            handler: this.apiVendorDevices.bind(this),
            rules: {
                vendor: vrack2_core_1.Rule.string().maxLength(250).example('vrack').require().description('Vendor'),
            },
            return: vrack2_core_1.Rule.array().content(vrack2_core_1.Rule.string().example('DeviceName').description('Device name (device name of this vendor)')).description('Array of device list')
        });
        this.ports.output['register.command'].push({
            command: 'vendorDeviceInfo',
            short: 'Get device info',
            description: 'Getting device info',
            level: 3,
            owner: this.type,
            icon: 'hdd',
            handler: this.apiVendorDeviceInfo.bind(this),
            rules: {
                vendor: vrack2_core_1.Rule.string().maxLength(250).example('vrack').require().description('Vendor ID'),
                device: vrack2_core_1.Rule.string().maxLength(250).example('DeviceID').require().description('Device ID')
            },
            return: vrack2_core_1.Rule.object().fields({
                actions: vrack2_core_1.Rule.object().description('Actions list - see IAction'),
                metrics: vrack2_core_1.Rule.object().description('Metrics list - see IMetricSettings'),
                inputs: vrack2_core_1.Rule.object().description('Input ports list - see IPort'),
                outputs: vrack2_core_1.Rule.object().description('Output ports list - see IPort'),
                checkOptions: vrack2_core_1.Rule.object().description('Options rules list - see IValidationRule'),
                description: vrack2_core_1.Rule.string().description('Device descriotion'),
            }).description('Device info object')
        });
    }
    /**
     * Returns a list of device vendors
    */
    apiVendorList() {
        return __awaiter(this, void 0, void 0, function* () {
            const DM = this.Container.Bootstrap.getBootClass('DeviceManager', vrack2_core_1.DeviceManager);
            return DM.getVendorList();
        });
    }
    /**
     * Getting the list of devices by its vendor
    */
    apiVendorDevices(data) {
        return __awaiter(this, void 0, void 0, function* () {
            const DM = this.Container.Bootstrap.getBootClass('DeviceManager', vrack2_core_1.DeviceManager);
            return DM.getVendorDeviceList(data.vendor);
        });
    }
    /**
     * Getting information about the device
    */
    apiVendorDeviceInfo(data) {
        return __awaiter(this, void 0, void 0, function* () {
            const DM = this.Container.Bootstrap.getBootClass('DeviceManager', vrack2_core_1.DeviceManager);
            return DM.getDeviceInfo(data.vendor, data.device);
        });
    }
}
exports.default = DeviceWorker;

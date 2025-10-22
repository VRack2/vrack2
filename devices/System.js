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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vrack2_core_1 = require("vrack2-core");
const os_1 = __importDefault(require("os"));
const process_1 = __importDefault(require("process"));
class System extends vrack2_core_1.Device {
    outputs() {
        return {
            'register.command': vrack2_core_1.Port.standart().description('Register command into master'),
        };
    }
    metrics() {
        return {
            'memory.rss': vrack2_core_1.Metric.inS().retentions('5s:30m, 15s:2h, 1m:1d, 1h:1w, 6h:1mon, 1d:1y').description('System memory rss'),
            'memory.heaptotal': vrack2_core_1.Metric.inS().retentions('5s:30m, 15s:2h, 1m:1d, 1h:1w, 6h:1mon, 1d:1y').description('System memory heapTotal'),
            'memory.heapused': vrack2_core_1.Metric.inS().retentions('5s:30m, 15s:2h, 1m:1d, 1h:1w, 6h:1mon, 1d:1y').description('System memory heapUsed'),
            'memory.external': vrack2_core_1.Metric.inS().retentions('5s:30m, 15s:2h, 1m:1d, 1h:1w, 6h:1mon, 1d:1y').description('System memory external'),
            'memory.arraybuffers': vrack2_core_1.Metric.inS().retentions('5s:30m, 15s:2h, 1m:1d, 1h:1w, 6h:1mon, 1d:1y').description('System memory arrayBuffers'),
        };
    }
    process() {
        this.ports.output['register.command'].push({
            command: 'structureGet',
            short: 'Get structure',
            description: 'Return container structure by container ID',
            level: 3,
            owner: this.type,
            icon: 'map-fill',
            handler: this.apiStructureGet.bind(this),
            rules: { id: vrack2_core_1.Rule.string().require().example('vrack2').description('Container unique identify (see Container.id)') },
            return: vrack2_core_1.Rule.object().description('Container structure object - see IContainerStructure')
        });
        this.ports.output['register.command'].push({
            command: 'structureUpdate',
            short: 'Update structure',
            description: 'Update structure by container unique identify',
            level: 1,
            owner: this.type,
            icon: 'marker-tip',
            handler: this.apiStructureUpdate.bind(this),
            rules: {
                id: vrack2_core_1.Rule.string().require().example('vrack2').description('Container unique identify (see Container.id)'),
                structure: vrack2_core_1.Rule.object().require().description('New Structure - see IContainerStructure')
            },
        });
        this.ports.output['register.command'].push({
            command: 'systemMetric',
            short: 'Get system metric',
            description: 'Getting a system metrics',
            level: 3,
            owner: this.type,
            icon: 'graph-up',
            handler: this.apiSystemMetric.bind(this),
            rules: {
                service: vrack2_core_1.Rule.string().maxLength(120).default('not used').require().description('Service id (not used for this action)'),
                device: vrack2_core_1.Rule.string().maxLength(120).example('DeviceID').require().description('Device id'),
                metric: vrack2_core_1.Rule.string().maxLength(120).example('metric.id').require().description('Device metric path'),
                period: vrack2_core_1.Rule.string().maxLength(120).example('start:end').require().description('VRackDB period'),
                precision: vrack2_core_1.Rule.string().maxLength(60).require().example('400').description('VRackDB precision'),
                func: vrack2_core_1.Rule.string().default('last').maxLength(10).description('Read function (last,first,min,max,avg,sum)')
            },
            return: vrack2_core_1.Rule.object().fields({
                relevant: vrack2_core_1.Rule.boolean().default(false).example(false).description('result relevance flag'),
                start: vrack2_core_1.Rule.number().integer().example(1).description('Beginning of the period'),
                end: vrack2_core_1.Rule.number().integer().example(100).description('End of period '),
                rows: vrack2_core_1.Rule.array().content(vrack2_core_1.Rule.object().fields({
                    time: vrack2_core_1.Rule.number().integer().example(10).description('Time in MTU'),
                    value: vrack2_core_1.Rule.number().example(12.3223).description('Metric value || null')
                }).description('Metric storage object')).description('Array of metrics')
            }).description('Metric request result - see vrack-db read documentation')
        });
        this.ports.output['register.command'].push({
            command: 'systemInfo',
            short: 'Get sysinfo',
            description: 'Returns the basic information available to nodejs',
            level: 3,
            owner: this.type,
            icon: 'cpu',
            handler: this.apiGetSystemInfo.bind(this),
            rules: {},
            return: vrack2_core_1.Rule.object().fields({
                os: vrack2_core_1.Rule.object().fields({
                    platform: vrack2_core_1.Rule.string().example('win23').description('Platform type like a win32 openbsd...'),
                    type: vrack2_core_1.Rule.string().example('Linux').description('returns Linux, Darwin, Windows_NT'),
                    release: vrack2_core_1.Rule.string().example('5.15.0-134-generic').description('Release os string'),
                    arch: vrack2_core_1.Rule.string().example('x64').description('Os arch like a x86,arm64...')
                }).description('OS informations'),
                cpu: vrack2_core_1.Rule.object().fields({
                    model: vrack2_core_1.Rule.string().example('Common KVM processor').description('Cpu model name or unknown'),
                    cores: vrack2_core_1.Rule.number().example(2).integer().description('Number of cores'),
                    speed: vrack2_core_1.Rule.string().example('3000 MHz').description('Basic cpu speed')
                }).description('Cpu information (for unix systems only)'),
                node: vrack2_core_1.Rule.object().fields({
                    version: vrack2_core_1.Rule.string().example('v16.20.2').description('Node version'),
                    v8: vrack2_core_1.Rule.string().example('9.4.146.26-node.26').description('v8 info'),
                    openssl: vrack2_core_1.Rule.string().example('1.1.1v+quic').description('Openssl info'),
                    pid: vrack2_core_1.Rule.string().example('1612434').description('Pid info'),
                    uptime: vrack2_core_1.Rule.string().example('8621.45 minutes').description('Uptime in minutes'),
                }).description('Node js information'),
                user: vrack2_core_1.Rule.object().fields({
                    hostname: vrack2_core_1.Rule.string().example('vmain').description('Host name'),
                    homedir: vrack2_core_1.Rule.string().example('/home/user/').description('v8 info'),
                    userInfo: vrack2_core_1.Rule.object().description('System user information'),
                }),
                network: vrack2_core_1.Rule.object().description('Network interfaces information - see os.networkInterfaces()')
            }).description('Device info object')
        });
        setInterval(() => {
            const mem = process_1.default.memoryUsage();
            this.metric('memory.rss', Math.round(mem.rss / 1024 / 1024));
            this.metric('memory.heaptotal', Math.round(mem.heapTotal / 1024 / 1024));
            this.metric('memory.heapused', Math.round(mem.heapUsed / 1024 / 1024));
            this.metric('memory.external', Math.round(mem.external / 1024 / 1024));
            this.metric('memory.arraybuffers', Math.round(mem.arrayBuffers / 1024 / 1024));
        }, 5000);
    }
    /**
     * Getting the service structure
     * Allows you to retrieve the structure of any service by container ID
    */
    apiStructureGet(data) {
        return __awaiter(this, void 0, void 0, function* () {
            const SS = this.Container.Bootstrap.getBootClass('StructureStorage', vrack2_core_1.StructureStorage);
            return yield SS.getById(data.id);
        });
    }
    /**
     * Update the service structure
     * Allows you to update the structure of any service by container ID
    */
    apiStructureUpdate(data) {
        return __awaiter(this, void 0, void 0, function* () {
            const SS = this.Container.Bootstrap.getBootClass('StructureStorage', vrack2_core_1.StructureStorage);
            yield SS.updateById(data.id, data.structure);
            return {};
        });
    }
    /**
     * Getting device metric
     * Obtaining system metrics. Those that were initialized at the VRack2 level
    */
    apiSystemMetric(data, gData) {
        return __awaiter(this, void 0, void 0, function* () {
            const DM = this.Container.Bootstrap.getBootClass('DeviceMetrics', vrack2_core_1.DeviceMetrics);
            let precision = data.precision;
            if (!isNaN(parseInt(precision)))
                precision = parseInt(precision);
            return DM.read(data.device, data.metric, data.period, precision, data.func);
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
    /**
     * Getting system infomation
     *
    */
    apiGetSystemInfo() {
        var _a, _b;
        return __awaiter(this, void 0, void 0, function* () {
            const getCpuInfo = () => {
                const cpus = os_1.default.cpus();
                if (!cpus || cpus.length === 0) {
                    return {
                        model: 'Unknown',
                        cores: 0,
                        speed: '0 MHz'
                    };
                }
                return {
                    model: cpus[0].model || 'Unknown',
                    cores: cpus.length,
                    speed: (cpus[0].speed || 0) + ' MHz'
                };
            };
            // Безопасное получение информации о пользователе
            const getUserInfo = () => {
                try {
                    return os_1.default.userInfo();
                }
                catch (e) {
                    return { uid: -1, gid: -1, username: 'Unknown', homedir: 'Unknown', shell: null };
                }
            };
            return {
                os: {
                    platform: os_1.default.platform() || 'Unknown',
                    type: os_1.default.type() || 'Unknown',
                    release: os_1.default.release() || 'Unknown',
                    arch: os_1.default.arch() || 'Unknown'
                },
                cpu: getCpuInfo(),
                node: {
                    version: process_1.default.version || 'Unknown',
                    v8: ((_a = process_1.default.versions) === null || _a === void 0 ? void 0 : _a.v8) || 'Unknown',
                    openssl: ((_b = process_1.default.versions) === null || _b === void 0 ? void 0 : _b.openssl) || 'Unknown',
                    pid: process_1.default.pid || 'Unknown',
                    uptime: (process_1.default.uptime() / 60).toFixed(2) + ' minutes'
                },
                user: {
                    hostname: os_1.default.hostname() || 'Unknown',
                    homedir: os_1.default.homedir() || 'Unknown',
                    userInfo: getUserInfo()
                },
                network: os_1.default.networkInterfaces() || {}
            };
        });
    }
}
exports.default = System;

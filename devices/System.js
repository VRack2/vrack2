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
vrack2_core_1.ErrorManager.register('System', 'SYS_SHUTDOWN_TIMEOUT', 'Graceful shutdown did not finish within shutdownTimeout; the process force-exits', {
    timeout: vrack2_core_1.Rule.number().required().example(10000).description('Shutdown timeout, ms')
});
vrack2_core_1.ErrorManager.register('System', 'SYS_SHUTDOWN_STOP_FAILED', 'Container.stopAll() failed during graceful shutdown', {});
vrack2_core_1.ErrorManager.register('System', 'SYS_SHUTDOWN_DESTROY_FAILED', 'Bootstrap.destroyAll() failed during graceful shutdown', {});
class System extends vrack2_core_1.Device {
    description() {
        return `Устройство System предоставляет системную информацию и метрики. 
Оно отслеживает использование памяти системы и предоставляет API для получения информации о хосте, CPU, сети и Node.js окружении. 
Устройство также позволяет получать системные метрики через VRackDB и управлять визуальной структурой сервисов по их ID.`;
    }
    outputs() {
        return {
            'register.command': vrack2_core_1.Port.standard().description('Register command into master'),
        };
    }
    checkOptions() {
        return {
            shutdownTimeout: vrack2_core_1.Rule.number().integer().min(1000).default(15000).required()
                .description('Graceful shutdown watchdog (ms): if Container.stopAll/destroyAll does not finish in time, force-exit'),
        };
    }
    metrics() {
        return {
            'memory.rss': vrack2_core_1.Metric.one().descriptions('System memory rss'),
            'memory.heaptotal': vrack2_core_1.Metric.one().descriptions('System memory heapTotal'),
            'memory.heapused': vrack2_core_1.Metric.one().descriptions('System memory heapUsed'),
            'memory.external': vrack2_core_1.Metric.one().descriptions('System memory external'),
            'memory.arraybuffers': vrack2_core_1.Metric.one().descriptions('System memory arrayBuffers'),
        };
    }
    onStart() {
        this.bindShutdown();
        this.ports.output['register.command'].push({
            command: 'structureGet',
            short: 'Get structure',
            description: 'Return container structure by container ID',
            level: 3,
            owner: this.type,
            icon: 'map-fill',
            handler: this.apiStructureGet.bind(this),
            rules: { id: vrack2_core_1.Rule.string().required().example('vrack2').description('Container unique identify (see Container.id)') },
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
                id: vrack2_core_1.Rule.string().required().example('vrack2').description('Container unique identify (see Container.id)'),
                structure: vrack2_core_1.Rule.object().required().description('New Structure - see IContainerStructure')
            },
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
        this.memTimer = setInterval(() => {
            const mem = process_1.default.memoryUsage();
            this.metric('memory.rss', Math.round(mem.rss / 1024 / 1024));
            this.metric('memory.heaptotal', Math.round(mem.heapTotal / 1024 / 1024));
            this.metric('memory.heapused', Math.round(mem.heapUsed / 1024 / 1024));
            this.metric('memory.external', Math.round(mem.external / 1024 / 1024));
            this.metric('memory.arraybuffers', Math.round(mem.arrayBuffers / 1024 / 1024));
        }, 5000);
    }
    /**
     * Release the memory-metrics interval owned by this device. Without this the
     * interval keeps the event loop alive after Container.stopAll(), so the
     * process only exits because the shutdown chain calls process.exit()
     * explicitly, and restarting the device stacks a second interval.
     */
    onStop() {
        if (this.memTimer) {
            clearInterval(this.memTimer);
            this.memTimer = undefined;
        }
    }
    /**
     * Graceful shutdown of the master container on SIGINT/SIGTERM.
     *
     * The framework does not manage the host process lifecycle, so this device
     * (the platform's own System device) owns it: on a termination signal it
     * runs the canonical teardown — `Container.stopAll()` (devices stopped in
     * reverse start order: ServiceManager.onStopAsync stops every service, so
     * their final journal batches reach the still-open Journal tables; Journal
     * is started first and therefore stopped last, flushing its segments) then
     * `Bootstrap.destroyAll()` (boot-class stores closed) — and only then exits
     * the process.
     *
     * Idempotent latch: the journal-db Shutdown hook re-raises the same signal
     * synchronously after draining the WAL; that re-entrant call is ignored. A
     * genuine second signal (a real second Ctrl+C, > 1s later) force-exits.
     */
    bindShutdown() {
        let stoppingAt = 0;
        const handler = (signal) => {
            var _a;
            if (stoppingAt) {
                // Re-entrant re-raise from the journal-db hook (same tick) — ignore.
                // A real second signal (user pressed Ctrl+C again) — force exit.
                if (Date.now() - stoppingAt > 1000)
                    process_1.default.exit(1);
                return;
            }
            stoppingAt = Date.now();
            this.terminal('shutdown signal received', { signal });
            // Watchdog: if teardown hangs (a device onStopAsync never resolves),
            // force-exit. unref so it doesn't hold the loop when teardown is fast.
            const watchdog = setTimeout(() => {
                this.error('graceful shutdown timed out — force exit', vrack2_core_1.ErrorManager.make('SYS_SHUTDOWN_TIMEOUT', { timeout: this.options.shutdownTimeout }));
                process_1.default.exit(1);
            }, this.options.shutdownTimeout);
            (_a = watchdog.unref) === null || _a === void 0 ? void 0 : _a.call(watchdog);
            let hadError = false;
            Promise.resolve()
                .then(() => this.Container.stopAll())
                .catch((e) => { hadError = true; this.error('container stopAll failed during shutdown', vrack2_core_1.ErrorManager.make('SYS_SHUTDOWN_STOP_FAILED').add(e)); })
                .then(() => this.Container.Bootstrap.destroyAll())
                .catch((e) => { hadError = true; this.error('bootstrap destroyAll failed during shutdown', vrack2_core_1.ErrorManager.make('SYS_SHUTDOWN_DESTROY_FAILED').add(e)); })
                .then(() => { clearTimeout(watchdog); process_1.default.exit(hadError ? 1 : 0); });
        };
        process_1.default.on('SIGINT', () => handler('SIGINT'));
        process_1.default.on('SIGTERM', () => handler('SIGTERM'));
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
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
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

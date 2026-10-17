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
vrack2_core_1.ErrorManager.register('Service', 'SERVICE_CONTAINER_ERROR', 'An error occurred while loading the container. The reason may be - an incorrect scheme or an error initializing the device. This is a general container loading error, see the nested error inside this');
vrack2_core_1.ErrorManager.register('Service', 'SERVICE_CONTAINER_TERMINATE', 'The error occurred because some device called the termination method. See the nested error inside this', {
    device: vrack2_core_1.Rule.string().default('').description('Device ID')
});
vrack2_core_1.ErrorManager.register('Service', 'SERVICE_CAPTURE_PORT_TIMEOUT', 'Timeout occurred while waiting for device output capture');
class Serivce extends vrack2_core_1.Device {
    constructor() {
        super(...arguments);
        /**
         * Devices events list
        */
        this.eventsChannels = {
            'device.error': 'error',
            'device.notify': 'notify',
            'device.alert': 'alert',
            'device.terminal': 'terminal',
            'device.event': 'event'
        };
        /**
         * Service container
         */
        this.ServiceContainer = new vrack2_core_1.Container('', {});
        /**
         * Service info (getting from service manager)
        */
        this.Serviceinfo = {
            id: '', errors: 0,
            filePath: '',
            metaPath: '',
            configPath: '',
            processPath: '',
            run: false, deleted: false,
        };
        /**
         * Service meta (getting from service manager)
        */
        this.ServiceMeta = {
            name: '', group: '', description: '',
            system: false, autoStart: false, autoReload: false, isolated: false
        };
        /***
         * Render pull for service shares data
         */
        this.renderPull = new Set();
        /**
         * Render timer
         */
        this.renderTimer = false;
        /**
         * Memory metrics timer (setInterval from onStart)
         */
        this.memTimer = null;
        /**
         * Индекс для захвата порта устройства
         */
        this.captureIndex = 1000;
        /**
         * Пулл для хранения таймаутов захвата порта устройства
        */
        this.capturePull = new Map();
    }
    description() {
        return `Устройство Serivce управляет контейнером сервиса, обеспечивая его запуск, мониторинг и управление. 
Оно предоставляет API-команды для запуска сервиса, получения метрик устройств, выполнения действий и отправки данных. 
Устройство отслеживает ошибки контейнера и автоматически завершает работу при возникновении критических ошибок.`;
    }
    outputs() {
        return {
            send: vrack2_core_1.Port.standard().description('Send data to parent process'),
            broadcast: vrack2_core_1.Port.standard().description('Send broadcast to client'),
            'master.command': vrack2_core_1.Port.return().description('Run master command'),
            'register.command': vrack2_core_1.Port.standard().description('Register command into master'),
            container: vrack2_core_1.Port.standard().description('Emits the live Container of the started service'),
        };
    }
    inputs() {
        return {};
    }
    checkOptions() {
        return {
            'mainProcessPath': vrack2_core_1.Rule.string().required().default('vrack2-core.MainProcess').description('Main process class path'),
            'renderDelay': vrack2_core_1.Rule.number().integer().min(10).max(3000).default(10).description('Minimal render delay for render shares'),
            'uncaughtTerminate': vrack2_core_1.Rule.boolean().default(true).description('Terminate service if call uncaught exception'),
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
    onStart() {
        // Register api commands
        this.ports.output['register.command'].push({
            command: 'serviceStart',
            description: 'Internal service command for starting container',
            level: 0,
            owner: this.type,
            handler: this.apiServiceStart.bind(this),
            rules: {
                service: vrack2_core_1.Rule.string().maxLength(120).required().example('test-service').description('Service id'),
            },
        });
        this.ports.output['register.command'].push({
            command: 'serviceCheck',
            description: 'Internal service command for check container',
            level: 0,
            owner: this.type,
            handler: this.apiServiceCheck.bind(this),
            rules: {
                service: vrack2_core_1.Rule.string().maxLength(120).required().example('test-service').description('Service id'),
            },
        });
        this.ports.output['register.command'].push({
            command: 'serviceStop',
            description: 'Internal service command for graceful stop of the container and worker self-exit',
            level: 0,
            owner: this.type,
            handler: this.apiServiceStop.bind(this),
            rules: {
                service: vrack2_core_1.Rule.string().maxLength(120).required().example('test-service').description('Service id'),
            },
        });
        this.ports.output['register.command'].push({
            command: 'serviceShares',
            description: 'Sends the current shares of all service devices to subscribers (direct push)',
            level: 3,
            owner: this.type,
            handler: this.apiServiceShares.bind(this),
            rules: {
                service: vrack2_core_1.Rule.string().maxLength(120).required().example('test-service').description('Service id'),
            },
        });
        this.ports.output['register.command'].push({
            command: 'serviceDeviceAction',
            description: 'Calling a device action',
            level: 2,
            owner: this.type,
            handler: this.apiServiceDeviceAction.bind(this),
            rules: {
                service: vrack2_core_1.Rule.string().maxLength(120).required().example('test-service').description('Service id'),
                device: vrack2_core_1.Rule.string().maxLength(120).required().example('DeviceID').description('Device id'),
                action: vrack2_core_1.Rule.string().maxLength(120).required().example('action.name').description('Action name (dot style!)'),
                data: vrack2_core_1.Rule.object().required().example({}).description('Data for push into action')
            },
        });
        this.ports.output['register.command'].push({
            command: 'serviceDevicePush',
            description: 'Calling a device port.push',
            level: 1,
            owner: this.type,
            handler: this.apiServiceDevicePush.bind(this),
            rules: {
                service: vrack2_core_1.Rule.string().maxLength(120).required().example('test-service').description('Service id'),
                device: vrack2_core_1.Rule.string().maxLength(120).required().example('DeviceID').description('Device id'),
                port: vrack2_core_1.Rule.string().maxLength(120).required().example('portname').description('Input port of device'),
                data: vrack2_core_1.Rule.any().required().example(1).description('Data for push into port')
            },
        });
        this.ports.output['register.command'].push({
            command: 'serviceDeviceShares',
            description: 'Get current shares data of a device',
            level: 1,
            owner: this.type,
            handler: this.apiServiceDeviceShares.bind(this),
            rules: {
                service: vrack2_core_1.Rule.string().maxLength(120).required().example('test-service').description('Service id'),
                device: vrack2_core_1.Rule.string().maxLength(120).required().example('DeviceID').description('Device id'),
            },
            return: vrack2_core_1.Rule.object().description('Current shares data of the device')
        });
        this.ports.output['register.command'].push({
            command: 'deviceStop',
            description: 'Stop a running device in the service container (device onStop() + onStopAsync()). Reversible and idempotent - a device that is not running is a no-op.',
            level: 1,
            owner: this.type,
            handler: this.apiDeviceStop.bind(this),
            rules: {
                service: vrack2_core_1.Rule.string().maxLength(120).required().example('test-service').description('Service id'),
                device: vrack2_core_1.Rule.string().maxLength(120).required().example('DeviceID').description('Device id'),
            },
            return: vrack2_core_1.Rule.object().fields({
                device: vrack2_core_1.Rule.string().example('DeviceID').description('Device id'),
                started: vrack2_core_1.Rule.boolean().example(false).description('Whether the device is running (started) after the call'),
            }).description('Device state after the stop')
        });
        this.ports.output['register.command'].push({
            command: 'deviceProcess',
            description: 'Start (process) a device in the service container (device onStart() + onStartAsync()). Idempotent - an already started device is a no-op.',
            level: 1,
            owner: this.type,
            handler: this.apiDeviceProcess.bind(this),
            rules: {
                service: vrack2_core_1.Rule.string().maxLength(120).required().example('test-service').description('Service id'),
                device: vrack2_core_1.Rule.string().maxLength(120).required().example('DeviceID').description('Device id'),
            },
            return: vrack2_core_1.Rule.object().fields({
                device: vrack2_core_1.Rule.string().example('DeviceID').description('Device id'),
                started: vrack2_core_1.Rule.boolean().example(true).description('Whether the device is running (started) after the call'),
            }).description('Device state after the process')
        });
        this.ports.output['register.command'].push({
            command: 'deviceStatus',
            description: 'Read the lifecycle status of a device in the service container (state registered/started/stopped, since timestamp, last alert/error, counters). Read-only - no mutations.',
            level: 1,
            owner: this.type,
            handler: this.apiDeviceStatus.bind(this),
            rules: {
                service: vrack2_core_1.Rule.string().maxLength(120).required().example('test-service').description('Service id'),
                device: vrack2_core_1.Rule.string().maxLength(120).required().example('DeviceID').description('Device id'),
            },
            return: vrack2_core_1.Rule.object().fields({
                device: vrack2_core_1.Rule.string().example('DeviceID').description('Device id'),
                started: vrack2_core_1.Rule.boolean().example(true).description('Whether the device is running (started)'),
                status: vrack2_core_1.Rule.object().fields({
                    id: vrack2_core_1.Rule.string().example('DeviceID').description('Device id'),
                    type: vrack2_core_1.Rule.string().example('vendor.Device').description('Device type'),
                    state: vrack2_core_1.Rule.string().example('started').description("Lifecycle state: 'registered' | 'started' | 'stopped'"),
                    since: vrack2_core_1.Rule.number().example(1700000000000).description('Date.now() of the last status change (ms)'),
                    lastAlert: vrack2_core_1.Rule.any().description('Last alert message (device.alert), or null'),
                    lastError: vrack2_core_1.Rule.any().description('Last error / terminate message, or null'),
                    alertCount: vrack2_core_1.Rule.number().integer().example(0).description('Number of alerts since registration'),
                    errorCount: vrack2_core_1.Rule.number().integer().example(0).description('Number of errors (including terminate) since registration'),
                }).description('Systematized device status record maintained by the container'),
            }).description('Device lifecycle status')
        });
        this.ports.output['register.command'].push({
            command: 'serviceDeviceOutputListen',
            description: 'Capture device output',
            level: 1,
            owner: this.type,
            handler: this.apiServiceDeviceOutputListen.bind(this),
            rules: {
                service: vrack2_core_1.Rule.string().maxLength(120).required().example('test-service').description('Service id'),
                device: vrack2_core_1.Rule.string().maxLength(120).required().example('DeviceID').description('Device id'),
                port: vrack2_core_1.Rule.string().maxLength(120).required().example('portname').description('Input port of device'),
                timeout: vrack2_core_1.Rule.number().integer().min(0).max(20000).default(5000).description('Timeout output listener, ms')
            },
            return: vrack2_core_1.Rule.string().example('any').description('Return a captured data')
        });
        this.ports.output['register.command'].push({
            command: 'serviceCommandsList',
            short: 'Master of service command list',
            description: 'Return all command in service registered',
            level: 1000,
            icon: 'list-ul',
            owner: this.type,
            return: vrack2_core_1.Rule.array().content(vrack2_core_1.Rule.object().fields({
                command: vrack2_core_1.Rule.string().example('commandList').description('Command name/identifier'),
                description: vrack2_core_1.Rule.string().example('Long description').description('Command description'),
                level: vrack2_core_1.Rule.number().example(1000).integer().description('Level for access this command'),
                rules: vrack2_core_1.Rule.array().content(vrack2_core_1.Rule.object().description('Rule Object')).description('Array Rules object for validation data for this command'),
                owner: vrack2_core_1.Rule.string().example('Long description').description('Owner module of this command'),
                short: vrack2_core_1.Rule.string().example('Command list').description('Short description (3-5 words)'),
                icon: vrack2_core_1.Rule.string().example('sd-card').description('Bootstrap icon (without bi- class only end like a "search","sd-card","share" & etc )'),
                return: vrack2_core_1.Rule.object()
                    .example({ type: 'string', required: 'boolean', default: 'any', rules: 'Array of subrules', example: 'any', description: 'string' })
                    .description('Rule object of return type'),
            })).description('Array contain all command for this master'),
            handler: this.apiCommandList.bind(this),
        });
        this.ports.output['register.command'].push({
            command: 'serviceDeviceMetric',
            description: 'Getting a service device metrics',
            level: 3,
            owner: this.type,
            icon: 'graph-up',
            handler: this.apiServiceDeviceMetric.bind(this),
            rules: {
                service: vrack2_core_1.Rule.string().maxLength(120).required().example('test-service').description('Service id'),
                device: vrack2_core_1.Rule.string().maxLength(120).required().example('DeviceID').description('Device id'),
                metric: vrack2_core_1.Rule.string().maxLength(120).required().example('metric.id').description('Device metric path'),
                period: vrack2_core_1.Rule.string().maxLength(120).required().example('now-1h:now').description('VRackDB period'),
                precision: vrack2_core_1.Rule.string().maxLength(60).required().example('30s').description('VRackDB precision'),
                func: vrack2_core_1.Rule.string().default('last').maxLength(10).example('last').description('Read function (last,first,min,max,avg,sum)')
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
            command: 'serviceMetric',
            short: 'Get service metric',
            description: 'Getting a service metrics',
            level: 3,
            owner: this.type,
            icon: 'graph-up',
            handler: this.apiServiceMetric.bind(this),
            rules: {
                service: vrack2_core_1.Rule.string().maxLength(120).required().example('test-service').description('Service id'),
                device: vrack2_core_1.Rule.string().maxLength(120).required().example('DeviceID').description('Device id'),
                metric: vrack2_core_1.Rule.string().maxLength(120).required().example('metric.id').description('Device metric path'),
                period: vrack2_core_1.Rule.string().maxLength(120).required().example('now-1h:now').description('VRackDB period'),
                precision: vrack2_core_1.Rule.string().maxLength(60).required().example('30s').description('VRackDB precision'),
                func: vrack2_core_1.Rule.string().default('last').maxLength(10).example('last').description('Read function (last,first,min,max,avg,sum)')
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
            command: 'serviceParentEvent',
            short: 'Internal Parent Event',
            description: 'Request internal parent event to child service',
            level: 1, // only internal request
            owner: this.type,
            icon: 'calendar-event',
            handler: this.apiServiceParentEvent.bind(this),
            rules: {
                channel: vrack2_core_1.Rule.string()
                    .required()
                    .example('manager.service.test.update')
                    .description('Channel name'),
                data: vrack2_core_1.Rule.any(),
            },
            return: vrack2_core_1.Rule.string()
        });
        /* SEND METRICS */
        this.memTimer = setInterval(() => {
            const mem = process.memoryUsage();
            this.metric('memory.rss', Math.round(mem.rss / 1024 / 1024));
            this.metric('memory.heaptotal', Math.round(mem.heapTotal / 1024 / 1024));
            this.metric('memory.heapused', Math.round(mem.heapUsed / 1024 / 1024));
            this.metric('memory.external', Math.round(mem.external / 1024 / 1024));
            this.metric('memory.arraybuffers', Math.round(mem.arrayBuffers / 1024 / 1024));
        }, 5000);
        process.addListener('uncaughtException', (error) => {
            this.Container.emit('system.error', error);
            this.ServiceContainer.emit('system.error', error);
        });
    }
    onStop() {
        if (this.memTimer)
            clearInterval(this.memTimer);
    }
    /**                 API SERVICE METHODS                 **/
    /**
     * Internal method for starting service
     *
     * @param {Object} data  action data
     * @param {IServiceConfig} data.info ServiceManager internal service info
     * @param {IServiceMeta} data.meta ServiceManager internal serivce meta
    */
    apiServiceStart(data, gData) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                if (this.options.uncaughtTerminate)
                    process.addListener('uncaughtException', this.serviceTerminate.bind(this));
                yield this.apiServiceStartSafe(data, gData);
            }
            catch (error) {
                const CE = vrack2_core_1.ErrorManager.make('SERVICE_CONTAINER_ERROR').add(error);
                this.serviceTerminate(CE);
            }
            return {};
        });
    }
    /**
     * Internal method for starting service
     *
     * @param {Object} data  action data
     * @param {IServiceConfig} data.info ServiceManager internal service info
     * @param {IServiceMeta} data.meta ServiceManager internal serivce meta
    */
    apiServiceCheck(data, gData) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const MainProcessEx = yield this.createMainProcess(data.info, data.meta, false);
                this.bindTerminate();
                this.bindRenderEvent();
                // Ожидаем завершения проверки: иначе асинхронная ошибка check()
                // сработает после отправки ответа "success", и сломанная конфигурация
                // будет ошибочно принята за валидную.
                yield MainProcessEx.check();
                // Ставим в очередь завершение воркера через единственную точку shutdown()
                // (destroyAll boot-классов закроет journal store, если check что-то залогировал)
                setTimeout(() => { this.shutdown(); });
            }
            catch (error) {
                const CE = vrack2_core_1.ErrorManager.make('SERVICE_CONTAINER_ERROR').add(error);
                this.serviceTerminate(CE);
            }
        });
    }
    /**
     * Real service start method
     *
     * @param {Object} data  action data
     * @param {IServiceConfig} data.info ServiceManager internal service info
     * @param {IServiceMeta} data.meta ServiceManager internal serivce meta
    */
    apiServiceStartSafe(data, gData) {
        return __awaiter(this, void 0, void 0, function* () {
            const MainProcessEx = yield this.createMainProcess(data.info, data.meta, true);
            // Сначала «собрать» контейнер: загрузить boot-классы и устройства.
            // ServiceLogger.getBootClass требует, чтобы Bootstrap.loaded уже был заполнен
            // (loadBootList живёт в check()), иначе журнал сервисов молча теряется.
            // run() идемпотентен: повторный check() + runStart() безопасны.
            yield MainProcessEx.check();
            // Пробрасываем контейнер и мета до runStart(),
            // чтобы внешнее устройство (ServiceLogger) успело подписаться на события запуска
            this.ports.output['container'].push({ container: this.ServiceContainer, meta: data.meta });
            this.bindRenderEvent();
            this.bindTerminate();
            MainProcessEx.run();
            this.bindContainerDeviceEvents();
        });
    }
    /**
     * Sends the current shares of all service devices to subscribers
      *
     * @param {Object} data - not used receive params
     */
    apiServiceShares(data, gData) {
        return __awaiter(this, void 0, void 0, function* () {
            for (const deviceId in this.ServiceContainer.devices) {
                this.broadcast(this.makeBroadcastChannel(deviceId, 'render'), this.ServiceContainer.devices[deviceId].shares);
            }
        });
    }
    /**
     * Calling a device action
    */
    apiServiceDeviceAction(data, gData) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.ServiceContainer.deviceAction(data.device, data.action, data.data);
        });
    }
    /**
     * Calling a device port push
    */
    apiServiceDevicePush(data, gData) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.ServiceContainer.devices[data.device])
                throw vrack2_core_1.ErrorManager.make('CONT_DEVICE_NF');
            const device = this.ServiceContainer.devices[data.device];
            if (!device.ports.input[data.port])
                throw vrack2_core_1.ErrorManager.make('CONT_DEVICE_PORT_NF');
            return device.ports.input[data.port].push(data.data);
        });
    }
    /**
     * Get current shares data of a device
    */
    apiServiceDeviceShares(data, gData) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.ServiceContainer.devices[data.device])
                throw vrack2_core_1.ErrorManager.make('CONT_DEVICE_NF');
            return this.ServiceContainer.devices[data.device].shares;
        });
    }
    /**
     * Stop a running device in the service container
     *
     * Delegates to `Container.stopDevice()`: calls device `onStop()`, then
     * `await onStopAsync()`, then marks it stopped. Reversible (can be started
     * again via `deviceProcess`) and idempotent - a device that is not running
     * is a no-op. Throws CONT_DEVICE_NF if the device id is unknown.
     */
    apiDeviceStop(data, gData) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.ServiceContainer.stopDevice(data.device);
            return { device: data.device, started: this.ServiceContainer.isStarted(data.device) };
        });
    }
    /**
     * Start (process) a device in the service container
     *
     * Delegates to `Container.startDevice()`: calls device `onStart()`, then
     * `await onStartAsync()`, then marks it started. Idempotent - an already
     * started device is a no-op. Throws CONT_DEVICE_NF if the device id is unknown.
     */
    apiDeviceProcess(data, gData) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.ServiceContainer.startDevice(data.device);
            return { device: data.device, started: this.ServiceContainer.isStarted(data.device) };
        });
    }
    /**
     * Read the lifecycle status of a device in the service container
     *
     * Delegates to `Container.getDeviceStatus()`: the container-maintained
     * record (state registered/started/stopped, since, last alert/error,
     * counters). Read-only - no mutations. Throws CONT_DEVICE_NF if the
     * device id is unknown.
     */
    apiDeviceStatus(data, gData) {
        return __awaiter(this, void 0, void 0, function* () {
            const status = this.ServiceContainer.getDeviceStatus(data.device);
            if (!status)
                throw vrack2_core_1.ErrorManager.make('CONT_DEVICE_NF', { device: data.device });
            return { device: data.device, started: status.state === 'started', status };
        });
    }
    /**
     * Захват выхода устройства
    */
    apiServiceDeviceOutputListen(data) {
        return new Promise((resolve, reject) => {
            // Проверяем наличие устройства
            if (!this.ServiceContainer.devices[data.device]) {
                reject(vrack2_core_1.ErrorManager.make('CONT_DEVICE_NF'));
                return;
            }
            const device = this.ServiceContainer.devices[data.device];
            // Проверяем наличие порта
            if (!device.ports.output[data.port]) {
                reject(vrack2_core_1.ErrorManager.make('CONT_DEVICE_PORT_NF'));
                return;
            }
            // Создаем новый индекс
            const index = this.getNextCaptureIndex();
            // Назначаем на порт листенер, когда порт попытается пробросить данные
            // они попадут в resovle что в свою очередь приведет его к ответу 
            device.ports.output[data.port].listens.set(index, (result) => {
                clearTimeout(this.capturePull.get(index));
                this.capturePull.delete(index);
                resolve(result);
            });
            /**
             * Если за время ожидания ответа вышел таймаут - отбиваем конкретной ошибкой
             * SERVICE_CAPTURE_PORT_TIMEOUT
            */
            this.capturePull.set(index, setTimeout(() => {
                this.capturePull.delete(index);
                reject(vrack2_core_1.ErrorManager.make('SERVICE_CAPTURE_PORT_TIMEOUT'));
            }, data.timeout));
        });
    }
    /**
     * Get service commands list
     *
    */
    apiCommandList() {
        return __awaiter(this, void 0, void 0, function* () {
            const iReq = {
                providerId: 0,
                providerType: 'Service',
                clientId: 0,
                command: 'commandsList',
                level: 0,
                data: {}
            };
            const ret = yield this.ports.output['master.command'].push(iReq);
            /**
             *  Very important  - EXPORT DATA !!!
             * */
            return JSON.parse(JSON.stringify(ret));
        });
    }
    /**
     * Read device metric from a container
     */
    readDeviceMetric(container, data) {
        if (!container.devices[data.device])
            throw vrack2_core_1.ErrorManager.make('CONT_DEVICE_NF');
        const DM = container.Bootstrap.getBootClass('DeviceMetrics', vrack2_core_1.JournalDbMetrics);
        return DM.read(data.device, data.metric, data.period, data.precision);
    }
    /**
     * Getting device metric
     */
    apiServiceDeviceMetric(data, gData) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.readDeviceMetric(this.ServiceContainer, data);
        });
    }
    /**
     * Getting service metric (worker container, VRack2 level)
     */
    apiServiceMetric(data, gData) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.readDeviceMetric(this.Container, data);
        });
    }
    /**
     * Выполняет внутреннюю передачу события из основного родительского контейнера
     *
    */
    apiServiceParentEvent(data) {
        return __awaiter(this, void 0, void 0, function* () {
            this.ServiceContainer.emit('Service.parent.event', data);
            this.Container.emit('Service.parent.event', data);
        });
    }
    /*                      Helpers                    */
    /**
     * Create the service MainProcess and attach it to the worker
     * (parent container, MainProcess/ServiceContainer/Serviceinfo/ServiceMeta fields).
     * @param start true — full start (confFile + container.meta), false — check only
     */
    createMainProcess(info, meta, start) {
        return __awaiter(this, void 0, void 0, function* () {
            const service = this.normalizeServiceBootstrap(vrack2_core_1.ImportManager.importJSON(info.filePath));
            const MainProcessClass = yield vrack2_core_1.ImportManager.importClass(this.options.mainProcessPath);
            const MainProcessEx = new MainProcessClass(Object.assign({ id: info.id, service }, (start ? { confFile: info.configPath } : {})));
            MainProcessEx.Container.parent = this.Container;
            this.MainProcess = MainProcessEx;
            this.ServiceContainer = MainProcessEx.Container;
            this.Serviceinfo = info;
            this.ServiceMeta = meta;
            if (start)
                this.ServiceContainer.meta = meta;
            return MainProcessEx;
        });
    }
    /**
     * Bind container device terminate event
     */
    bindTerminate() {
        this.ServiceContainer.on('device.terminate', (data) => {
            if (data.trace instanceof vrack2_core_1.CoreError)
                return this.serviceTerminate(data.trace);
            const CE = vrack2_core_1.ErrorManager.make('SERVICE_CONTAINER_TERMINATE', { device: data.device });
            CE.add(data.trace);
            return this.serviceTerminate(CE);
        });
    }
    /**
     * Bind container devices events
     *
     * Listens to device events and sends specialized broadcasts to the service manager
     *
     * @see eventsChannels device events list
    */
    bindContainerDeviceEvents() {
        for (const channel in this.eventsChannels) {
            this.ServiceContainer.on(channel, (data, args) => {
                this.broadcast(this.makeBroadcastChannel(data.device, this.eventsChannels[channel]), { message: data.data, trace: this.makeBroadcastTrace(data.trace), args });
            });
        }
    }
    /**
     * Bind render device event
     *
     * Update render pull
     *
     * @see renderPull
     */
    bindRenderEvent() {
        this.ServiceContainer.on('device.render', (data) => {
            this.renderPull.add(data.device);
            if (!this.renderTimer)
                this.serviceRender();
        });
    }
    /**
     * Send broadcast for device render event
     *
     * @see bindRenderEvent
     */
    serviceRender() {
        if (!this.renderPull.size)
            return;
        this.renderPull.forEach((deviceId) => {
            const device = this.ServiceContainer.devices[deviceId];
            if (device)
                this.broadcast(this.makeBroadcastChannel(deviceId, 'render'), device.shares);
        });
        this.renderPull.clear();
        this.renderTimer = setTimeout(() => {
            this.renderTimer = false;
            this.serviceRender();
        }, this.options.renderDelay);
    }
    /**
     * Convert object to string using util.inspect
    */
    makeBroadcastTrace(trace) {
        switch (typeof trace) {
            case 'bigint':
            case 'function':
                return { trace: trace.toString() };
            case 'string':
            case 'boolean':
            case 'number':
            case 'symbol':
            case 'undefined':
                return { trace };
            case 'object':
                if (trace instanceof Error)
                    return vrack2_core_1.CoreError.objectify(trace);
        }
        return trace;
    }
    /**
     * Make broadcast channel name
     *
     * @param device DeviceID
     * @param target Specific channel of device
    */
    makeBroadcastChannel(device, target) {
        return ['services', this.Serviceinfo.id, 'devices', device, target].join('.');
    }
    /**
     * Send broadcast data to ServiceManager
    */
    broadcast(channel, data) {
        this.ports.output['broadcast'].push({ channel, data });
    }
    /**
     * Graceful stop of the running service container and worker self-exit.
     * Все завершающие процедуры — в единственной точке shutdown() (см. там).
     * Main сбросил conf.autoReload перед командой, поэтому exit не вызовет автоперезапуск.
     */
    apiServiceStop(data, gData) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.shutdown();
        });
    }
    /**
     * Завершение воркера сервиса: уведомить main об ошибке (если есть),
     * остановить сервис (MainProcess.stop() — устройства + boot-классы),
     * остановить воркер-контейнер, process.exit(0).
     * Сюда сходятся все пути: команда stop, device.terminate,
     * uncaughtException, ошибки start/check.
     */
    shutdown(error) {
        return __awaiter(this, void 0, void 0, function* () {
            if (error) {
                this.notifyMainError(error);
            }
            if (this.MainProcess) {
                try {
                    yield this.MainProcess.stop();
                }
                catch (e) {
                    this.notifyMainError(e);
                }
            }
            try {
                yield this.Container.stopAll();
            }
            catch (e) {
                console.error(`[Service] failed to stop worker container:`, e);
            }
            process.exit(0);
        });
    }
    notifyMainError(error) {
        try {
            this.ports.output['send'].push({
                command: 'error',
                threadId: worker_threads_1.threadId,
                error: vrack2_core_1.CoreError.objectify(error)
            });
        }
        catch (e) {
            console.error('Service failed to notify main', error);
        }
    }
    /**
     * Терминальная ошибка сервиса: уведомление + завершение через единственную точку shutdown()
     */
    serviceTerminate(error) {
        return this.shutdown(error);
    }
    getNextCaptureIndex() {
        return this.captureIndex++;
    }
    /**
     * Normalize a service's `bootstrap` entries.
     *
     * `mergeBootList` (vrack2-core) requires every boot entry to carry an
     * `options` object, so a bare `{ "path": "..." }` — the natural way for a
     * service to override our default `DeviceMetrics` — would throw
     * BTSP_BAD_BOOTLIST. Fill `options: {}` where it is missing.
     */
    normalizeServiceBootstrap(service) {
        if (!service || typeof service !== 'object' || !service.bootstrap)
            return service;
        for (const id in service.bootstrap) {
            const entry = service.bootstrap[id];
            if (entry && typeof entry === 'object' && entry.options == null) {
                entry.options = {};
            }
        }
        return service;
    }
}
exports.default = Serivce;

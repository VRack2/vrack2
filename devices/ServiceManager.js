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
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
vrack2_core_1.ErrorManager.register('ServiceManager', 'QNTN63C26KNS', 'SM_SERVICE_NOT_FOUND', 'Service of this id not found', {
    id: vrack2_core_1.Rule.string().example('testid').description('Service ID')
});
vrack2_core_1.ErrorManager.register('ServiceManager', '4BJZAFKFLV4O', 'SM_META_NOT_FOUND', 'Metadata of this id service not found', {
    id: vrack2_core_1.Rule.string().example('testid').description('Service ID')
});
vrack2_core_1.ErrorManager.register('ServiceManager', 'QZLBEXAB4CMF', 'SM_SERVICE_RUNNING', 'Service is already running', {
    id: vrack2_core_1.Rule.string().example('testid').description('Service ID')
});
vrack2_core_1.ErrorManager.register('ServiceManager', 'CLCN1U9I41KR', 'SM_SERVICE_NOT_RUN', 'Service not run', {
    id: vrack2_core_1.Rule.string().example('testid').description('Service ID')
});
vrack2_core_1.ErrorManager.register('ServiceManager', 'CIRBC9815SFP', 'SM_SERVICE_DIR_NOT_FOUND', 'Service dir not found', {
    dir: vrack2_core_1.Rule.string().example('path/to/dir').description('Service dir')
});
vrack2_core_1.ErrorManager.register('ServiceManager', 'D32C9P24SVPQ', 'SM_SUMBASTER_COMMAND_NOT_FOUND', 'Service  submaster command not found', {
    command: vrack2_core_1.Rule.string().example('testCommand').description('Submaster command name')
});
class ServiceManager extends vrack2_core_1.Device {
    constructor() {
        super(...arguments);
        /**
         * Содержит данные конфигурации всех сервисов
        */
        this.servicesList = {};
        /**
         * Содержит метадата сервисов
        */
        this.servicesMeta = {};
        /**
         * Содержит ошибки сервисов
        */
        this.servicesErrors = {};
        /**
         * Содержит воркеры сервисов
        */
        this.servicesWorker = {};
        /**
         * Содержит таймеры перезапуска сервисов
        */
        this.servicesTimer = {};
        /**
         * Мета данные сервиса по умолчанию
        */
        this.defaultMeta = {
            name: 'default name',
            group: 'no group',
            description: 'Default description',
            system: false,
            autoStart: false,
            autoReload: false,
            isolated: false,
        };
        /**
         * Очередь для отслеживание и перегенерации файлов сервисов
         * Файл сорвиса генерируется не сразу а спустя 500мс после сохранения
         * В этой очереди хранятся таймауты перегенерации
         * */
        this.Queue = new Map();
        /**
         * Поля конфигурации сервиса для документации
        */
        this.ServiceRule = vrack2_core_1.Rule.object().fields({
            id: vrack2_core_1.Rule.string().example('test-serivce').description('Service unique ID'),
            errors: vrack2_core_1.Rule.number().example(0).integer().description('Count of service errros'),
            filePath: vrack2_core_1.Rule.string().example('path/to/service/file.json').description('Path to service file'),
            metaPath: vrack2_core_1.Rule.string().example('path/to/meta/file.json').description('Path to meta file'),
            configPath: vrack2_core_1.Rule.string().example('path/to/conf/file.json').description('Path to replace config file'),
            processPath: vrack2_core_1.Rule.string().example('path/to/conf/file.json').description('Path to replace process file'),
            startedAt: vrack2_core_1.Rule.string().example('12312312').description('Service started at'),
            run: vrack2_core_1.Rule.boolean().example(false).description('Runned  flag'),
            autoReload: vrack2_core_1.Rule.boolean().example(false).description('flag for autostart'),
            deleted: vrack2_core_1.Rule.boolean().example(false).description('Deleted flag (deleted but service working now)')
        }).description('Service object information');
    }
    outputs() {
        return {
            'register.command': vrack2_core_1.Port.standart().description('Register command into master'),
            'worker.add': vrack2_core_1.Port.return().description('Run new worker for service'),
            'worker.stop': vrack2_core_1.Port.return().description('Stop service worker '),
            'worker.request': vrack2_core_1.Port.return().description('Send request to worker'),
            'broadcast': vrack2_core_1.Port.standart().description('Send broadcast port'),
        };
    }
    inputs() {
        return {
            'submaster': vrack2_core_1.Port.return().description('Submaster command port')
        };
    }
    checkOptions() {
        return {
            autoStart: vrack2_core_1.Rule.boolean().default(true).required().description('Global control for autostart services at VRack start'),
            autoReload: vrack2_core_1.Rule.boolean().default(true).required().description('Global control for autoReload services if it crached'),
            printErrors: vrack2_core_1.Rule.boolean().default(true).required().description('Print errros if service is crashed'),
            ignoreAutoReloadErrors: vrack2_core_1.Rule.array().default([
                'CTR_CONF_EXTENDS_PROBLEM',
                'CTR_ERROR_INIT_DEVICE',
                'CTR_DEVICE_PROCESS_EXCEPTION',
                'CTR_DEVICE_PROCESS_PROMISE_EXCEPTION',
                'CTR_ERROR_INIT_CONNECTION',
                'CTR_IGNORE_SERVICE_AUTORELOAD'
            ]).required().description('List of errors that the system ignores to restart the service'),
            servicesDirs: vrack2_core_1.Rule.array().default([{ dir: './services', generate: true }]).content(vrack2_core_1.Rule.object().fields({
                dir: vrack2_core_1.Rule.string().required().description('Service dir path'),
                generate: vrack2_core_1.Rule.boolean().default(true).required().description('Global control for generate  service from .js files'),
            })),
        };
    }
    process() {
        this.ports.output['register.command'].push({
            command: 'service',
            short: 'Get service info',
            description: 'Return basic service information (see IServiceConfig)',
            level: 3,
            owner: this.type,
            icon: 'person-workspace',
            handler: this.apiService.bind(this),
            rules: {
                'service': vrack2_core_1.Rule.string().maxLength(200).required().example('servid').description('Service unique id')
            },
            return: this.ServiceRule
        });
        this.ports.output['register.command'].push({
            command: 'serviceMeta',
            short: 'Get service meta',
            description: 'Return service meta information (see IServiceMeta)',
            level: 3,
            owner: this.type,
            icon: 'person-vcard-fill',
            handler: this.apiServiceMeta.bind(this),
            rules: { 'service': vrack2_core_1.Rule.string().maxLength(200).required().example('servid').description('Service unique id') },
            return: vrack2_core_1.Rule.object().fields({
                name: vrack2_core_1.Rule.string().example('Lang name').description('Human service name'),
                group: vrack2_core_1.Rule.string().example('Group name').description('Service group ()'),
                description: vrack2_core_1.Rule.string().example('Long description').description('Service description in markdown style'),
                system: vrack2_core_1.Rule.boolean().example(false).description('If the service is marked as system, it cannot be turned off.'),
                autoStart: vrack2_core_1.Rule.boolean().example(false).description('Run service on startup VRack'),
                autoReload: vrack2_core_1.Rule.boolean().example(false).description('Auto reload service if him crashed'),
            }).description('Service meta information')
        });
        this.ports.output['register.command'].push({
            command: 'serviceList',
            short: 'Get service list',
            description: 'Return list of all services',
            level: 3,
            owner: this.type,
            icon: 'list-stars',
            handler: this.apiServiceList.bind(this),
            return: vrack2_core_1.Rule.array().content(this.ServiceRule)
                .description('List array of services configs')
        });
        this.ports.output['register.command'].push({
            command: 'serviceUpdateList',
            short: 'Update service list',
            description: 'Return list of all services',
            level: 3,
            owner: this.type,
            icon: 'arrow-repeat',
            handler: this.apiServiceListUpdate.bind(this),
            return: vrack2_core_1.Rule.object().fields({ serviceID: this.ServiceRule })
                .description('List array of services configs')
        });
        this.ports.output['register.command'].push({
            command: 'serviceStart',
            short: 'Service start',
            description: 'Start service',
            level: 1,
            owner: this.type,
            icon: 'play-circle-fill',
            handler: this.apiServiceStart.bind(this),
            rules: { 'service': vrack2_core_1.Rule.string().maxLength(200).required().example('servid').description('Service unique id') },
            return: this.ServiceRule
        });
        this.ports.output['register.command'].push({
            command: 'serviceStop',
            short: 'Service stop',
            description: 'Stop service',
            level: 1,
            owner: this.type,
            icon: 'stop-circle-fill',
            handler: this.apiServiceStop.bind(this),
            rules: { 'service': vrack2_core_1.Rule.string().maxLength(200).required().example('servid').description('Service unique id') },
            return: this.ServiceRule
        });
        this.ports.output['register.command'].push({
            command: 'serviceCheck',
            short: 'Service check',
            description: 'Check service',
            level: 1,
            owner: this.type,
            icon: 'check-circle-fill',
            handler: this.apiServiceCheck.bind(this),
            rules: { 'service': vrack2_core_1.Rule.string().maxLength(200).required().example('servid').description('Service unique id') },
            return: vrack2_core_1.Rule.object().description('Empty object')
        });
        this.ports.output['register.command'].push({
            command: 'serviceErrors',
            short: 'Get service errors',
            description: 'Errors service',
            level: 1,
            owner: this.type,
            icon: 'sign-stop-fill',
            handler: this.apiServiceErrors.bind(this),
            rules: { 'service': vrack2_core_1.Rule.string().maxLength(200).required().example('servid').description('Service unique id') },
            return: vrack2_core_1.Rule.array().content(vrack2_core_1.Rule.object().description('Error object')).description('Array of errors')
        });
        this.ports.output['register.command'].push({
            command: 'serviceErrorsClear',
            short: 'Clear errors',
            description: 'Clear service errors',
            level: 1,
            owner: this.type,
            icon: 'trash-fill',
            handler: this.apiServiceErrorsClear.bind(this),
            rules: { 'service': vrack2_core_1.Rule.string().maxLength(200).required().example('servid').description('Service unique id') },
            return: vrack2_core_1.Rule.object().example({}).description('Empty object')
        });
    }
    processPromise() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.apiServiceListUpdate(); // Обновляем список сервисов 
            this.servicesWatch(); // Начинаем отслеживание сервисных директорий
            if (this.options.autoStart)
                this.servicesStart(); // Запуск сервисов который должны быть запущены со старта
        });
    }
    /**
     * Return a general service info
     *
     * @see IServiceConfig
    */
    apiService(data) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.getService(data.service);
        });
    }
    /**
     * Return service meta info
     *
     * @see IServiceMeta
    */
    apiServiceMeta(data) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.getMeta(data.service);
        });
    }
    /**
     * Return a service list
     *
     * like a
     * ```ts
     * {
     *    "serviceId": {
     *      service data with service metadata
     *    }
     * }
     * ```
     * @see IServiceConfig
     * @see IServiceMeta
    */
    apiServiceList() {
        return __awaiter(this, void 0, void 0, function* () {
            return this.exportServiceList();
        });
    }
    /**
     * Start service command
     *
     * @param data.service service ID
    */
    apiServiceStart(data) {
        return __awaiter(this, void 0, void 0, function* () {
            const conf = this.getService(data.service);
            if (conf.run)
                throw vrack2_core_1.ErrorManager.make('SM_SERVICE_RUNNING');
            // Сбрасываем флаг автоматического запуска
            conf.autoReload = false;
            // Запуск воркера
            this.servicesWorker[data.service] = yield this.ports.output['worker.add'].push({
                // Является ли данный сервис изолированным
                isolated: this.servicesMeta[conf.id].isolated,
                // Данные workerData которые будут переданы в новый процесс
                data: this.serviceWorkerData(conf, 'worker'),
                onError: (error) => {
                    // При ошибке проверяяем - можно ли перезапускать сервис
                    if (this.servicesMeta[conf.id].autoReload && this.options.autoReload)
                        conf.autoReload = true;
                    // Нужно проверить - какая была ошибка, если ошибка входит в список игнорируемых
                    // То мы не разрешаем перезапуск сервиса Например при инициализации устройства
                    // error у нас всегда WM_INTERNAL_ERROR 
                    const cError = error;
                    // Нам нужна ошибка пониже
                    if (cError.vAddErrors.length && vrack2_core_1.ErrorManager.isError(cError.vAddErrors[0])) {
                        // Для удобства сделаем ссылку на нее
                        const iError = cError.vAddErrors[0];
                        // Если в списке игнорируемых ошибок есть наша ошибка - отключаем авторелоад
                        if (this.options.ignoreAutoReloadErrors.indexOf(iError.vShort) !== -1)
                            conf.autoReload = false;
                    }
                    // Сообщяем об ошибке
                    this.Container.emit('service.error', conf.id, error);
                    // Добавляем ошибку 
                    this.addError(conf.id, error);
                },
                onExit: () => {
                    // Удаляем активный вокрер
                    delete this.servicesWorker[data.service];
                    // Говорим что сервис более не запущен
                    conf.run = false;
                    this.broadcastUpdate([conf.id]); // Отправка всем изменений
                    // Если релоад отключен или таймер стоит по какой то причине уже то return
                    if (!conf.autoReload || this.servicesTimer[conf.id] !== undefined)
                        return;
                    // Если 
                    this.servicesTimer[conf.id] = setTimeout(() => {
                        this.servicesTimer[conf.id] = undefined;
                        // Какой смысл это делать в try catch без await
                        try {
                            if (conf.run)
                                return;
                            this.apiServiceStart(data);
                        }
                        catch (err) {
                            return;
                        }
                    }, 5000);
                }
            });
            const iReq = {
                providerId: 0,
                providerType: 'ServiceManager',
                clientId: 0,
                command: 'serviceStart',
                level: 0,
                data: {
                    service: conf.id,
                    meta: this.servicesMeta[conf.id],
                    info: conf
                }
            };
            yield this.inputSubmaster(iReq);
            conf.run = true;
            conf.startedAt = Date.now();
            this.broadcastUpdate([conf.id]);
            return conf;
        });
    }
    /**
     * Stop service command
     *
     * @param data.service service ID
    */
    apiServiceStop(data) {
        return __awaiter(this, void 0, void 0, function* () {
            const conf = this.getService(data.service);
            if (this.servicesTimer[conf.id] !== undefined && !conf.run) {
                this.servicesTimer[conf.id] = undefined;
                clearTimeout(this.servicesTimer[conf.id]);
                return conf;
            }
            if (!conf.run)
                throw vrack2_core_1.ErrorManager.make('SM_SERVICE_NOT_RUN');
            try {
                yield this.ports.output['worker.stop'].push({ id: this.servicesWorker[conf.id] });
                return conf;
            }
            catch (error) {
                this.broadcastUpdate([conf.id]);
                if (error instanceof vrack2_core_1.CoreError && error.vShort === 'WM_WORKER_EXIT')
                    return 'success';
                throw error;
            }
        });
    }
    /***
     * Проверка сервиса
     *
     * Запускает контейнер процесса
     *
     *
     * В случае возникновения ошибки при проверке - ошибка попадет в список ошибок сервиса.
     * Событие контейнера генерироваться не будет.
     *
     * @param data.service serviceID
     * **/
    apiServiceCheck(data) {
        return __awaiter(this, void 0, void 0, function* () {
            const conf = this.getService(data.service);
            const wid = yield this.ports.output['worker.add'].push({
                data: this.serviceWorkerData(conf, 'check'),
                onError: (error) => {
                    // При проверке отправка события об ошибке не производится
                    this.addError(conf.id, error);
                },
                onExit: () => { return; }
            });
            const iReq = {
                providerId: 0,
                level: 0,
                clientId: 0,
                providerType: 'ServiceManager',
                command: 'serviceCheck',
                data: {
                    service: conf.id,
                    meta: this.servicesMeta[conf.id],
                    info: conf
                }
            };
            yield this.ports.output['worker.request'].push({ id: wid, data: iReq });
            return {};
        });
    }
    /**
     * Return a service errors list
     *
     * @param data.service service ID
    */
    apiServiceErrors(data) {
        return __awaiter(this, void 0, void 0, function* () {
            this.getService(data.service);
            const ret = [];
            if (this.servicesErrors[data.service]) {
                for (const er of this.servicesErrors[data.service]) {
                    for (const rer of er.vAddErrors)
                        ret.push(rer);
                }
            }
            return ret;
        });
    }
    /**
     * Delete all service errors
     *
     * @param data.service service ID
    */
    apiServiceErrorsClear(data) {
        return __awaiter(this, void 0, void 0, function* () {
            this.getService(data.service);
            this.servicesErrors[data.service] = [];
            this.servicesList[data.service].errors = 0;
            this.broadcastUpdate([data.service]);
            return {};
        });
    }
    /**
     * Update service list
     *
     * return service list
     * @see apiServiceList
    */
    apiServiceListUpdate() {
        return __awaiter(this, void 0, void 0, function* () {
            for (const dirConf of this.options.servicesDirs) {
                const dir = path_1.default.join(dirConf.dir);
                this.updateServicesDir(dir);
            }
            for (const key in this.servicesList) {
                if (fs_1.default.existsSync(this.servicesList[key].filePath))
                    continue;
                if (this.servicesList[key].run)
                    this.servicesList[key].deleted = true;
                else
                    delete this.servicesList[key];
            }
            return this.exportServiceList();
        });
    }
    /******      INPUT HANDLERS      *******/
    /**
     * Processes messages from the master
     *
     * Attempts to execute a command within the specified service.
    */
    inputSubmaster(data) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!data.data || !data.data.service)
                throw vrack2_core_1.ErrorManager.make('SM_SUMBASTER_COMMAND_NOT_FOUND');
            if (!this.servicesList[data.data.service])
                throw vrack2_core_1.ErrorManager.make('SM_SERVICE_NOT_FOUND', { id: data.data.service });
            if (!this.servicesWorker[data.data.service])
                throw vrack2_core_1.ErrorManager.make('SM_SERVICE_NOT_RUN', { id: data.data.service });
            return yield this.ports.output['worker.request'].push({ id: this.servicesWorker[data.data.service], data });
        });
    }
    /**
     * Monitors service files.
     * If changes are made to JS files, it generates new service files.
    */
    servicesWatch() {
        // Начинаем перебор сервисных директорий
        for (const dirConf of this.options.servicesDirs) {
            if (!dirConf.generate)
                continue; // Если генерация для директории отключена
            fs_1.default.watch(path_1.default.join(dirConf.dir), { encoding: 'utf8' }, (eventType, filename) => {
                if (!filename)
                    return;
                if (eventType !== 'change')
                    return;
                const res = filename.split('.');
                if (res.length !== 2)
                    return;
                if (res[1] !== 'js')
                    return; // Проверяем расширение
                // Если у нас уже есть в очереди этот файл - 
                if (this.Queue.has(filename))
                    clearTimeout(this.Queue.get(filename));
                this.Queue.set(filename, setTimeout(() => __awaiter(this, void 0, void 0, function* () {
                    try {
                        // Генерация 
                        yield this.convert(dirConf.dir, res[0], res[1], filename);
                    }
                    catch (error) {
                        // Печатаем ошибку для debug/syslog
                        console.error(error);
                        // Добавляем к сервису ошибку
                        // Мы предпологаем что первая часть файла у нас - идентификатор сервиса
                        // Добавляем его к списку ошибок сервиса
                        this.addError(res[0], error);
                        if (error instanceof Error)
                            this.error('Error generate service file', error);
                    }
                }), 500));
            });
        }
    }
    /**
     *  Regenerate new service file
     *
     * @see servicesWatch()
     */
    convert(dir, service, ext, filename) {
        return __awaiter(this, void 0, void 0, function* () {
            delete require.cache[path_1.default.join(vrack2_core_1.ImportManager.systemPath(), dir, filename)];
            const result = yield vrack2_core_1.ImportManager.importPath(path_1.default.join(vrack2_core_1.ImportManager.systemPath(), dir, filename));
            if (result && typeof result === 'object') {
                fs_1.default.writeFileSync(path_1.default.join(vrack2_core_1.ImportManager.systemPath(), dir, service + '.json'), JSON.stringify(result.default, null, '\t'));
            }
        });
    }
    /**
     * Starting services when vrack start
    */
    servicesStart() {
        return __awaiter(this, void 0, void 0, function* () {
            for (const service in this.servicesMeta) {
                try {
                    if (this.servicesMeta[service].autoStart)
                        yield this.apiServiceStart({ service });
                }
                catch (er) {
                    this.addError(service, er);
                }
            }
        });
    }
    /**
     * Отправляет информацию об обновлении конкретных сервисов
    */
    broadcastUpdate(ids) {
        for (const id of ids) {
            this.ports.output['broadcast'].push({
                command: 'broadcast',
                channel: 'manager.service.' + id + '.update',
                data: this.servicesList[id]
            });
        }
    }
    /**
     * Формирует данные для воркера, такие как:
     *
     *  - Путь до файла процесса
     *  - Идентификатор контейнера
     *  - Определение класса MainProcess
     *
    */
    serviceWorkerData(conf, type) {
        let processFile = path_1.default.join(path_1.default.dirname(__dirname), 'process.json');
        let confFile = path_1.default.join(path_1.default.dirname(__dirname), 'process.conf.json');
        // Если существует сервис файл - заменяем им основной файл процесса
        if (conf.processPath && fs_1.default.existsSync(conf.processPath)) {
            processFile = conf.processPath; // Определяем новый процесс файл
            confFile = ''; // Отключаем дополнение файла
        }
        return {
            processFile,
            confFile,
            MainProcess: 'vrack2-core.MainProcess',
            contaierId: type + '::' + conf.id
        };
    }
    /**
     * Return service information
     *
     * @param service Service ID
    */
    getService(service) {
        if (!this.servicesList[service])
            throw vrack2_core_1.ErrorManager.make('SM_SERVICE_NOT_FOUND', { id: service });
        return this.servicesList[service];
    }
    /**
     * Return service metadata information
     *
     * @param service Service ID
    */
    getMeta(service) {
        this.getService(service);
        if (this.servicesMeta[service])
            return this.servicesMeta[service];
        throw vrack2_core_1.ErrorManager.make('SM_META_NOT_FOUND');
    }
    /**
     * Export service list with meta data
     *
     * @see apiServiceList
     * @see apiServiceListUpdate
    */
    exportServiceList() {
        const ret = {};
        for (const id in this.servicesList) {
            ret[id] = this.exportService(id);
        }
        return ret;
    }
    /**
     * Export one service with metadata
     **/
    exportService(id) {
        const sl = Object.assign({}, this.servicesList[id]);
        Object.assign(sl, this.servicesMeta[id]);
        return sl;
    }
    /**
     * Add error for service
     */
    addError(service, error) {
        if (this.options.printErrors)
            console.error(error);
        if (this.servicesList[service].errors > 5)
            return;
        if (!this.servicesErrors[service])
            this.servicesErrors[service] = [];
        this.servicesErrors[service].unshift(error);
        this.servicesList[service].errors++;
        this.broadcastUpdate([service]);
    }
    /**
     * Try read metadata file
     *
     * @param p Path to metadata file
    */
    readServiceMeta(p) {
        if (!vrack2_core_1.ImportManager.isFile(p))
            return Object.assign({}, this.defaultMeta);
        try {
            return Object.assign({}, this.defaultMeta, vrack2_core_1.ImportManager.importJSON(p));
        }
        catch (err) {
            return Object.assign({}, this.defaultMeta);
        }
    }
    /**
     * Searches all files and updates the list of available services in the directory
     *
     * @param dir Path to services dir
    */
    updateServicesDir(dir) {
        if (!fs_1.default.existsSync(dir))
            throw vrack2_core_1.ErrorManager.make('SM_SERVICE_DIR_NOT_FOUND', { dir });
        const fileList = vrack2_core_1.ImportManager.fileList(dir);
        for (const filename of fileList) {
            const expl = filename.split('.');
            if (expl.length !== 2 || expl[1] !== 'json')
                continue;
            const id = expl[0];
            const metaPath = path_1.default.join(dir, id + '.meta.json');
            this.servicesMeta[id] = this.readServiceMeta(metaPath);
            if (this.servicesList[id]) {
                this.servicesList[id].deleted = false;
                continue;
            }
            this.servicesList[id] = {
                id, errors: 0, run: false, deleted: false,
                filePath: path_1.default.join(dir, filename),
                metaPath: path_1.default.join(dir, id + '.meta.json'),
                configPath: path_1.default.join(dir, id + '.conf.json'),
                processPath: path_1.default.join(dir, id + '.process.json'),
            };
        }
    }
}
exports.default = ServiceManager;

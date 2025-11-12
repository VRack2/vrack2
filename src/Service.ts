import { Bootstrap, Container, CoreError, Device, DeviceMetrics, ErrorManager, ImportManager, MainProcess, Port, Rule, Metric, BasicMetric } from "vrack2-core";

import BasicPort from "vrack2-core/lib/ports/BasicPort";
import BasicType from "vrack2-core/lib/validator/types/BasicType";

import { workerData, threadId } from "worker_threads"

import IGuardMessage from "./interfaces/IGuardMessage";
import IServiceConfig from './interfaces/IServiceConfig';
import IServiceMeta from "./interfaces/IServiceMeta";
import IServiceStructure from "vrack2-core/lib/IServiceStructure";
import IDeviceActionRequest from "./interfaces/IDeviceActionRequest";

import IDeviceMetricRequest from "./interfaces/IDeviceMetricRequest";
import IDevicePushRequest from "./interfaces/IDevicePushRequest";
import { ICommandExport } from "./Master";


ErrorManager.register('Service', 'UYWBAXO4GEB1', 'SERVICE_CONTAINER_ERROR', 'An error occurred while loading the container. The reason may be - an incorrect scheme or an error initializing the device. This is a general container loading error, see the nested error inside this')
ErrorManager.register('Service', 'OFPCDVLAH535', 'SERVICE_CONTAINER_TERMINATE', 'The error occurred because some device called the termination method. See the nested error inside this', {
    device: Rule.string().default('').description('Device ID')
})
ErrorManager.register('Service', 'OVD06P5ZF9RV', 'SERVICE_CAPTURE_PORT_TIMEOUT', 'Timeout occurred while waiting for device output capture')
export default class Serivce extends Device {

    outputs(): { [key: string]: BasicPort; } {
        return {
            send: Port.standart().description('Send data to parent process'),
            broadcast: Port.standart().description('Send broadcast to client'),
            'master.command': Port.return().description('Run master command'),
            'register.command': Port.standart().description('Register command into master'),
        }
    }

    inputs(): { [key: string]: BasicPort; } {
        return {}
    }

    checkOptions(): { [key: string]: BasicType; } {
        return {
            'mainProcessPath': Rule.string().require().default('vrack2-core.MainProcess').description('Main process class path'),
            'renderDelay': Rule.number().integer().min(10).max(3000).default(200).description('Minimal render delay for render shares'),
            'uncaughtTerminate': Rule.boolean().default(true).description('Terminate service if call uncaught exception'),
        }
    }

    metrics(): { [key: string]: BasicMetric; } {
        return {
            'memory.rss': Metric.inS().retentions('5s:30m, 15s:2h, 1m:1d, 1h:1w, 6h:1mon, 1d:1y').description('System memory rss'),
            'memory.heaptotal': Metric.inS().retentions('5s:30m, 15s:2h, 1m:1d, 1h:1w, 6h:1mon, 1d:1y').description('System memory heapTotal'),
            'memory.heapused': Metric.inS().retentions('5s:30m, 15s:2h, 1m:1d, 1h:1w, 6h:1mon, 1d:1y').description('System memory heapUsed'),
            'memory.external': Metric.inS().retentions('5s:30m, 15s:2h, 1m:1d, 1h:1w, 6h:1mon, 1d:1y').description('System memory external'),
            'memory.arraybuffers': Metric.inS().retentions('5s:30m, 15s:2h, 1m:1d, 1h:1w, 6h:1mon, 1d:1y').description('System memory arrayBuffers'),
        }
    }


    /**
     * Devices events list
    */
    eventsChannels: { [key: string]: string } = {
        'device.error': 'error',
        'device.notify': 'notify',
        'device.alert': 'alert',
        'device.terminal': 'terminal',
        'device.event': 'event'
    }

    MainProcess?: MainProcess;

    /**
     * Service container
    */
    ServiceContainer: Container = new Container('', {} as IServiceStructure, {} as Bootstrap);

    /**
     * Service info (getting from service manager)
    */
    Serviceinfo: IServiceConfig = {
        id: '', errors: 0,
        filePath: '',
        metaPath: '',
        configPath: '',
        processPath: '',
        run: false, deleted: false,
    }

    /**
     * Service meta (getting from service manager)
    */
    ServiceMeta: IServiceMeta = {
        name: '', group: '', description: '',
        system: false, autoStart: false, autoReload: false
    }


    /***
     * Render pull for service shares data
    */
    renderPull = new Set<string>()

    /**
     * Render data for send to service manager
    */
    renderData = new Map<string, any>()

    /**
     * Render timer 
    */
    renderTimer: boolean | NodeJS.Timeout = false;

    /**
     * Индекс для захвата порта устройства
    */
    captureIndex = 1000

    /**
     * Пулл для хранения таймаутов захвата порта устройства
    */
    capturePull = new Map()

    process(): void {
        // // Bind loaded method for send signal to service manager
        // this.Container.on('loaded', this.loaded.bind(this))

        // Register api commands
        this.ports.output['register.command'].push({
            command: 'serviceStart',
            description: 'Internal service command for starting container',
            level: 0,
            owner: this.type,
            handler: this.apiServiceStart.bind(this),
            rules: {
                service: Rule.string().maxLength(120).require().example('test-service').description('Service id'),
            },
        })

        this.ports.output['register.command'].push({
            command: 'serviceCheck',
            description: 'Internal service command for check container',
            level: 0,
            owner: this.type,
            handler: this.apiServiceCheck.bind(this),
            rules: {
                service: Rule.string().maxLength(120).require().example('test-service').description('Service id'),
            },
        })


        this.ports.output['register.command'].push({
            command: 'serviceShares',
            description: 'Queues all data to be sent',
            level: 3,
            owner: this.type,
            handler: this.apiServiceShares.bind(this),
            rules: {
                service: Rule.string().maxLength(120).require().example('test-service').description('Service id'),
            },
        })

        this.ports.output['register.command'].push({
            command: 'serviceDeviceAction',
            description: 'Calling a device action',
            level: 2,
            owner: this.type,
            handler: this.apiServiceDeviceAction.bind(this),
            rules: {
                service: Rule.string().maxLength(120).require().example('test-service').description('Service id'),
                device: Rule.string().maxLength(120).require().example('DeviceID').description('Device id'),
                action: Rule.string().maxLength(120).require().example('action.name').description('Action name (dot style!)'),
                data: Rule.object().require().example({}).description('Data for push into action')
            },
        })

        this.ports.output['register.command'].push({
            command: 'serviceDevicePush',
            description: 'Calling a device port.push',
            level: 1,
            owner: this.type,
            handler: this.apiServiceDevicePush.bind(this),
            rules: {
                service: Rule.string().maxLength(120).require().example('test-service').description('Service id'),
                device: Rule.string().maxLength(120).require().example('DeviceID').description('Device id'),
                port: Rule.string().maxLength(120).require().example('portname').description('Input port of device'),
                data: Rule.object().require().example(1).description('Data for push into port')
            },
        })

        this.ports.output['register.command'].push({
            command: 'serviceDeviceOutputListen',
            description: 'Capture device output',
            level: 1,
            owner: this.type,
            handler: this.apiServiceDeviceOutputListen.bind(this),
            rules: {
                service: Rule.string().maxLength(120).require().example('test-service').description('Service id'),
                device: Rule.string().maxLength(120).require().example('DeviceID').description('Device id'),
                port: Rule.string().maxLength(120).require().example('portname').description('Input port of device'),
                timeout: Rule.number().integer().min(0).max(20000).description('Timeout output listener')
            },
            return: Rule.string().example('any').description('Return a captured data')
        })

        this.ports.output['register.command'].push({
            command: 'serviceCommandsList',
            short: 'Master of service command list',
            description: 'Return all command in service registered',
            level: 1000,
            icon:'list-ul',
            owner: this.type,
            return: Rule.array().content(Rule.object().fields({
              command: Rule.string().example('commandList').description('Command name/identifier'),
              description: Rule.string().example('Long description').description('Command description'),
              level: Rule.number().example(1000).integer().description('Level for access this command'),
              rules: Rule.array().content(Rule.object().description('Rule Object')).description('Array Rules object for validation data for this command'),
              owner: Rule.string().example('Long description').description('Owner module of this command'),
              short: Rule.string().example('Command list').description('Short description (3-5 words)'),
              icon: Rule.string().example('sd-card').description('Bootstrap icon (without bi- class only end like a "search","sd-card","share" & etc )'),
              return: Rule.object()
                .example({ type: 'string', require: 'boolean', default: 'any', rules: 'Array of subrules', example:'any', description:'string' })
                .description('Rule object of return type'),
            })).description('Array contain all command for this master'),
            handler: this.apiCommandList.bind(this),
        })


        this.ports.output['register.command'].push({
            command: 'serviceDeviceMetric',
            description: 'Getting a service device metrics',
            level: 3,
            owner: this.type,
            icon: 'graph-up',
            handler: this.apiServiceDeviceMetric.bind(this),
            rules: {
                service: Rule.string().maxLength(120).require().example('test-service').description('Service id'),
                device: Rule.string().maxLength(120).require().example('DeviceID').description('Device id'),
                metric: Rule.string().maxLength(120).require().example('metric.id').description('Device metric path'),
                period: Rule.string().maxLength(120).require().example('now-1h:now').description('VRackDB period'),
                precision: Rule.string().maxLength(60).require().example('30s').description('VRackDB precision'),
                func: Rule.string().default('last').maxLength(10).example('last').description('Read function (last,first,min,max,avg,sum)')
            },
            return: Rule.object().fields({
                relevant: Rule.boolean().default(false).example(false).description('result relevance flag'),
                start: Rule.number().integer().example(1).description('Beginning of the period'),
                end: Rule.number().integer().example(100).description('End of period '),
                rows: Rule.array().content(
                    Rule.object().fields({
                        time: Rule.number().integer().example(10).description('Time in MTU'),
                        value: Rule.number().example(12.3223).description('Metric value || null')
                    }).description('Metric storage object')
                ).description('Array of metrics')
            }).description('Metric request result - see vrack-db read documentation')
        })


        this.ports.output['register.command'].push({
            command: 'serviceMetric',
            short: 'Get service metric',
            description: 'Getting a service metrics',
            level: 3,
            owner: this.type,
            icon: 'graph-up',
            handler: this.apiServiceMetric.bind(this),
            rules: {
                service: Rule.string().maxLength(120).require().example('test-service').description('Service id'),
                device: Rule.string().maxLength(120).require().example('DeviceID').description('Device id'),
                metric: Rule.string().maxLength(120).require().example('metric.id').description('Device metric path'),
                period: Rule.string().maxLength(120).require().example('now-1h:now').description('VRackDB period'),
                precision: Rule.string().maxLength(60).require().example('30s').description('VRackDB precision'),
                func: Rule.string().default('last').maxLength(10).example('last').description('Read function (last,first,min,max,avg,sum)')
            },
            return: Rule.object().fields({
                relevant: Rule.boolean().default(false).example(false).description('result relevance flag'),
                start: Rule.number().integer().example(1).description('Beginning of the period'),
                end: Rule.number().integer().example(100).description('End of period '),
                rows: Rule.array().content(
                    Rule.object().fields({
                        time: Rule.number().integer().example(10).description('Time in MTU'),
                        value: Rule.number().example(12.3223).description('Metric value || null')
                    }).description('Metric storage object')
                ).description('Array of metrics')
            }).description('Metric request result - see vrack-db read documentation')
        })

        /* SEND METRICS */
        setInterval(() => {
            const mem = process.memoryUsage()
            this.metric('memory.rss', Math.round(mem.rss / 1024 / 1024))
            this.metric('memory.heaptotal', Math.round(mem.heapTotal / 1024 / 1024))
            this.metric('memory.heapused', Math.round(mem.heapUsed / 1024 / 1024))
            this.metric('memory.external', Math.round(mem.external / 1024 / 1024))
            this.metric('memory.arraybuffers', Math.round(mem.arrayBuffers / 1024 / 1024))
        }, 5000)

        process.addListener('uncaughtException', (error) => {
            this.Container.emit('system.error', error)
        })
    }

    /**                 API SERVICE METHODS                 **/

    /**
     * Internal method for starting service
     * 
     * @param {Object} data  action data
     * @param {IServiceConfig} data.info ServiceManager internal service info
     * @param {IServiceMeta} data.meta ServiceManager internal serivce meta
    */
    async apiServiceStart(data: { info: IServiceConfig, meta: IServiceMeta }, gData: IGuardMessage) {
        try {
            if (this.options.uncaughtTerminate ) process.addListener('uncaughtException',this.serviceTerminate.bind(this))
            await this.apiServiceStartSafe(data, gData)
        } catch (error) {
            const CE = ErrorManager.make('SERVICE_CONTAINER_ERROR').add(error as Error)
            this.serviceTerminate(CE)
        }
        return {}
    }

    /**
     * Internal method for starting service
     * 
     * @param {Object} data  action data
     * @param {IServiceConfig} data.info ServiceManager internal service info
     * @param {IServiceMeta} data.meta ServiceManager internal serivce meta
    */
    async apiServiceCheck(data: { info: IServiceConfig, meta: IServiceMeta }, gData: IGuardMessage) {
        try {
            const service = ImportManager.importJSON(data.info.filePath)
            const MainProcessClass = await ImportManager.importClass(this.options.mainProcessPath) as typeof MainProcess
            const MainProcessEx = new MainProcessClass({ id: data.info.id, service })
            MainProcessEx.Container.parent = this.Container
            this.ServiceContainer = MainProcessEx.Container
            this.Serviceinfo = data.info
            this.ServiceMeta = data.meta
            await this.bindTerminate()
            await this.bindRenderEvent()
            MainProcessEx.check()
            // Ставим в очередь завершение процесса
            setTimeout(()=>{ process.exit() })
        } catch (error) {
            const CE = ErrorManager.make('SERVICE_CONTAINER_ERROR').add(error as Error)
            this.serviceTerminate(CE)
        }
    }

    /**
     * Real service start method
     * 
     * @param {Object} data  action data
     * @param {IServiceConfig} data.info ServiceManager internal service info
     * @param {IServiceMeta} data.meta ServiceManager internal serivce meta
    */
    async apiServiceStartSafe(data: { info: IServiceConfig, meta: IServiceMeta }, gData: IGuardMessage) {
        const service = await ImportManager.importJSON(data.info.filePath)
        const MainProcessClass = await ImportManager.importClass(this.options.mainProcessPath) as typeof MainProcess
        const MainProcessEx = new MainProcessClass({ id: data.info.id, service, confFile: data.info.configPath })
        MainProcessEx.Container.parent = this.Container
        this.ServiceContainer = MainProcessEx.Container
        this.ServiceContainer.meta = data.meta
        this.Serviceinfo = data.info
        this.ServiceMeta = data.meta
        await this.bindRenderEvent()
        await this.bindTerminate()
        MainProcessEx.run()
        await this.bindContainerDeviceEvents()
    }

    /**
     * Queues all shares data to be sent
     * 
     * @param {Object} data - not used receive params
    */
    async apiServiceShares(data: { service: string }, gData: IGuardMessage) {
        this.renderData.forEach((value, key) => { this.renderPull.add(key) })
        if (this.renderTimer && typeof this.renderTimer !== 'boolean') clearTimeout(this.renderTimer)
        this.serviceRender()
    }

    /**
     * Calling a device action
    */
    async apiServiceDeviceAction(data: IDeviceActionRequest, gData: IGuardMessage) {
        return await this.ServiceContainer.deviceAction(data.device, data.action, data.data)
    }

    /**
     * Calling a device port push
    */
    async apiServiceDevicePush(data: IDevicePushRequest, gData: IGuardMessage) {
        if (!this.ServiceContainer.devices[data.device]) throw ErrorManager.make('CTR_DEVICE_NF')
        const device = this.ServiceContainer.devices[data.device]
        if (!device.ports.input[data.port]) throw ErrorManager.make('CTR_DEVICE_PORT_NF')    
        return device.ports.input[data.port].push(data.data)
    }

    /**
     * Захват выхода устройства
    */
    apiServiceDeviceOutputListen (data: { service: string, device: string, port: string, timeout: number }) {
        return new Promise((resolve, reject) => {
            // Проверяем наличие устройства
            if (!this.ServiceContainer.devices[data.device]) { 
                reject( ErrorManager.make('CTR_DEVICE_NF'))
                return
            }
            const device = this.ServiceContainer.devices[data.device]
            // Проверяем наличие порта
            if (!device.ports.output[data.port]) { 
                reject(ErrorManager.make('CTR_DEVICE_PORT_NF'))
                return
            }
            // Создаем новый индекс
            const index = this.getNextCaptureIndex()
            // Назначаем на порт листенер, когда порт попытается пробросить данные
            // они попадут в resovle что в свою очередь приведет его к ответу 
            device.ports.output[data.port].listens.set(index, (result)=>{
                clearTimeout(this.capturePull.get(index))
                this.capturePull.delete(index)
                resolve(result)
            })
            
            /**
             * Если за время ожидания ответа вышел таймаут - отбиваем конкретной ошибкой
             * SERVICE_CAPTURE_PORT_TIMEOUT
            */
            this.capturePull.set(index, setTimeout(()=>{
                this.capturePull.delete(index)
                reject(ErrorManager.make('SERVICE_CAPTURE_PORT_TIMEOUT'))
            }, data.timeout))
        })
    }
    

    /**
     * Get service commands list
     * 
    */
    async apiCommandList() {
        const iReq: IGuardMessage = {
              providerId: 0,
              providerType: 'Service',
              clientId: 0,
              command: 'commandsList',
              level: 0,
              data: {}
        }
        const ret = await this.ports.output['master.command'].push(iReq) as { [key: string]: ICommandExport };
        /**
         *  Very important  - EXPORT DATA !!!
         * */
        return JSON.parse(JSON.stringify(ret))
    }

    /**
     * Getting device metric
    */
    async apiServiceDeviceMetric(data: IDeviceMetricRequest, gData: IGuardMessage): Promise<any> {
        const DM = this.ServiceContainer.Bootstrap.getBootClass('DeviceMetrics', DeviceMetrics) as DeviceMetrics
        let precision: string | number = data.precision
        if (!isNaN(parseInt(precision))) precision = parseInt(precision)
        return DM.read(data.device, data.metric, data.period, precision, data.func)
    }



    /**
     * Getting device metric
     * Obtaining system metrics. Those that were initialized at the VRack2 level
     */
    async apiServiceMetric(data: IDeviceMetricRequest, gData: IGuardMessage): Promise<any> {
        const DM = this.Container.Bootstrap.getBootClass('DeviceMetrics', DeviceMetrics) as DeviceMetrics
        let precision: string | number = data.precision
        if (!isNaN(parseInt(precision))) precision = parseInt(precision)
        return DM.read(data.device, data.metric, data.period, precision, data.func)
    }

    /*                      Helpers                    */

    /**
     * Bind container device terminate event
    */
    protected async bindTerminate() {
        this.ServiceContainer.on('device.terminate', (data: { device: string; data: string; trace: any; }) => {
            if (data.trace instanceof CoreError) return this.serviceTerminate(data.trace)
            const CE = ErrorManager.make('SERVICE_CONTAINER_TERMINATE', { device: data.device })
            CE.add(data.trace)
            return this.serviceTerminate(CE)
        })
    }

    /**
     * Bind container devices events
     * 
     * Listens to device events and sends specialized broadcasts to the service manager
     * 
     * @see eventsChannels device events list
    */
    protected async bindContainerDeviceEvents() {
        for (const channel in this.eventsChannels) {
            this.ServiceContainer.on(channel, (data: { device: string; data: string; trace: any; }, args: any[]) => {
                this.broadcast(
                    this.makeBroadcastChannel(data.device, this.eventsChannels[channel]),
                    { message: data.data, trace: this.makeBroadcastTrace(data.trace), args }
                )
            })
        }
    }

    /**
     * Bind render device event
     * 
     * Update render pull & render data
     * 
     * @see renderPull
     * @see renderData
    */
    protected async bindRenderEvent() {
        this.ServiceContainer.on('device.render', (data: { device: string; data: string; trace: any; }) => {
            this.renderPull.add(data.device)
            this.renderData.set(data.device, data.trace)
            if (!this.renderTimer) this.serviceRender()
        })
    }

    /**
     * Send broadcast for device render event
     * 
     * @see bindRenderEvent
    */
    protected serviceRender() {
        if (!this.renderPull.size) return
        this.renderPull.forEach((deviceId) => {
            this.broadcast(this.makeBroadcastChannel(deviceId, 'render'), this.renderData.get(deviceId))
        })
        this.renderPull.clear()
        this.renderTimer = setTimeout(() => {
            this.renderTimer = false
            this.serviceRender()
        }, this.options.renderDelay)
    }


    /**
     * Convert object to string using util.inspect
    */
    protected makeBroadcastTrace(trace: any) {
        switch (typeof trace) {
            case 'bigint':
            case 'function':
                return { trace: trace.toString() }
            case 'string':
            case 'boolean':
            case 'number':
            case 'symbol':
            case 'undefined':
                return { trace }
            case 'object':
                if (trace instanceof Error) return CoreError.objectify(trace)
        }
        // if (typeof trace === 'string') return { trace }
        // return util.inspect(trace, { showHidden: false, depth: null, compact: false })
        return trace
    }

    /**
     * Make broadcast channel name
     * 
     * @param device DeviceID
     * @param target Specific channel of device
    */
    protected makeBroadcastChannel(device: string, target: string) {
        return ['services', this.Serviceinfo.id, 'devices', device, target].join('.')
    }

    /**
     * Send broadcast data to ServiceManager
    */
    protected broadcast(channel: string, data: any) {
        this.ports.output['broadcast'].push({ channel, data })
    }

    // /**
    //  * Send data to ServiceManager after service loaded
    // */
    // protected loaded() {
    //     this.ports.output['send'].push({
    //         __index: workerData.__index,
    //         __id: workerData.__id,
    //         resultData: workerData.__id
    //     })
    // }

    /**
     * Send termiate errro and terminate service process
    */
    protected serviceTerminate(error: Error) {
        this.ports.output['send'].push({
            command: 'error',
            threadId: threadId,
            error: CoreError.objectify(error)
        })
        this.exit()
    }

    protected async exit() {
        process.exit()
    }

    protected getNextCaptureIndex(){
        return this.captureIndex++
    }
}
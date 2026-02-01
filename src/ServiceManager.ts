import { CoreError, Device, ErrorManager, ImportManager, Port, Rule } from "vrack2-core";
import BasicPort from "vrack2-core/lib/ports/BasicPort";
import BasicType from "vrack2-core/lib/validator/types/BasicType";

import fs from 'fs'
import path from 'path'
import IGuardMessage from "./interfaces/IGuardMessage";
import IServiceConfig from "./interfaces/IServiceConfig";
import IServiceMeta from "./interfaces/IServiceMeta";

ErrorManager.register('ServiceManager', 'QNTN63C26KNS', 'SM_SERVICE_NOT_FOUND',
  'Service of this id not found', {
  id: Rule.string().example('testid').description('Service ID')
})

ErrorManager.register('ServiceManager', '4BJZAFKFLV4O', 'SM_META_NOT_FOUND',
  'Metadata of this id service not found', {
  id: Rule.string().example('testid').description('Service ID')
})

ErrorManager.register('ServiceManager', 'QZLBEXAB4CMF', 'SM_SERVICE_RUNNING',
  'Service is already running', {
  id: Rule.string().example('testid').description('Service ID')
})

ErrorManager.register('ServiceManager', 'CLCN1U9I41KR', 'SM_SERVICE_NOT_RUN',
  'Service not run', {
  id: Rule.string().example('testid').description('Service ID')
})

ErrorManager.register('ServiceManager', 'CIRBC9815SFP', 'SM_SERVICE_DIR_NOT_FOUND',
  'Service dir not found', {
  dir: Rule.string().example('path/to/dir').description('Service dir')
})

ErrorManager.register('ServiceManager', 'D32C9P24SVPQ', 'SM_SUMBASTER_COMMAND_NOT_FOUND',
  'Service  submaster command not found', {
  command: Rule.string().example('testCommand').description('Submaster command name')
})

export default class ServiceManager extends Device {

  outputs(): { [key: string]: BasicPort; } {
    return {
      'register.command': Port.standart().description('Register command into master'),
      'worker.add': Port.return().description('Run new worker for service'),
      'worker.stop': Port.return().description('Stop service worker '),
      'worker.request': Port.return().description('Send request to worker'),
      'broadcast': Port.standart().description('Send broadcast port'),
    }
  }

  inputs(): { [key: string]: BasicPort; } {
    return {
      'submaster': Port.return().description('Submaster command port')
    }
  }

  options!: { 
    autoStart: boolean,
    autoReload: boolean,
    printErrors: boolean,
    ignoreAutoReloadErrors: Array<string>,
    servicesDirs: Array<{ dir: string, generate: boolean }>
  };

  checkOptions(): { [key: string]: BasicType; } {
    return {
      autoStart: Rule.boolean().default(true).required().description('Global control for autostart services at VRack start'),
      autoReload: Rule.boolean().default(true).required().description('Global control for autoReload services if it crached'),
      printErrors: Rule.boolean().default(true).required().description('Print errros if service is crashed'),
      ignoreAutoReloadErrors: Rule.array().default([
        'CTR_CONF_EXTENDS_PROBLEM',
        'CTR_ERROR_INIT_DEVICE',
        'CTR_DEVICE_PROCESS_EXCEPTION',
        'CTR_DEVICE_PROCESS_PROMISE_EXCEPTION',
        'CTR_ERROR_INIT_CONNECTION',
        'CTR_IGNORE_SERVICE_AUTORELOAD'
      ]).required().description('List of errors that the system ignores to restart the service'),
      servicesDirs: Rule.array().default([{ dir: './services', generate: true }]).content(
        Rule.object().fields({
          dir: Rule.string().required().description('Service dir path'),
          generate: Rule.boolean().default(true).required().description('Global control for generate  service from .js files'),
        })
      ),
    }
  }


  /**
   * Содержит данные конфигурации всех сервисов
  */
  protected servicesList: { [key: string]: IServiceConfig } = {}
  
  /**
   * Содержит метадата сервисов
  */
  protected servicesMeta: { [key: string]: IServiceMeta } = {}
  /**
   * Содержит ошибки сервисов
  */
  protected servicesErrors: { [key: string]: Array<any> } = {}

  /**
   * Содержит воркеры сервисов
  */
  protected servicesWorker: { [key: string]: number } = {}

  /**
   * Содержит таймеры перезапуска сервисов
  */
  protected servicesTimer: { [key: string]: NodeJS.Timeout | undefined } = {}

  /**
   * Мета данные сервиса по умолчанию
  */
  protected defaultMeta: IServiceMeta = {
    name: 'default name',
    group: 'no group',
    description: 'Default description',
    system: false,
    autoStart: false,
    autoReload: false,
    isolated: false,
  }

  /**
   * Очередь для отслеживание и перегенерации файлов сервисов
   * Файл сорвиса генерируется не сразу а спустя 500мс после сохранения
   * В этой очереди хранятся таймауты перегенерации
   * */  
  protected Queue = new Map<string, NodeJS.Timeout | undefined>()

  /**
   * Поля конфигурации сервиса для документации 
  */
  protected ServiceRule = Rule.object().fields({
    id: Rule.string().example('test-serivce').description('Service unique ID'),
    errors: Rule.number().example(0).integer().description('Count of service errros'),
    filePath: Rule.string().example('path/to/service/file.json').description('Path to service file'),
    metaPath: Rule.string().example('path/to/meta/file.json').description('Path to meta file'),
    configPath: Rule.string().example('path/to/conf/file.json').description('Path to replace config file'),
    processPath: Rule.string().example('path/to/conf/file.json').description('Path to replace process file'),
    startedAt: Rule.string().example('12312312').description('Service started at'),
    run: Rule.boolean().example(false).description('Runned  flag'),
    autoReload: Rule.boolean().example(false).description('flag for autostart'),
    deleted: Rule.boolean().example(false).description('Deleted flag (deleted but service working now)')
  }).description('Service object information')


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
        'service': Rule.string().maxLength(200).required().example('servid').description('Service unique id') 
      },
      return: this.ServiceRule
    })

    this.ports.output['register.command'].push({
      command: 'serviceMeta',
      short: 'Get service meta',
      description: 'Return service meta information (see IServiceMeta)',
      level: 3,
      owner: this.type,
      icon: 'person-vcard-fill',
      handler: this.apiServiceMeta.bind(this),
      rules: { 'service': Rule.string().maxLength(200).required().example('servid').description('Service unique id') },
      return: Rule.object().fields({
        name: Rule.string().example('Lang name').description('Human service name'),
        group: Rule.string().example('Group name').description('Service group ()'),
        description: Rule.string().example('Long description').description('Service description in markdown style'),
        system: Rule.boolean().example(false).description('If the service is marked as system, it cannot be turned off.'),
        autoStart: Rule.boolean().example(false).description('Run service on startup VRack'),
        autoReload: Rule.boolean().example(false).description('Auto reload service if him crashed'),
      }).description('Service meta information')
    })

    this.ports.output['register.command'].push({
      command: 'serviceList',
      short: 'Get service list',
      description: 'Return list of all services',
      level: 3,
      owner: this.type,
      icon: 'list-stars',
      handler: this.apiServiceList.bind(this),
      return: Rule.array().content(this.ServiceRule)
      .description('List array of services configs')
    })

    this.ports.output['register.command'].push({
      command: 'serviceUpdateList',
      short: 'Update service list',
      description: 'Return list of all services',
      level: 3,
      owner: this.type,
      icon: 'arrow-repeat',
      handler: this.apiServiceListUpdate.bind(this),
      return: Rule.array().content(this.ServiceRule)
      .description('List array of services configs')
    })

    this.ports.output['register.command'].push({
      command: 'serviceStart',
      short: 'Service start',
      description: 'Start service',
      level: 1,
      owner: this.type,
      icon: 'play-circle-fill',
      handler: this.apiServiceStart.bind(this),
      rules: { 'service': Rule.string().maxLength(200).required().example('servid').description('Service unique id') },
      return: this.ServiceRule
    })

    this.ports.output['register.command'].push({
      command: 'serviceStop',
      short: 'Service stop',
      description: 'Stop service',
      level: 1,
      owner: this.type,
      icon: 'stop-circle-fill',
      handler: this.apiServiceStop.bind(this),
      rules: { 'service': Rule.string().maxLength(200).required().example('servid').description('Service unique id') },
      return: this.ServiceRule
    })

    this.ports.output['register.command'].push({
      command: 'serviceCheck',
      short: 'Service check',
      description: 'Check service',
      level: 1,
      owner: this.type,
      icon: 'check-circle-fill',
      handler: this.apiServiceCheck.bind(this),
      rules: { 'service': Rule.string().maxLength(200).required().example('servid').description('Service unique id') },
      return: Rule.object().description('Empty object')
    })

    this.ports.output['register.command'].push({
      command: 'serviceErrors',
      short: 'Get service errors',
      description: 'Errors service',
      level: 1,
      owner: this.type,
      icon: 'sign-stop-fill',
      handler: this.apiServiceErrors.bind(this),
      rules: { 'service': Rule.string().maxLength(200).required().example('servid').description('Service unique id') },
      return: Rule.array().content(Rule.object().description('Error object')).description('Array of errors')
    })

    this.ports.output['register.command'].push({
      command: 'serviceErrorsClear',
      short: 'Clear errors',
      description: 'Clear service errors',
      level: 1,
      owner: this.type,
      icon: 'trash-fill',
      handler: this.apiServiceErrorsClear.bind(this),
      rules: { 'service': Rule.string().maxLength(200).required().example('servid').description('Service unique id') },
      return: Rule.object().example({}).description('Empty object')
    })


  }

  async processPromise(): Promise<void> {
    await this.apiServiceListUpdate() // Обновляем список сервисов 
    this.servicesWatch()  // Начинаем отслеживание сервисных директорий
    if (this.options.autoStart) this.servicesStart() // Запуск сервисов который должны быть запущены со старта
  }

  /**
   * Return a general service info
   * 
   * @see IServiceConfig
  */
  async apiService(data: { service: string }) {
    return this.getService(data.service)
  }

  /**
   * Return service meta info
   * 
   * @see IServiceMeta
  */
  async apiServiceMeta(data: { service: string }) {
    return this.getMeta(data.service)
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
  async apiServiceList() {
    return this.exportServiceList()
  }

  /**
   * Start service command
   * 
   * @param data.service service ID
  */
  async apiServiceStart(data: { service: string }) {
    const conf = this.getService(data.service)
    if (conf.run) throw ErrorManager.make('SM_SERVICE_RUNNING')
    // Сбрасываем флаг автоматического запуска
    conf.autoReload = false
    // Запуск воркера
    this.servicesWorker[data.service] = await this.ports.output['worker.add'].push({
      // Является ли данный сервис изолированным
      isolated: this.servicesMeta[conf.id].isolated,
      // Данные workerData которые будут переданы в новый процесс
      data: this.serviceWorkerData(conf, 'worker'),
      onError: (error: any) => {
        // При ошибке проверяяем - можно ли перезапускать сервис
        if (this.servicesMeta[conf.id].autoReload && this.options.autoReload) conf.autoReload = true
        // Нужно проверить - какая была ошибка, если ошибка входит в список игнорируемых
        // То мы не разрешаем перезапуск сервиса Например при инициализации устройства
        // error у нас всегда WM_INTERNAL_ERROR 
        const cError = error as CoreError
        // Нам нужна ошибка пониже
        if (cError.vAddErrors.length && ErrorManager.isError(cError.vAddErrors[0])) {
          // Для удобства сделаем ссылку на нее
          const iError = cError.vAddErrors[0] as CoreError
          // Если в списке игнорируемых ошибок есть наша ошибка - отключаем авторелоад
          if (this.options.ignoreAutoReloadErrors.indexOf(iError.vShort) !== -1) conf.autoReload = false
        }
        // Сообщяем об ошибке
        this.Container.emit('service.error', conf.id, error)
        // Добавляем ошибку 
        this.addError(conf.id, error)
      },
      onExit: () => {
        // Удаляем активный вокрер
        delete this.servicesWorker[data.service]
        // Говорим что сервис более не запущен
        conf.run = false
        this.broadcastUpdate([conf.id]) // Отправка всем изменений
        // Если релоад отключен или таймер стоит по какой то причине уже то return
        if (!conf.autoReload || this.servicesTimer[conf.id] !== undefined) return
        // Если 
        this.servicesTimer[conf.id] = setTimeout(() => {
          this.servicesTimer[conf.id] = undefined
          // Какой смысл это делать в try catch без await
          try {
            if (conf.run) return
            this.apiServiceStart(data)
          } catch (err) { return }
        }, 5000)
      }
    })
    const iReq: IGuardMessage = {
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
    }
    await this.inputSubmaster(iReq)
    conf.run = true
    conf.startedAt = Date.now()
    this.broadcastUpdate([conf.id])
    return conf
  }

  /**
   * Stop service command
   * 
   * @param data.service service ID
  */
  async apiServiceStop(data: { service: string }) {
    const conf = this.getService(data.service)
    if (this.servicesTimer[conf.id] !== undefined && !conf.run) {
      this.servicesTimer[conf.id] = undefined
      clearTimeout(this.servicesTimer[conf.id])
      return conf
    }
    if (!conf.run) throw ErrorManager.make('SM_SERVICE_NOT_RUN')
    try {
      await this.ports.output['worker.stop'].push({ id: this.servicesWorker[conf.id] })
      return conf
    } catch (error) {
      this.broadcastUpdate([conf.id])
      if (error instanceof CoreError && error.vShort === 'WM_WORKER_EXIT') return 'success'
      throw error
    }
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
  async apiServiceCheck(data: { service: string }) {

    const conf = this.getService(data.service)

    const wid = await this.ports.output['worker.add'].push({
      data: this.serviceWorkerData(conf, 'check'),
      onError: (error: any) => {
        // При проверке отправка события об ошибке не производится
        this.addError(conf.id, error)
      },
      onExit: () => { return }
    })
    const iReq: IGuardMessage = {
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
    }

    await this.ports.output['worker.request'].push({ id: wid, data: iReq })
    return {};
  }


  /**
   * Return a service errors list
   * 
   * @param data.service service ID
  */
  async apiServiceErrors(data: { service: string }) {
    this.getService(data.service)
    const ret = []
    if (this.servicesErrors[data.service]) {
      for (const er of this.servicesErrors[data.service]) {
        for (const rer of er.vAddErrors) ret.push(rer)
      }
    }
    return ret
  }

  /**
   * Delete all service errors
   * 
   * @param data.service service ID
  */
  async apiServiceErrorsClear(data: { service: string }) {
    this.getService(data.service)
    this.servicesErrors[data.service] = []
    this.servicesList[data.service].errors = 0
    this.broadcastUpdate([data.service])
    return {}
  }

  /**
   * Update service list
   * 
   * return service list
   * @see apiServiceList
  */
  async apiServiceListUpdate() {
    for (const dirConf of this.options.servicesDirs) {
      const dir = path.join(dirConf.dir)
      this.updateServicesDir(dir)
    }
    for (const key in this.servicesList) {
      if (fs.existsSync(this.servicesList[key].filePath)) continue
      if (this.servicesList[key].run) this.servicesList[key].deleted = true
      else delete this.servicesList[key]
    }
    return this.exportServiceList()
  }

  /******      INPUT HANDLERS      *******/

  /**
   * Processes messages from the master
   * 
   * Attempts to execute a command within the specified service.
  */
  async inputSubmaster(data: IGuardMessage) {
    
    if (!data.data || !data.data.service) throw ErrorManager.make('SM_SUMBASTER_COMMAND_NOT_FOUND')
    if (!this.servicesList[data.data.service]) throw ErrorManager.make('SM_SERVICE_NOT_FOUND', { id: data.data.service })
    if (!this.servicesWorker[data.data.service]) throw ErrorManager.make('SM_SERVICE_NOT_RUN', { id: data.data.service })
    return await this.ports.output['worker.request'].push({ id: this.servicesWorker[data.data.service], data })
  }

  /**
   * Monitors service files. 
   * If changes are made to JS files, it generates new service files.
  */
  protected servicesWatch() {
    // Начинаем перебор сервисных директорий
    for (const dirConf of this.options.servicesDirs as Array<{ dir: string, generate: boolean }>) {
      if (!dirConf.generate) continue // Если генерация для директории отключена
      fs.watch(path.join(dirConf.dir), { encoding: 'utf8' }, (eventType, filename) => {
        if (!filename) return
        if (eventType !== 'change') return
        const res = filename.split('.')
        if (res.length !== 2) return
        if (res[1] !== 'js') return // Проверяем расширение
        // Если у нас уже есть в очереди этот файл - 
        if (this.Queue.has(filename)) clearTimeout(this.Queue.get(filename))
        this.Queue.set(filename, setTimeout(async () => {
          try {
            // Генерация 
            await this.convert(dirConf.dir, res[0], res[1], filename)
          } catch (error) {
            // Печатаем ошибку для debug/syslog
            console.error(error)
            // Добавляем к сервису ошибку
            // Мы предпологаем что первая часть файла у нас - идентификатор сервиса
            // Добавляем его к списку ошибок сервиса
            this.addError(res[0], error);
            if (error instanceof Error) this.error('Error generate service file', error)
          }
        }, 500))
      })
    }
  }

  /**
   *  Regenerate new service file 
   * 
   * @see servicesWatch()
   */
  protected async convert(dir: string, service: string, ext: string, filename: string) {
    delete require.cache[path.join(ImportManager.systemPath(), dir, filename)]
    const result = await ImportManager.importPath(path.join(ImportManager.systemPath(), dir, filename))
    if (result && typeof result === 'object') {
      fs.writeFileSync(path.join(ImportManager.systemPath(), dir, service + '.json'), JSON.stringify(result.default, null, '\t'))
    }
  }

  /**
   * Starting services when vrack start
  */
  protected async servicesStart() {
    for (const service in this.servicesMeta) {
      try {
        if (this.servicesMeta[service].autoStart) await this.apiServiceStart({ service })
      } catch (er) {
        this.addError(service, er)
      }
    }
  }

  /**
   * Отправляет информацию об обновлении конкретных сервисов
  */
  protected broadcastUpdate(ids: Array<string>) {
    for (const id of ids) {
      this.ports.output['broadcast'].push({
        command: 'broadcast',
        channel: 'manager.service.' + id + '.update',
        data: this.servicesList[id]
      })
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
  protected serviceWorkerData(conf: IServiceConfig, type: string): {
    processFile: string
    confFile: string
    contaierId: string
    MainProcess: string
  }{
    let processFile = path.join(path.dirname(__dirname), 'process.json')
    let confFile = path.join(path.dirname(__dirname), 'process.conf.json')
    
    // Если существует сервис файл - заменяем им основной файл процесса
    if (conf.processPath && fs.existsSync(conf.processPath)) {
      processFile = conf.processPath // Определяем новый процесс файл
      confFile = '' // Отключаем дополнение файла
    }
    return { 
      processFile,
      confFile,
      MainProcess: 'vrack2-core.MainProcess',
      contaierId: type + '::' + conf.id
    }
  }

  /**
   * Return service information
   * 
   * @param service Service ID
  */
  protected getService(service: string) {
    if (!this.servicesList[service]) throw ErrorManager.make('SM_SERVICE_NOT_FOUND', { id: service })
    return this.servicesList[service]
  }

  /**
   * Return service metadata information
   * 
   * @param service Service ID
  */
  protected getMeta(service: string) {
    this.getService(service)
    if (this.servicesMeta[service]) return this.servicesMeta[service]
    throw ErrorManager.make('SM_META_NOT_FOUND')
  }

  /**
   * Export service list with meta data
   * 
   * @see apiServiceList
   * @see apiServiceListUpdate
  */
  protected exportServiceList() {
    const ret: { [key: string]: any } = {}
    for (const id in this.servicesList) { ret[id] = this.exportService(id) }
    return ret
  }

  /**
   * Export one service with metadata
   **/
  protected exportService(id: string) {
    const sl = Object.assign({}, this.servicesList[id])
    Object.assign(sl, this.servicesMeta[id])
    return sl
  }

  /** 
   * Add error for service
   */
  protected addError(service: string, error: any) {
    if (this.options.printErrors) console.error(error)
    if (this.servicesList[service].errors > 5) return
    if (!this.servicesErrors[service]) this.servicesErrors[service] = []
    this.servicesErrors[service].unshift(error)
    this.servicesList[service].errors++
    this.broadcastUpdate([service])
  }

  /**
   * Try read metadata file
   * 
   * @param p Path to metadata file
  */
  protected readServiceMeta(p: string) {
    if (!ImportManager.isFile(p)) return Object.assign({}, this.defaultMeta)
    try {
      return Object.assign({}, this.defaultMeta, ImportManager.importJSON(p))
    } catch (err) {
      return Object.assign({}, this.defaultMeta)
    }
  }

  /**
   * Searches all files and updates the list of available services in the directory
   * 
   * @param dir Path to services dir
  */
  protected updateServicesDir(dir: string) {
    if (!fs.existsSync(dir)) throw ErrorManager.make('SM_SERVICE_DIR_NOT_FOUND', { dir })
    const fileList = ImportManager.fileList(dir)
    for (const filename of fileList) {
      const expl = filename.split('.')
      if (expl.length !== 2 || expl[1] !== 'json') continue
      const id = expl[0]
      const metaPath = path.join(dir, id + '.meta.json')
      this.servicesMeta[id] = this.readServiceMeta(metaPath)
      if (this.servicesList[id]) { this.servicesList[id].deleted = false; continue }
      this.servicesList[id] = {
        id, errors: 0, run: false, deleted: false,
        filePath: path.join(dir, filename),
        metaPath: path.join(dir, id + '.meta.json'),
        configPath: path.join(dir, id + '.conf.json'),
        processPath: path.join(dir, id + '.process.json'),
      }
    }
  }
}
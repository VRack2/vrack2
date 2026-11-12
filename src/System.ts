import { BasicType, Device, DeviceManager, ErrorManager, Metric, MetricOne, Port, Rule, StructureStorage } from "vrack2-core";
import { IContainerStructure } from "vrack2-core/lib/Container";
import os from "os"
import process from "process"
import BasicPort from "vrack2-core/lib/ports/BasicPort";

ErrorManager.register('System', 'SYS_SHUTDOWN_TIMEOUT',
  'Graceful shutdown did not finish within shutdownTimeout; the process force-exits', {
  timeout: Rule.number().required().example(10000).description('Shutdown timeout, ms')
})

ErrorManager.register('System', 'SYS_SHUTDOWN_STOP_FAILED',
  'Container.stopAll() failed during graceful shutdown', {})

ErrorManager.register('System', 'SYS_SHUTDOWN_DESTROY_FAILED',
  'Bootstrap.destroyAll() failed during graceful shutdown', {})

export default class System extends Device {

  description(): string {
    return `Устройство System предоставляет системную информацию и метрики. 
Оно отслеживает использование памяти системы и предоставляет API для получения информации о хосте, CPU, сети и Node.js окружении. 
Устройство также позволяет получать системные метрики через VRackDB и управлять визуальной структурой сервисов по их ID.`
  }

  outputs(): { [key: string]: BasicPort; } {
    return {
      'register.command': Port.standard().description('Register command into master'),
    }
  }

  checkOptions(): { [key: string]: BasicType; } {
    return {
      shutdownTimeout: Rule.number().integer().min(1000).default(15000).required()
        .description('Graceful shutdown watchdog (ms): if Container.stopAll/destroyAll does not finish in time, force-exit'),
    }
  }

  metrics(): { [key: string]: MetricOne; } {
    return {
      'memory.rss': Metric.one().descriptions('System memory rss'),
      'memory.heaptotal': Metric.one().descriptions('System memory heapTotal'),
      'memory.heapused': Metric.one().descriptions('System memory heapUsed'),
      'memory.external': Metric.one().descriptions('System memory external'),
      'memory.arraybuffers': Metric.one().descriptions('System memory arrayBuffers'),
    }
  }

  /** Memory-metrics interval handle (cleared on onStop) */
  protected memTimer?: NodeJS.Timeout

  onStart(): void {
    this.bindShutdown()

    this.ports.output['register.command'].push({
      command: 'structureGet',
      short: 'Get structure',
      description: 'Return container structure by container ID',
      level: 3,
      owner: this.type,
      icon: 'map-fill',
      handler: this.apiStructureGet.bind(this),
      rules: { id: Rule.string().required().example('vrack2').description('Container unique identify (see Container.id)') },
      return: Rule.object().description('Container structure object - see IContainerStructure')
    })

    this.ports.output['register.command'].push({
      command: 'structureUpdate',
      short: 'Update structure',
      description: 'Update structure by container unique identify',
      level: 1,
      owner: this.type,
      icon: 'marker-tip',
      handler: this.apiStructureUpdate.bind(this),
      rules: {
        id: Rule.string().required().example('vrack2').description('Container unique identify (see Container.id)'),
        structure: Rule.object().required().description('New Structure - see IContainerStructure')
      },
    })

    this.ports.output['register.command'].push({
      command: 'systemInfo',
      short: 'Get sysinfo',
      description: 'Returns the basic information available to nodejs',
      level: 3,
      owner: this.type,
      icon: 'cpu',
      handler: this.apiGetSystemInfo.bind(this),
      rules: {},
      return: Rule.object().fields({
        os: Rule.object().fields({
          platform: Rule.string().example('win23').description('Platform type like a win32 openbsd...'),
          type: Rule.string().example('Linux').description('returns Linux, Darwin, Windows_NT'),
          release: Rule.string().example('5.15.0-134-generic').description('Release os string'),
          arch: Rule.string().example('x64').description('Os arch like a x86,arm64...')
        }).description('OS informations'),
        cpu: Rule.object().fields({
          model: Rule.string().example('Common KVM processor').description('Cpu model name or unknown'),
          cores: Rule.number().example(2).integer().description('Number of cores'),
          speed: Rule.string().example('3000 MHz').description('Basic cpu speed')
        }).description('Cpu information (for unix systems only)'),
        node: Rule.object().fields({
          version: Rule.string().example('v16.20.2').description('Node version'),
          v8: Rule.string().example('9.4.146.26-node.26').description('v8 info'),
          openssl: Rule.string().example('1.1.1v+quic').description('Openssl info'),
          pid: Rule.string().example('1612434').description('Pid info'),
          uptime: Rule.string().example('8621.45 minutes').description('Uptime in minutes'),
        }).description('Node js information'),
        user: Rule.object().fields({
          hostname: Rule.string().example('vmain').description('Host name'),
          homedir: Rule.string().example('/home/user/').description('v8 info'),
          userInfo: Rule.object().description('System user information'),
        }),
        network: Rule.object().description('Network interfaces information - see os.networkInterfaces()')
      }).description('Device info object')
    })

    this.memTimer = setInterval(() => {
      const mem = process.memoryUsage()
      this.metric('memory.rss', Math.round(mem.rss / 1024 / 1024))
      this.metric('memory.heaptotal', Math.round(mem.heapTotal / 1024 / 1024))
      this.metric('memory.heapused', Math.round(mem.heapUsed / 1024 / 1024))
      this.metric('memory.external', Math.round(mem.external / 1024 / 1024))
      this.metric('memory.arraybuffers', Math.round(mem.arrayBuffers / 1024 / 1024))
    }, 5000)

  }

  /**
   * Release the memory-metrics interval owned by this device. Without this the
   * interval keeps the event loop alive after Container.stopAll(), so the
   * process only exits because the shutdown chain calls process.exit()
   * explicitly, and restarting the device stacks a second interval.
   */
  onStop(): void {
    if (this.memTimer) { clearInterval(this.memTimer); this.memTimer = undefined }
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
  protected bindShutdown(): void {
    let stoppingAt = 0
    const handler = (signal: string) => {
      if (stoppingAt) {
        // Re-entrant re-raise from the journal-db hook (same tick) — ignore.
        // A real second signal (user pressed Ctrl+C again) — force exit.
        if (Date.now() - stoppingAt > 1000) process.exit(1)
        return
      }
      stoppingAt = Date.now()
      this.terminal('shutdown signal received', { signal })
      // Watchdog: if teardown hangs (a device onStopAsync never resolves),
      // force-exit. unref so it doesn't hold the loop when teardown is fast.
      const watchdog = setTimeout(() => {
        this.error('graceful shutdown timed out — force exit', ErrorManager.make('SYS_SHUTDOWN_TIMEOUT', { timeout: this.options.shutdownTimeout }))
        process.exit(1)
      }, this.options.shutdownTimeout)
      watchdog.unref?.()
      let hadError = false
      Promise.resolve()
        .then(() => this.Container.stopAll())
        .catch((e) => { hadError = true; this.error('container stopAll failed during shutdown', ErrorManager.make('SYS_SHUTDOWN_STOP_FAILED').add(e as Error)) })
        .then(() => this.Container.Bootstrap.destroyAll())
        .catch((e) => { hadError = true; this.error('bootstrap destroyAll failed during shutdown', ErrorManager.make('SYS_SHUTDOWN_DESTROY_FAILED').add(e as Error)) })
        .then(() => { clearTimeout(watchdog); process.exit(hadError ? 1 : 0) })
    }
    process.on('SIGINT', () => handler('SIGINT'))
    process.on('SIGTERM', () => handler('SIGTERM'))
  }

  /**
   * Getting the service structure
   * Allows you to retrieve the structure of any service by container ID
  */
  async apiStructureGet(data: { id: string }) {
    const SS = this.Container.Bootstrap.getBootClass('StructureStorage', StructureStorage) as StructureStorage
    return await SS.getById(data.id)
  }

  /**
   * Update the service structure
   * Allows you to update the structure of any service by container ID
  */
  async apiStructureUpdate(data: { id: string, structure: IContainerStructure }) {
    const SS = this.Container.Bootstrap.getBootClass('StructureStorage', StructureStorage) as StructureStorage
    await SS.updateById(data.id, data.structure)
    return {}
  }

  /**
   * Returns a list of device vendors
   */
  async apiVendorList(): Promise<Array<string>> {
    const DM = this.Container.Bootstrap.getBootClass('DeviceManager', DeviceManager) as DeviceManager
    return DM.getVendorList()
  }

  /**
   * Getting the list of devices by its vendor
  */
  async apiVendorDevices(data: { vendor: string }): Promise<Array<string>> {
    const DM = this.Container.Bootstrap.getBootClass('DeviceManager', DeviceManager) as DeviceManager
    return DM.getVendorDeviceList(data.vendor)
  }

  /**
   * Getting information about the device
  */
  async apiVendorDeviceInfo(data: { vendor: string, device: string }): Promise<any> {
    const DM = this.Container.Bootstrap.getBootClass('DeviceManager', DeviceManager) as DeviceManager
    return DM.getDeviceInfo(data.vendor, data.device)
  }

  /**
   * Getting system infomation
   * 
  */
  async apiGetSystemInfo(): Promise<any> {
    const getCpuInfo = () => {
      const cpus = os.cpus();
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
        return os.userInfo();
      } catch (e) {
        return { uid: -1, gid: -1, username: 'Unknown', homedir: 'Unknown', shell: null };
      }
    };

    return {
      os: {
        platform: os.platform() || 'Unknown',
        type: os.type() || 'Unknown',
        release: os.release() || 'Unknown',
        arch: os.arch() || 'Unknown'
      },
      cpu: getCpuInfo(),
      node: {
        version: process.version || 'Unknown',
        v8: process.versions?.v8 || 'Unknown',
        openssl: process.versions?.openssl || 'Unknown',
        pid: process.pid || 'Unknown',
        uptime: (process.uptime() / 60).toFixed(2) + ' minutes'
      },
      user: {
        hostname: os.hostname() || 'Unknown',
        homedir: os.homedir() || 'Unknown',
        userInfo: getUserInfo()
      },
      network: os.networkInterfaces() || {}
    };
  }
}
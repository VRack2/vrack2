import { BasicMetric, Device, DeviceManager, DeviceMetrics, Metric, Port, Rule, StructureStorage } from "vrack2-core";
import { IContainerStructure } from "vrack2-core/lib/Container";
import os from "os"
import process from "process"
import BasicPort from "vrack2-core/lib/ports/BasicPort";
import IGuardMessage from "./interfaces/IGuardMessage";
import IDeviceMetricRequest from "./interfaces/IDeviceMetricRequest";

export default class System extends Device {
  outputs(): { [key: string]: BasicPort; } {
    return {
      'register.command': Port.standart().description('Register command into master'),
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

  process(): void {
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
      command: 'systemMetric',
      short: 'Get system metric',
      description: 'Getting a system metrics',
      level: 3,
      owner: this.type,
      icon: 'graph-up',
      handler: this.apiSystemMetric.bind(this),
      rules: {
        service: Rule.string().maxLength(120).default('not used').required().description('Service id (not used for this action)'),
        device: Rule.string().maxLength(120).example('DeviceID').required().description('Device id'),
        metric: Rule.string().maxLength(120).example('metric.id').required().description('Device metric path'),
        period: Rule.string().maxLength(120).example('start:end').required().description('VRackDB period'),
        precision: Rule.string().maxLength(60).required().example('400').description('VRackDB precision'),
        func: Rule.string().default('last').maxLength(10).description('Read function (last,first,min,max,avg,sum)')
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

    setInterval(() => {
      const mem = process.memoryUsage()
      this.metric('memory.rss', Math.round(mem.rss / 1024 / 1024))
      this.metric('memory.heaptotal', Math.round(mem.heapTotal / 1024 / 1024))
      this.metric('memory.heapused', Math.round(mem.heapUsed / 1024 / 1024))
      this.metric('memory.external', Math.round(mem.external / 1024 / 1024))
      this.metric('memory.arraybuffers', Math.round(mem.arrayBuffers / 1024 / 1024))
    }, 5000)

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
   * Getting device metric
   * Obtaining system metrics. Those that were initialized at the VRack2 level
  */
  async apiSystemMetric(data: IDeviceMetricRequest, gData: IGuardMessage): Promise<any> {
    const DM = this.Container.Bootstrap.getBootClass('DeviceMetrics', DeviceMetrics) as DeviceMetrics
    let precision: string | number = data.precision
    if (!isNaN(parseInt(precision))) precision = parseInt(precision)
    return DM.read(data.device, data.metric, data.period, precision, data.func)
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
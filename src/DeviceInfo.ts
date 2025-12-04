import { CoreError, Device, BasicPort, ErrorManager, ImportManager, Port, Rule } from "vrack2-core";
import IGuardMessage from "./interfaces/IGuardMessage";
import IServiceConfig from "./interfaces/IServiceConfig";
import path from 'path'

export default class DeviceInfo extends Device {

  outputs(): { [key: string]: BasicPort; } {
    return {
      'register.command': Port.standart().description('Register command into master'),
      'worker.add': Port.return().description('Run new worker for service'),
      'worker.stop': Port.return().description('Stop service worker '),
      'worker.request': Port.return().description('Send request to worker'),
    }
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
      return: Rule.array().content(
        Rule.string().example('vrack').description('Vendor name (vendor unique ID)')
      ).description('Array of vendor list')
    })

    this.ports.output['register.command'].push({
      command: 'vendorDevices',
      short: 'Get devices list',
      description: 'Getting device vendors',
      level: 3,
      owner: this.type,
      icon: 'hdd-stack',
      handler: this.apiVendorDevices.bind(this),
      rules: {
        vendor: Rule.string().maxLength(250).example('vrack').required().description('Vendor'),
      },
      return: Rule.array().content(
        Rule.string().example('DeviceName').description('Device name (device name of this vendor)')
      ).description('Array of device list')
    })

    this.ports.output['register.command'].push({
      command: 'vendorDeviceInfo',
      short: 'Get device info',
      description: 'Getting device info',
      level: 3,
      owner: this.type,
      icon: 'hdd',
      handler: this.apiVendorDeviceInfo.bind(this),
      rules: {
        vendor: Rule.string().maxLength(250).example('vrack').required().description('Vendor ID'),
        device: Rule.string().maxLength(250).example('DeviceID').required().description('Device ID')
      },
      return: Rule.object().fields({
        actions: Rule.object().description('Actions list - see IAction'),
        metrics: Rule.object().description('Metrics list - see IMetricSettings'),
        inputs: Rule.object().description('Input ports list - see IPort'),
        outputs: Rule.object().description('Output ports list - see IPort'),
        checkOptions: Rule.object().description('Options rules list - see IValidationRule'),
        description: Rule.string().description('Device descriotion'),
      }).description('Device info object')
    })

  }
 
  /**
   * Returns a list of device vendors
  */
  async apiVendorList(data: { vendor: string }): Promise<any> {
    return await this.workerCommand('vendorList', data)
  }

  /**
   * Getting the list of devices by its vendor
  */
  async apiVendorDevices(data: { vendor: string }): Promise<any> {
    return await this.workerCommand('vendorDevices', data)
  }

  /**
   * Getting information about the device
  */
  async apiVendorDeviceInfo(data: { vendor: string, device: string }): Promise<any> {
    return await this.workerCommand('vendorDeviceInfo', data)
  }

  /**
   * Поскольку у нас при импорте устройств происходит кеширование класса по пути
   * нам необходимо каждый раз, при запросе информации об устройсвах возвращать не кешированный результат
   * Что бы гарантировать это - будем использовать создание воркера и выполнение команды внутри него
  */
  async workerCommand(command:string, data: any){

    const iReq: IGuardMessage = {
      providerId: 0,
      level: 0,
      clientId: 0,
      providerType: 'ServiceManager', command, data
    }

    let processFile = path.join(path.dirname(__dirname), 'device-info.json')
    let confFile = path.join(path.dirname(__dirname), 'device-info.conf.json')
    const wid = await this.ports.output['worker.add'].push({
      data: { 
        processFile,
        confFile,
        MainProcess: 'vrack2-core.MainProcess',
        contaierId: 'device-info::worker'
    },
      onError: (error: any) => { return },
      onExit: () => { return }
    })

    try {
      const result  = await this.ports.output['worker.request'].push({ id: wid, data: iReq })
      await this.ports.output['worker.stop'].push({id: wid})
      return result
    } catch (err) {
      throw err
    }
  }
}
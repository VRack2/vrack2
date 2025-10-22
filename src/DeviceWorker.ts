import { CoreError, Device, ErrorManager, ImportManager, Port, Rule, DeviceManager, BasicPort, BasicType} from "vrack2-core";

import { workerData, threadId } from "worker_threads"



export default class DeviceWorker extends Device {

  outputs(): { [key: string]: BasicPort; } {
    return {
      'register.command': Port.standart().description('Register command into master'),
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
        vendor: Rule.string().maxLength(250).example('vrack').require().description('Vendor'),
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
        vendor: Rule.string().maxLength(250).example('vrack').require().description('Vendor ID'),
        device: Rule.string().maxLength(250).example('DeviceID').require().description('Device ID')
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
}
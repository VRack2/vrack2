import { Device, BasicPort, Port, BasicType, Rule, ErrorManager } from "vrack2-core";
import WorkerProvider from './WorkerProvider';


ErrorManager.register(
    'InterService',
    'SC3AHS7GZUTZ',
    'INTER_SERVICE_PROCESS_ERROR',
    'You are trying to run a device outside of a service container. This device can only run inside a service with WorkerProvider'
  )

/**
 * A device that can execute commands outside its service (the service of VRack2 itself). 
 * This allows executing actions or accessing ports of another service. 
 * As well as control other VRack2 services
*/
export default class InterService extends Device {

    inputs(): { [key: string]: BasicPort; } {
        return {
            'command%d': Port.return().dynamic(this.options.inputs).requirement(Rule.object().fields({
                command: Rule.string().example('serviceStart').maxLength(120).description('VRack2 general service master command'),
                data: Rule.object().example({}).description('Command data')
            })).return(Rule.boolean()).description('Port for run internal VRack2 service command')
        }
    }

    checkOptions(): { [key: string]: BasicType; } {
        return {
            inputs: Rule.number().integer().min(0).default(1).require().description('Count input command ports')
        }
    }

    preProcess(): void {
        for (let i = 1; i<= this.options.inputs; i++ ) this.addInputHandler('command'+i, this.inputCommand.bind(this))
    }
    
    process(): void {
        if (!this.Container.parent) throw ErrorManager.make('INTER_SERVICE_PROCESS_ERROR')
        if (!this.Container.parent?.devices['WorkerProvider']) throw ErrorManager.make('INTER_SERVICE_PROCESS_ERROR')
    }

    /**
     * Run internal command WorkerProvider. 
     * The method is transparent. Error handling takes place at the command call level of this device,
     * i.e. in the area of responsibility of the device higher up
     * 
     * @see WorkerProvider
    */
    inputCommand(data: { command: string, data: any }){
        const WorkerProvider = this.Container.parent?.devices['WorkerProvider'] as WorkerProvider
        return WorkerProvider.inputInternal(data)
    }
}
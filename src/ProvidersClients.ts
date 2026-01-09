import { Device, Port, Rule } from "vrack2-core";
import BasicPort from "vrack2-core/lib/ports/BasicPort";
import BasicType from "vrack2-core/lib/validator/types/BasicType";
import IProviderMessage from "./interfaces/IProviderMessage";
import IRegisterProviderClient from "./interfaces/IRegisterProviderClient";
import IUnregisterProviderClient from "./interfaces/IUnregisterProviderClient";
import IRegisteredClient from "./interfaces/IRegisteredClient";

export default class ProvidersClients extends Device {

    /**
     * Registered information
     * 
     * providers[providerId][clientId] 
    */
    providers: {[key:number]: {[key: number] : IRegisteredClient} } = {}

    inputs(): { [key: string]: BasicPort; } {
        return {
            'client%d.command': Port.return()
                .dynamic(this.options.providers)
                .description('Port for clients commands'),
            'client%d.register': Port.standart()
                .dynamic(this.options.providers)
                .description('Register client'),
            'client%d.unregister': Port.standart()
                .dynamic(this.options.providers)
                .description('Unregister client'),
            'client.send': Port.standart()
                .description('Sending a message to a specific client')
        }
    }

    outputs(): { [key: string]: BasicPort; } {
        return {
            'clients.command': Port.return()
                .description('Client command'),
            'clients.register': Port.standart()
                .description('Client register event'),
            'clients.unregister': Port.standart()
                .description('Client unregister event'),
            'provider%d.send': Port.standart().dynamic(this.options.providers)
                .description('Send data to provider')
        }
    }

    checkOptions(): { [key: string]: BasicType; } {
        return {
            providers: Rule.number().required().integer().min(0).max(10)
        }
    }

    preProcess(): void {
        for (let i = 1; i <= this.options.providers; i++)
        {   
            this.providers[i] = {}
            this.addInputHandler('client' + i + '.Command', (data: IProviderMessage) =>  this.inputClientCommand(data, i ))
            this.addInputHandler('client' + i + '.Register', (data: IRegisterProviderClient) => this.inputClientRegister(data, i ) )
            this.addInputHandler('client' + i + '.Unregister', (data: IUnregisterProviderClient) => this.inputClientUnregister(data, i ))
        }
    }
    
    /**
     * Sending a message to a specific client
     * 
     * It won't do anything if the client doesn't exist 
     * 
     * @see inputs
    */
    inputClientSend(data:IProviderMessage){
        if (data.clientId === undefined || data.providerId === undefined) return
        if (this.providers[data.providerId][data.clientId] === undefined) return
        this.ports.output[`provider${data.providerId}.send`].push(data)
    }

    /**
     * Performs a transparent request from the user.  
     * Checks the existence of a registered customer and 
     * supplements the incoming request with the registration data 
     *
     * @param data Provider message from client 
    */
    inputClientCommand(data: IProviderMessage, providerId: number){
        data.providerId = providerId
        const register = this.providers[providerId][data.clientId]
        if (register === undefined) data.registered = false
        else{ data.registered = true; data.additional = register.additional }
        return this.ports.output['clients.command'].push(data)
    }

    /**
     * Registration of the client and additional client data
    */
    inputClientRegister(data: IRegisterProviderClient, providerId: number){
        this.providers[providerId][data.clientId] = Object.assign({ providerId }, data)
        this.ports.output['clients.register'].push(this.providers[providerId][data.clientId])
    }

    /**
     * UnRegistration client
    */
    inputClientUnregister(data: IUnregisterProviderClient, providerId: number){
        if (this.providers[providerId] && this.providers[providerId][data.clientId]){
            this.ports.output['clients.unregister'].push(this.providers[providerId][data.clientId])
            delete this.providers[providerId][data.clientId]
        }
    }
}
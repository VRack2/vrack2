import { Device, Port, Rule } from "vrack2-core";
import BasicPort from "vrack2-core/lib/ports/BasicPort";
import IGuardMessage from './interfaces/IGuardMessage';
import IRegisteredClient from "./interfaces/IRegisteredClient";
import IBroadcast from "./interfaces/IBroadcast";
import BasicType from "vrack2-core/lib/validator/types/BasicType";

export default class Broadcaster extends Device {

    inputs(): { [key: string]: BasicPort; } {
        return {
            'clients.broadcast%d': Port.standart().dynamic(this.options.broadcastInputs).description('Broadcast to clients port'),
            'clients.register': Port.standart().description('Register client port'),
            'clients.unregister': Port.standart().description('Unregister client port')
        }
    }

    outputs(): { [key: string]: BasicPort; } {
        return {
            'register.command': Port.standart().description('Register command into master'),
            'guard.broadcast': Port.standart().description('Guard broadcast send')
        }
    }

    process(): void {
        this.ports.output['register.command'].push({
            command: 'channelJoin',
            short: 'Join to broadcast channel',
            description: `Provider client join to broadcast channel`,
            level: 3,
            icon: 'send-plus',
            owner: this.type,
            handler: this.apiChannelJoin.bind(this),
            return: Rule.string().default('success').description('Always returns success'),
            rules: { 'channel': Rule.string().maxLength(200).required().example('path.to.channel').description('Channel path like a dot style') },
        })

        this.ports.output['register.command'].push({
            command: 'channelLeave',
            short: 'Leave broadcast channel',
            description: 'Provider client leave broadcast channel',
            level: 3,
            icon: 'send-dash',
            owner: this.type,
            handler: this.apiChannelLeave.bind(this),
            return: Rule.string().default('success').description('Always returns success'),
            rules: { 'channel': Rule.string().maxLength(200).required().example('path.to.channel').description('Channel path like a dot style') },
        })
    }

    checkOptions(): { [key: string]: BasicType; } {
        return {
            'broadcastInputs': Rule.number().min(1).max(100).integer().required().default(8)
        }
    }

    /**
     * A list of channels - and a list of subscribers to those channels. 
     * 
     * Structure: 
     * ```ts
     *  { 
     *      'channel.name': Set<string('ClientProviderHash')>
     *  }
     * ```
     * @see createEntity()
    */

    protected channels = new Map<string, Set<string>>([])
    /**
     * List of subscribers and the channels they are subscribed to. Like channels only in reverse
     * 
     * Structure: 
     * ```ts
     *  { 
     *      'ClientProviderHash': Set<string('channel.name')>
     *  }
     * ```
     * 
     * @see createEntity()
    */
    protected entities = new Map<string, Set<string>>([])

    /**
     * Stores the real providerId and clientId by hash
     * 
     * @see createEntity()
    */
    protected clients = new Map<string, { providerId: number, clientId: number }>()

    preProcess(): void {
        for (let i = 1; i <= this.options.broadcastInputs; i++){
            this.addInputHandler('clients.broadcast' + i, this.inputClientsBroadcast.bind(this))
        }
    }

    /**
     * Sending data to all channel subscribers
     * 
     * @param data Broadcast data 
    */
    inputClientsBroadcast(data: IBroadcast) {
        const cActs = data.channel.split('.')
        const acts = cActs.length
        for (let i = 0; i < acts; i++, cActs.pop()) {
            data.target = cActs.join('.')
            const ch = this.getChannel(data.target)
            for (const value of ch) this.ports.output['guard.broadcast'].push(Object.assign(data, this.clients.get(value)))
        }
    }


    /**
     * Register the provider clients
     * 
     * @param data registration data
    */
    inputClientsRegister(data: IRegisteredClient) {
        const entity = this.createEntity(data.providerId, data.clientId)
        this.getEntity(entity)
    }

    /**
     * Unregister the provider clients
     * 
     * @param data unregistration data
    */
    inputClientsUnregister(data: IRegisteredClient) {
        const entity = this.createEntity(data.providerId, data.clientId)
        if (this.clients.has(entity)) this.clients.delete(entity)
        if (this.entities.has(entity)) this.entities.delete(entity)
    }

    /**
     * Action to connect the client to the channel
     * 
     * @param data Channel settings
    */
    async apiChannelJoin(data: { channel: string }, gData: IGuardMessage) {
        const entity = this.createEntity(gData.providerId, gData.clientId)
        this.getChannel(data.channel).add(entity)
        this.getEntity(entity).add(data.channel)
        return 'success'
    }

    /**
     * Action for disconnecting a client from a channel
     * 
     * @param data Channel settings
    */
    async apiChannelLeave(data: { channel: string }, gData: IGuardMessage) {
        const entity = this.createEntity(gData.providerId, gData.clientId)
        this.getChannel(data.channel).delete(entity)
        this.getEntity(entity).delete(data.channel)
        return 'success'
    }

    /**
     * Return channel clients Set
     * 
     * @param channel Channel string
    */
    protected getChannel(channel: string) {
        if (!this.channels.has(channel)) this.channels.set(channel, new Set())
        const value = this.channels.get(channel)
        if (value === undefined) return new Set<string>()
        return value
    }

    /**
     * Returns the list of connected channels by client hash 
     * 
     * @param entity @see createEntity
    */
    protected getEntity(entity: string) {
        if (!this.entities.has(entity)) this.entities.set(entity, new Set())
        const value = this.entities.get(entity)
        if (value === undefined) return new Set<string>()
        return value
    }
    
    /**
     * Creates a unique hash by providerId & clientId
     * 
     * @param providerId Provider unique ID
     * @param clientId  Client unique ID for this provider
    */
    protected createEntity(providerId: number, clientId: number) {
        const entity = providerId + '.' + clientId
        if (!this.clients.has(entity)) {
            this.clients.set(entity, { providerId, clientId })
        }
        return entity
    }
}
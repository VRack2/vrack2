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
Object.defineProperty(exports, "__esModule", { value: true });
const vrack2_core_1 = require("vrack2-core");
class Broadcaster extends vrack2_core_1.Device {
    constructor() {
        super(...arguments);
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
        this.channels = new Map([]);
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
        this.entities = new Map([]);
        /**
         * Stores the real providerId and clientId by hash
         *
         * @see createEntity()
        */
        this.clients = new Map();
    }
    inputs() {
        return {
            'clients.broadcast%d': vrack2_core_1.Port.standart().dynamic(this.options.broadcastInputs).description('Broadcast to clients port'),
            'clients.register': vrack2_core_1.Port.standart().description('Register client port'),
            'clients.unregister': vrack2_core_1.Port.standart().description('Unregister client port')
        };
    }
    outputs() {
        return {
            'register.command': vrack2_core_1.Port.standart().description('Register command into master'),
            'guard.broadcast': vrack2_core_1.Port.standart().description('Guard broadcast send')
        };
    }
    process() {
        this.ports.output['register.command'].push({
            command: 'channelJoin',
            short: 'Join to broadcast channel',
            description: `Provider client join to broadcast channel`,
            level: 3,
            icon: 'send-plus',
            owner: this.type,
            handler: this.apiChannelJoin.bind(this),
            return: vrack2_core_1.Rule.string().default('success').description('Always returns success'),
            rules: { 'channel': vrack2_core_1.Rule.string().maxLength(200).required().example('path.to.channel').description('Channel path like a dot style') },
        });
        this.ports.output['register.command'].push({
            command: 'channelLeave',
            short: 'Leave broadcast channel',
            description: 'Provider client leave broadcast channel',
            level: 3,
            icon: 'send-dash',
            owner: this.type,
            handler: this.apiChannelLeave.bind(this),
            return: vrack2_core_1.Rule.string().default('success').description('Always returns success'),
            rules: { 'channel': vrack2_core_1.Rule.string().maxLength(200).required().example('path.to.channel').description('Channel path like a dot style') },
        });
    }
    checkOptions() {
        return {
            'broadcastInputs': vrack2_core_1.Rule.number().min(1).max(100).integer().required().default(8)
        };
    }
    preProcess() {
        for (let i = 1; i <= this.options.broadcastInputs; i++) {
            this.addInputHandler('clients.broadcast' + i, this.inputClientsBroadcast.bind(this));
        }
    }
    /**
     * Sending data to all channel subscribers
     *
     * @param data Broadcast data
    */
    inputClientsBroadcast(data) {
        const cActs = data.channel.split('.');
        const acts = cActs.length;
        for (let i = 0; i < acts; i++, cActs.pop()) {
            data.target = cActs.join('.');
            const ch = this.getChannel(data.target);
            for (const value of ch)
                this.ports.output['guard.broadcast'].push(Object.assign(data, this.clients.get(value)));
        }
    }
    /**
     * Register the provider clients
     *
     * @param data registration data
    */
    inputClientsRegister(data) {
        const entity = this.createEntity(data.providerId, data.clientId);
        this.getEntity(entity);
    }
    /**
     * Unregister the provider clients
     *
     * @param data unregistration data
    */
    inputClientsUnregister(data) {
        const entity = this.createEntity(data.providerId, data.clientId);
        if (this.clients.has(entity))
            this.clients.delete(entity);
        if (this.entities.has(entity))
            this.entities.delete(entity);
    }
    /**
     * Action to connect the client to the channel
     *
     * @param data Channel settings
    */
    apiChannelJoin(data, gData) {
        return __awaiter(this, void 0, void 0, function* () {
            const entity = this.createEntity(gData.providerId, gData.clientId);
            this.getChannel(data.channel).add(entity);
            this.getEntity(entity).add(data.channel);
            return 'success';
        });
    }
    /**
     * Action for disconnecting a client from a channel
     *
     * @param data Channel settings
    */
    apiChannelLeave(data, gData) {
        return __awaiter(this, void 0, void 0, function* () {
            const entity = this.createEntity(gData.providerId, gData.clientId);
            this.getChannel(data.channel).delete(entity);
            this.getEntity(entity).delete(data.channel);
            return 'success';
        });
    }
    /**
     * Return channel clients Set
     *
     * @param channel Channel string
    */
    getChannel(channel) {
        if (!this.channels.has(channel))
            this.channels.set(channel, new Set());
        const value = this.channels.get(channel);
        if (value === undefined)
            return new Set();
        return value;
    }
    /**
     * Returns the list of connected channels by client hash
     *
     * @param entity @see createEntity
    */
    getEntity(entity) {
        if (!this.entities.has(entity))
            this.entities.set(entity, new Set());
        const value = this.entities.get(entity);
        if (value === undefined)
            return new Set();
        return value;
    }
    /**
     * Creates a unique hash by providerId & clientId
     *
     * @param providerId Provider unique ID
     * @param clientId  Client unique ID for this provider
    */
    createEntity(providerId, clientId) {
        const entity = providerId + '.' + clientId;
        if (!this.clients.has(entity)) {
            this.clients.set(entity, { providerId, clientId });
        }
        return entity;
    }
}
exports.default = Broadcaster;

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vrack2_core_1 = require("vrack2-core");
class ProvidersClients extends vrack2_core_1.Device {
    constructor() {
        super(...arguments);
        /**
         * Registered information
         *
         * providers[providerId][clientId]
        */
        this.providers = {};
    }
    inputs() {
        return {
            'client%d.command': vrack2_core_1.Port.return()
                .dynamic(this.options.providers)
                .description('Port for clients commands'),
            'client%d.register': vrack2_core_1.Port.standart()
                .dynamic(this.options.providers)
                .description('Register client'),
            'client%d.unregister': vrack2_core_1.Port.standart()
                .dynamic(this.options.providers)
                .description('Unregister client'),
            'client.send': vrack2_core_1.Port.standart()
                .description('Sending a message to a specific client')
        };
    }
    outputs() {
        return {
            'clients.command': vrack2_core_1.Port.return()
                .description('Client command'),
            'clients.register': vrack2_core_1.Port.standart()
                .description('Client register event'),
            'clients.unregister': vrack2_core_1.Port.standart()
                .description('Client unregister event'),
            'provider%d.send': vrack2_core_1.Port.standart().dynamic(this.options.providers)
                .description('Send data to provider')
        };
    }
    checkOptions() {
        return {
            providers: vrack2_core_1.Rule.number().required().integer().min(0).max(10)
        };
    }
    preProcess() {
        for (let i = 1; i <= this.options.providers; i++) {
            this.providers[i] = {};
            this.addInputHandler('client' + i + '.Command', (data) => this.inputClientCommand(data, i));
            this.addInputHandler('client' + i + '.Register', (data) => this.inputClientRegister(data, i));
            this.addInputHandler('client' + i + '.Unregister', (data) => this.inputClientUnregister(data, i));
        }
    }
    /**
     * Sending a message to a specific client
     *
     * It won't do anything if the client doesn't exist
     *
     * @see inputs
    */
    inputClientSend(data) {
        if (data.clientId === undefined || data.providerId === undefined)
            return;
        if (this.providers[data.providerId][data.clientId] === undefined)
            return;
        this.ports.output[`provider${data.providerId}.send`].push(data);
    }
    /**
     * Performs a transparent request from the user.
     * Checks the existence of a registered customer and
     * supplements the incoming request with the registration data
     *
     * @param data Provider message from client
    */
    inputClientCommand(data, providerId) {
        data.providerId = providerId;
        const register = this.providers[providerId][data.clientId];
        if (register === undefined)
            data.registered = false;
        else {
            data.registered = true;
            data.additional = register.additional;
        }
        return this.ports.output['clients.command'].push(data);
    }
    /**
     * Registration of the client and additional client data
    */
    inputClientRegister(data, providerId) {
        this.providers[providerId][data.clientId] = Object.assign({ providerId }, data);
        this.ports.output['clients.register'].push(this.providers[providerId][data.clientId]);
    }
    /**
     * UnRegistration client
    */
    inputClientUnregister(data, providerId) {
        if (this.providers[providerId] && this.providers[providerId][data.clientId]) {
            this.ports.output['clients.unregister'].push(this.providers[providerId][data.clientId]);
            delete this.providers[providerId][data.clientId];
        }
    }
}
exports.default = ProvidersClients;

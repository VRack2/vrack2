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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vrack2_core_1 = require("vrack2-core");
const crypto_1 = __importDefault(require("crypto"));
vrack2_core_1.ErrorManager.register('Guard', 'BJZHVPRFLTUS', 'GUARD_CLIENT_NOT_REGISTERED', 'Somehow it happened that the client was not registered, but a request came from him.', {
    providerId: vrack2_core_1.Rule.number().min(0).integer().required(),
    clientId: vrack2_core_1.Rule.number().min(0).integer().required()
});
vrack2_core_1.ErrorManager.register('Guard', 'CDCQSCNGOONF', 'GUARD_INCORRECT_CLIENT_JSON', 'The client sent data in the request that does not comply with the json format.', {
    err: vrack2_core_1.Rule.string().description('Error message')
});
vrack2_core_1.ErrorManager.register('Guard', 'PBGE8IBZPYSC', 'GUARD_CLIENT_NOT_AUTH', 'You are not authenticated. Please use the apiKeyAuth command before');
vrack2_core_1.ErrorManager.register('Guard', 'OJ2QOE4AR2FP', 'GUARD_VERIFICATION_FAILED', 'Incorrect verification code');
vrack2_core_1.ErrorManager.register('Guard', '41N3V60MZNTJ', 'GUARD_DECIPHER_FAILED', 'Error while decrypting data', {
    error: vrack2_core_1.Rule.string().description('Error description string')
});
vrack2_core_1.ErrorManager.register('Guard', 'TPW82KB3TI2O', 'GUARD_CIPHER_FAILED', 'Error while crypting data', {
    error: vrack2_core_1.Rule.string().description('Error description string')
});
vrack2_core_1.ErrorManager.register('Guard', 'MGYZHDMPBOBR', 'GUARD_PRIVATE_VERIFICATION_FAILED', 'Error while decrypting data');
class Guard extends vrack2_core_1.Device {
    constructor() {
        super(...arguments);
        this.guardedClients = {};
    }
    inputs() {
        return {
            'clients.command': vrack2_core_1.Port.return().description('Command sending port from Clients'),
            'clients.register': vrack2_core_1.Port.standart().description('Register Clients port'),
            'clients.unregister': vrack2_core_1.Port.standart().description('Unregister Clients port'),
            'broadcast': vrack2_core_1.Port.standart().description('Port for send broadcast to clients'),
        };
    }
    outputs() {
        return {
            'master.command': vrack2_core_1.Port.return().description('Port for master commands'),
            'register.command': vrack2_core_1.Port.standart().description('Register command into master'),
            'client.send': vrack2_core_1.Port.standart().description('Send data to client'),
        };
    }
    checkOptions() {
        return {
        // providers: Rule.number().required().integer().min(0).max(10)
        };
    }
    process() {
        this.ports.output['register.command'].push({
            command: 'apiKeyAuth',
            short: 'Api Client authorize',
            description: 'Basic client identification command. Requires a special identification key. If the key uses encryption, returns a special private key verification string. See apiPrivateAuth',
            level: 1000,
            owner: this.type,
            icon: 'person-fill-exclamation',
            handler: this.apiKeyAuth.bind(this),
            rules: {
                key: vrack2_core_1.Rule.string().maxLength(32).example('default').description('Client authentication key'),
            },
            return: vrack2_core_1.Rule.object().fields({
                cipher: vrack2_core_1.Rule.boolean().default(false).description('Does authorization require encryption?'),
                verify: vrack2_core_1.Rule.string().example('9u49ipjeirhh').description('If this line is specified, you need to go through additional authorization with encryption'),
                level: vrack2_core_1.Rule.number().example(3).description('If the level is specified, then authorization was successful'),
                authorize: vrack2_core_1.Rule.boolean().default(false).description('If the level is specified, then authorization was successful.'),
            }).description('Success authorized result')
        });
        this.ports.output['register.command'].push({
            command: 'apiPrivateAuth',
            short: 'Authorize with encrypt',
            description: '',
            level: 1000,
            owner: this.type,
            icon: 'person-fill-lock',
            handler: this.apiPrivateAuth.bind(this),
            rules: {
                verify: vrack2_core_1.Rule.string().maxLength(120).example('f2kngj3tjl...==').description('Encrypted string using private key'),
            },
            return: vrack2_core_1.Rule.object().fields({
                cipher: vrack2_core_1.Rule.boolean().default(true).description('Does authorization require encryption?'),
                level: vrack2_core_1.Rule.number().example(3).description('If the level is specified, then authorization was successful'),
                authorize: vrack2_core_1.Rule.boolean().default(true).description('If the level is specified, then authorization was successful.'),
            }).description('Success authorized result')
        });
    }
    /**
     * Command apiKeyAuth
     *
     * Performs basic user authentication.
     * It is a basic and mandatory command for any user.
     * It is practically the only and first command that the user must perform
     *
     * To pass authorization, you need to send a key string.
     *
     * If the key is private, a string will be returned that must be encrypted
     * with a private key and returned to the apiPrivateAuth command
     *
     * @see Guard.process
    */
    apiKeyAuth(data, message) {
        return __awaiter(this, void 0, void 0, function* () {
            const client = this.getClient(message);
            const req = {
                providerType: 'Guard',
                providerId: 0,
                clientId: 0,
                command: 'apiKey',
                level: 0,
                data: { key: data.key }
            };
            const key = yield this.ports.output['master.command'].push(req);
            client.key = key;
            if (key.private) {
                client.private = key.private;
                client.cipher = false;
                client.verify = this.uid(8);
                return { verify: client.verify, cipher: true };
            }
            return this.autorize(client);
        });
    }
    /**
     * Command apiPrivateAuth
     *
     * The second authorization command to switch to encrypted communication mode
     * If the private key was recognized correctly, the next message will already use encryption.
     *
     *
     * 'verify' string to verify the authorization that the client encrypted with its key.
     * This string should have been received after the “apiKeyAuth” command.
     *
     * @see Guard.process
     * @see apiKeyAuth
     * @param data Client data with verify string
     */
    apiPrivateAuth(data, message) {
        return __awaiter(this, void 0, void 0, function* () {
            const client = this.getClient(message);
            try {
                const decr = this.decipherData(data.verify, client);
                if (decr === client.verify)
                    return this.autorize(client, true);
            }
            catch (error) {
                throw vrack2_core_1.ErrorManager.make('GUARD_DECIPHER_FAILED', {
                    error: error.toString()
                });
            }
            throw vrack2_core_1.ErrorManager.make('GUARD_PRIVATE_VERIFICATION_FAILED');
        });
    }
    /**
     * Processes commands coming from providers clients
     *
     * Receives messages from the client, decrypts them and sends the command to the master for execution
     * It encrypts the result of the wizard execution and returns it back to the Provider
     *
     * @param data Provider client message
    */
    inputClientsCommand(data) {
        return __awaiter(this, void 0, void 0, function* () {
            let client;
            let clientData;
            try {
                client = this.getClient(data);
                clientData = JSON.parse(this.decipherData(data.data, client));
            }
            catch (error) {
                if (error instanceof vrack2_core_1.CoreError)
                    return this.response(client, {}, 'error', error);
                return this.response(client, {}, 'error', vrack2_core_1.ErrorManager.make('GUARD_INCORRECT_CLIENT_JSON', { err: error.message }));
            }
            Object.assign(clientData, {
                providerType: data.providerType,
                providerId: data.providerId,
                clientId: data.clientId,
                level: client.level
            });
            try {
                const result = yield this.ports.output['master.command'].push(clientData);
                data.data = this.response(client, clientData, 'success', result);
            }
            catch (error) {
                data.data = this.response(client, clientData, 'error', error);
            }
            return data;
        });
    }
    /**
     * Sends a broadcast message personally to the customer.
     *
     * @param data Broadcast message
    */
    inputBroadcast(data) {
        if (data.clientId === undefined || data.providerId === undefined)
            return;
        if (!this.guardedClients[data.providerId] || !this.guardedClients[data.providerId][data.clientId])
            return;
        const stData = this.cipherData(JSON.stringify(data), this.guardedClients[data.providerId][data.clientId]);
        const send = {
            registered: true,
            providerType: '',
            clientId: data.clientId,
            providerId: data.providerId,
            data: stData
        };
        this.ports.output['client.send'].push(send);
    }
    /**
     * Registration of a new client of the provider
     *
     * @param data Client information
    */
    inputClientsRegister(data) {
        if (!this.guardedClients[data.providerId])
            this.guardedClients[data.providerId] = {};
        this.guardedClients[data.providerId][data.clientId] = Object.assign({
            authorize: false, cipher: false, private: '', level: 1000, verify: ''
        }, data);
    }
    /**
     *  Unregistratio client of the provider
     *
     * @param data Client information
    */
    inputClientsUnregister(data) {
        if (!this.guardedClients[data.providerId] || this.guardedClients[data.providerId][data.clientId])
            return;
        delete this.guardedClients[data.providerId][data.clientId];
    }
    /**
     * client authorization.
     *
     * client authorization. Assigns flags and parameters to the client during authorization
     *
     * @param client Internal guard client information
    */
    autorize(client, cipher = false) {
        var _a;
        if (!client.key)
            throw vrack2_core_1.ErrorManager.make('GUARD_CLIENT_NOT_AUTH');
        client.authorize = true;
        client.cipher = cipher;
        client.level = (_a = client.key) === null || _a === void 0 ? void 0 : _a.level;
        return { level: client.level, cipher };
    }
    /**
     * Generates a response to the client that requested the data using the provider.
     *
     * @see inputClientsCommand
    */
    response(client, request, result, resultData) {
        request.result = result;
        if (result === 'error')
            request.resultData = vrack2_core_1.CoreError.objectify(resultData);
        else
            request.resultData = resultData;
        let ret = JSON.stringify(request);
        if (client === undefined)
            return ret;
        if (client.cipher)
            ret = this.cipherData(ret, client);
        return ret;
    }
    /**
     * Getting an internal client
     *
     * If the client was not found, it will throw a GUARD_CLIENT_NOT_REGISTERED exception
     * @param message Message
    */
    getClient(message) {
        if (!this.guardedClients[message.providerId] || !this.guardedClients[message.providerId][message.clientId]) {
            throw vrack2_core_1.ErrorManager.make('GUARD_CLIENT_NOT_REGISTERED', {
                providerId: message.providerId,
                clientId: message.clientId
            });
        }
        return this.guardedClients[message.providerId][message.clientId];
    }
    /**
     * Decrypts data coming from the client
     *
     * @see apiPrivateAuth
    */
    decipherData(data, client) {
        if (!client.cipher)
            return data.toString('utf8');
        if (!client.key) {
            throw vrack2_core_1.ErrorManager.make('GUARD_DECIPHER_FAILED', { error: 'Key in client not found' });
        }
        const cipher = crypto_1.default.createDecipheriv('aes-256-cbc', client.key.private, client.key.key);
        cipher.setEncoding('base64');
        let decrypted = '';
        decrypted += cipher.update(data.toString('utf-8'), 'base64');
        decrypted += cipher.final('utf8');
        return decrypted;
    }
    /**
     * Encrypting data before sending to the client
     *
     * @see apiPrivateAuth
    */
    cipherData(data, client) {
        if (!client.cipher)
            return data;
        if (!client.key) {
            throw vrack2_core_1.ErrorManager.make('GUARD_CIPHER_FAILED', { error: 'Key in client not found' });
        }
        const cipher = crypto_1.default.createCipheriv('aes-256-cbc', client.key.private, client.key.key);
        cipher.setEncoding('utf8');
        let encrypted = '';
        encrypted += cipher.update(data, 'utf8', 'base64');
        encrypted += cipher.final('base64');
        return encrypted;
    }
    /**
     * Generates a random string for encryption and subsequent authorization check
     *
     * @param length Number of character pairs
    */
    uid(length) {
        return crypto_1.default.randomBytes(length).toString('hex');
    }
}
exports.default = Guard;

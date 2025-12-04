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
const path_1 = __importDefault(require("path"));
const process_1 = __importDefault(require("process"));
const fs_1 = __importDefault(require("fs"));
const crypto_1 = __importDefault(require("crypto"));
const defaultKey = {
    id: 'caff46ebd619c872e4cf',
    name: 'default',
    description: 'Default administrator api key',
    level: 1,
    key: 'default',
    private: ''
};
vrack2_core_1.ErrorManager.register('KeyManager', '8CDGXUV915LH', 'AKEYM_KEY_NOT_FOUND', 'A non-existent key identifier was specified.');
/**
 * Access Key Manager.
 *
 * Allows you to add/remove/receive access keys for VRack2
 * Guard also uses this device to reconcile and authorize keys
*/
class KeyManager extends vrack2_core_1.Device {
    constructor() {
        super(...arguments);
        /**
         * Path to the key file - it is better to define it once and use it once
        */
        this.keysFilePath = '';
        /** List of access keys */
        this.keys = [];
    }
    outputs() {
        return {
            'register.command': vrack2_core_1.Port.standart().description('Register command into master'),
        };
    }
    checkOptions() {
        return {
            keysPath: vrack2_core_1.Rule.string().required().default('./keys.json').description('Path to keys json file')
        };
    }
    process() {
        /** Load access keys at start */
        this.loadKeys();
        /**
         * Internal command
         * */
        this.ports.output['register.command'].push({
            command: 'apiKey',
            short: 'Return key of key',
            description: 'Private local method for get key info',
            level: 0,
            owner: this.type,
            handler: this.apiKey.bind(this),
            rules: {},
        });
        this.ports.output['register.command'].push({
            command: 'apiKeyList',
            short: 'Get all keys',
            description: 'Returns a list of all keys',
            level: 1,
            icon: "filetype-key",
            owner: this.type,
            handler: this.apiKeyList.bind(this),
            rules: {},
            return: vrack2_core_1.Rule.array().content(vrack2_core_1.Rule.object().fields({
                id: vrack2_core_1.Rule.string().example('qjkl13j5klj').description('Unique key ID'),
                name: vrack2_core_1.Rule.string().example('Lang name').description('Short unique lang name for this key'),
                description: vrack2_core_1.Rule.string().example('Use description').description('Description of the purpose of the key'),
                level: vrack2_core_1.Rule.number().example(3).integer().description('Key access level. Can be 1/2/3/1000 by default'),
                key: vrack2_core_1.Rule.string().example('rlmtjpopefe').description('Key for access to VRack2'),
                private: vrack2_core_1.Rule.string().example('nrono3bgo2112knj4ngkj').description('Key for traffic encryption')
            }))
                .description('Return a List of all keys')
        });
        this.ports.output['register.command'].push({
            command: 'apiKeyAdd',
            short: 'Add key',
            description: 'Add new api key',
            level: 1,
            owner: this.type,
            icon: 'key-fill',
            handler: this.apiKeyAdd.bind(this),
            rules: {
                'level': vrack2_core_1.Rule.number().required().example(3)
                    .description('Access level for new api key'),
                'name': vrack2_core_1.Rule.string().maxLength(200).required().example('testname')
                    .description('New name for key'),
                'description': vrack2_core_1.Rule.string().maxLength(2500).example('Test description key')
                    .description('New description for key'),
                'cipher': vrack2_core_1.Rule.boolean().required().example(false)
                    .description('Access level for new api key'),
            },
            return: vrack2_core_1.Rule.object().fields({
                id: vrack2_core_1.Rule.string().example('qjkl13j5klj').description('Unique key ID'),
                name: vrack2_core_1.Rule.string().example('Lang name').description('Short unique lang name for this key'),
                description: vrack2_core_1.Rule.string().example('Use description').description('Description of the purpose of the key'),
                level: vrack2_core_1.Rule.number().example(3).integer().description('Key access level. Can be 1/2/3/1000 by default'),
                key: vrack2_core_1.Rule.string().example('rlmtjpopefe').description('Key for access to VRack2'),
                private: vrack2_core_1.Rule.string().example('nrono3bgo2112knj4ngkj').description('Key for traffic encryption')
            })
        });
        this.ports.output['register.command'].push({
            command: 'apiKeyUpdate',
            short: 'Update key info',
            description: 'Command for update only name and description of key',
            level: 1,
            icon: 'pen',
            owner: this.type,
            handler: this.apiKeyUpdate.bind(this),
            rules: {
                'id': vrack2_core_1.Rule.string().maxLength(200).required().example('caff46ebd619c872e4cf')
                    .description('Unique key id, see apiKeyList command'),
                'name': vrack2_core_1.Rule.string().maxLength(200).required().example('testname')
                    .description('New name for key'),
                'description': vrack2_core_1.Rule.string().maxLength(2500).example('Test description key')
                    .description('New description for key'),
            },
            return: vrack2_core_1.Rule.string().default('success').description('Always return success string')
        });
        this.ports.output['register.command'].push({
            command: 'apiKeyDelete',
            short: 'Delete key',
            description: 'Delete api key',
            level: 1,
            owner: this.type,
            icon: 'key',
            handler: this.apiKeyDelete.bind(this),
            rules: {
                'id': vrack2_core_1.Rule.string().maxLength(200).required().example('caff46ebd619c872e4cf')
                    .description('Unique key id, see apiKeyList command'),
            },
            return: vrack2_core_1.Rule.string().default('success').description('Always return success string')
        });
    }
    /**
     * Returns a list of all access keys along with private keys
    */
    apiKeyList() {
        return __awaiter(this, void 0, void 0, function* () {
            return this.keys;
        });
    }
    /**
     * Request to add a new key. The key is generated by itself.
     * You can only assign a level, name and description.
     * The last flag can be used to specify that VRack2 generates a private key
     *
     * @see KeyManager.process() Register command apiKeyAdd
    */
    apiKeyAdd(data) {
        return __awaiter(this, void 0, void 0, function* () {
            const nKey = {
                id: this.uid(10),
                name: data.name,
                description: data.description,
                level: data.level,
                key: this.uid(8),
                private: data.cipher ? this.uid(16) : ''
            };
            this.keys.push(nKey);
            this.syncKeys();
            return nKey;
        });
    }
    /**
     * Return full key info by key
     * This command is completely internal and is only used in Guard
     * Note - registration of this command has access level - 0 and can only be called inside VRack2
     *
    */
    apiKey(data) {
        return __awaiter(this, void 0, void 0, function* () {
            for (let i = 0; i < this.keys.length; i++)
                if (this.keys[i].key === data.key)
                    return this.keys[i];
            throw vrack2_core_1.ErrorManager.make('AKEYM_KEY_NOT_FOUND');
        });
    }
    /**
     * Allows you to update the readable name and description of a key by its ID
     * @return {string} 'success'
    */
    apiKeyUpdate(data) {
        return __awaiter(this, void 0, void 0, function* () {
            const key = this.getKey(data.id);
            if (!key)
                throw vrack2_core_1.ErrorManager.make('AKEYM_KEY_NOT_FOUND');
            key.name = data.name;
            key.description = data.description;
            this.syncKeys();
            return 'success';
        });
    }
    /**
     * Deletes a key from the key list
     * @return {string} 'success'
    */
    apiKeyDelete(data) {
        return __awaiter(this, void 0, void 0, function* () {
            const key = this.getKey(data.id);
            if (!key)
                throw vrack2_core_1.ErrorManager.make('AKEYM_KEY_NOT_FOUND');
            for (let i = 0; i < this.keys.length; i++)
                if (this.keys[i].id === data.id)
                    this.keys.splice(i, 1);
            this.syncKeys();
            return 'success';
        });
    }
    /**
     * Loading keys from a key file
     *
     * @see KeyManager.checkOptions
     */
    loadKeys() {
        this.keysFilePath = path_1.default.join(process_1.default.cwd(), this.options.keysPath);
        if (!fs_1.default.existsSync(this.keysFilePath)) {
            this.keys = [defaultKey];
        }
        else {
            this.keys = JSON.parse(fs_1.default.readFileSync(this.keysFilePath).toString('utf-8'));
        }
    }
    /**
     * Find key by id
    */
    getKey(id) {
        for (const key of this.keys)
            if (key.id === id)
                return key;
        return false;
    }
    /**
     * Write (update) keys file
    */
    syncKeys() {
        fs_1.default.writeFileSync(this.keysFilePath, JSON.stringify(this.keys));
    }
    /**
     * Generates a random string
     *
     * @param length Number of character pairs
    */
    uid(length) {
        return crypto_1.default.randomBytes(length).toString('hex');
    }
}
exports.default = KeyManager;

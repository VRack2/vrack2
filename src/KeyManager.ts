import { CoreError, Device, ErrorManager, Port, Rule, Validator } from "vrack2-core";

import BasicPort from "vrack2-core/lib/ports/BasicPort";
import BasicType from "vrack2-core/lib/validator/types/BasicType";

import path from 'path'
import process from "process";
import fs from 'fs'
import crypto from 'crypto'
import IApiKey from "./interfaces/IApiKey";

const defaultKey: IApiKey = {
    id: 'caff46ebd619c872e4cf',
    name: 'default',
    description: 'Default administrator api key',
    level: 1,
    key: 'default',
    private: ''
}

ErrorManager.register(
    'KeyManager',
    '8CDGXUV915LH',
    'AKEYM_KEY_NOT_FOUND',
    'A non-existent key identifier was specified.'
)

/**
 * Access Key Manager. 
 * 
 * Allows you to add/remove/receive access keys for VRack2
 * Guard also uses this device to reconcile and authorize keys
*/
export default class KeyManager extends Device {

    outputs(): { [key: string]: BasicPort; } {
        return {
            'register.command': Port.standart().description('Register command into master'),
        }
    }
    
    checkOptions(): { [key: string]: BasicType; } {
        return {
            keysPath: Rule.string().require().default('./keys.json').description('Path to keys json file')
        }
    }
    
    /**
     * Path to the key file - it is better to define it once and use it once
    */
    protected keysFilePath = ''

    /** List of access keys */
    protected keys : Array<IApiKey> = []

    process(): void {
        /** Load access keys at start */
        this.loadKeys()

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
            rules: {  },
        })

        this.ports.output['register.command'].push({
            command: 'apiKeyList',
            short: 'Get all keys',
            description: 'Returns a list of all keys',
            level: 1,
            icon: "filetype-key",
            owner: this.type,
            handler: this.apiKeyList.bind(this),
            rules: {  },
            return: Rule.array().content(Rule.object().fields({
                id: Rule.string().example('qjkl13j5klj').description('Unique key ID'),
                name: Rule.string().example('Lang name').description('Short unique lang name for this key'),
                description: Rule.string().example('Use description').description('Description of the purpose of the key'),
                level: Rule.number().example(3).integer().description('Key access level. Can be 1/2/3/1000 by default'),
                key: Rule.string().example('rlmtjpopefe').description('Key for access to VRack2'),
                private: Rule.string().example('nrono3bgo2112knj4ngkj').description('Key for traffic encryption')
            }))
            .description('Return a List of all keys')
        })

        this.ports.output['register.command'].push({
            command: 'apiKeyAdd',
            short: 'Add key',
            description: 'Add new api key',
            level: 1,
            owner: this.type,
            icon: 'key-fill',
            handler: this.apiKeyAdd.bind(this),
            rules: { 
                'level': Rule.number().require().example(3)
                    .description('Access level for new api key'),
                'name': Rule.string().maxLength(200).require().example('testname')
                    .description('New name for key'),
                'description': Rule.string().maxLength(2500).example('Test description key')
                    .description('New description for key'),
                'cipher': Rule.boolean().require().example(false)
                    .description('Access level for new api key'),
            },
            return: Rule.object().fields({
                id: Rule.string().example('qjkl13j5klj').description('Unique key ID'),
                name: Rule.string().example('Lang name').description('Short unique lang name for this key'),
                description: Rule.string().example('Use description').description('Description of the purpose of the key'),
                level: Rule.number().example(3).integer().description('Key access level. Can be 1/2/3/1000 by default'),
                key: Rule.string().example('rlmtjpopefe').description('Key for access to VRack2'),
                private: Rule.string().example('nrono3bgo2112knj4ngkj').description('Key for traffic encryption')
            })
        })

        this.ports.output['register.command'].push({
            command: 'apiKeyUpdate',
            short: 'Update key info',
            description: 'Command for update only name and description of key',
            level: 1,
            icon: 'pen',
            owner: this.type,
            handler: this.apiKeyUpdate.bind(this),
            rules: { 
                'id': Rule.string().maxLength(200).require().example('caff46ebd619c872e4cf')
                    .description('Unique key id, see apiKeyList command'),
                'name': Rule.string().maxLength(200).require().example('testname')
                    .description('New name for key'),
                'description': Rule.string().maxLength(2500).example('Test description key')
                    .description('New description for key'),
            },
            return: Rule.string().default('success').description('Always return success string')
        })

        this.ports.output['register.command'].push({
            command: 'apiKeyDelete',
            short: 'Delete key',
            description: 'Delete api key',
            level: 1,
            owner: this.type,
            icon: 'key',
            handler: this.apiKeyDelete.bind(this),
            rules: { 
                'id': Rule.string().maxLength(200).require().example('caff46ebd619c872e4cf')
                .description('Unique key id, see apiKeyList command'),
            },
            return: Rule.string().default('success').description('Always return success string')
        })
    }

    /**
     * Returns a list of all access keys along with private keys
    */
    async apiKeyList() {
        return this.keys
    }

    /**
     * Request to add a new key. The key is generated by itself. 
     * You can only assign a level, name and description.
     * The last flag can be used to specify that VRack2 generates a private key
     * 
     * @see KeyManager.process() Register command apiKeyAdd
    */
    async apiKeyAdd(data: { level: number, name:string, description:string, cipher: boolean }){
        const nKey: IApiKey = {
            id: this.uid(10),
            name: data.name,
            description: data.description,
            level: data.level,
            key: this.uid(8),
            private: data.cipher?this.uid(16):''
        }
        this.keys.push(nKey)
        this.syncKeys()
        return nKey
    }

    /**
     * Return full key info by key
     * This command is completely internal and is only used in Guard
     * Note - registration of this command has access level - 0 and can only be called inside VRack2
     * 
    */
    async apiKey(data: { key:string}){
        for (let i= 0; i< this.keys.length; i++) 
            if (this.keys[i].key === data.key)
                return this.keys[i]
        throw ErrorManager.make('AKEYM_KEY_NOT_FOUND')
    }

    /**
     * Allows you to update the readable name and description of a key by its ID
     * @return {string} 'success'
    */
    async apiKeyUpdate(data: {id: string, name: string, description: string}) {
        const key = this.getKey(data.id)
        if (!key) throw ErrorManager.make('AKEYM_KEY_NOT_FOUND')
        key.name = data.name
        key.description = data.description
        this.syncKeys()
        return 'success'
    }

    /**
     * Deletes a key from the key list 
     * @return {string} 'success'
    */
    async apiKeyDelete(data: {id: string}) {
        const key = this.getKey(data.id)
        if (!key) throw ErrorManager.make('AKEYM_KEY_NOT_FOUND')
        for (let i= 0; i< this.keys.length; i++) 
            if (this.keys[i].id === data.id) 
                this.keys.splice(i, 1)
        this.syncKeys()
        return 'success'
    }
    
    /** 
     * Loading keys from a key file 
     * 
     * @see KeyManager.checkOptions
     */
    protected loadKeys () {
        this.keysFilePath = path.join(process.cwd(), this.options.keysPath)
        if (!fs.existsSync(this.keysFilePath)) {
          this.keys = [defaultKey]
        } else {
          this.keys = JSON.parse(fs.readFileSync(this.keysFilePath).toString('utf-8'))
        }
    }

    /** 
     * Find key by id
    */
    protected getKey(id: string){
        for (const key of this.keys) if (key.id === id) return key
        return false
    }

    /**
     * Write (update) keys file
    */
    protected syncKeys () {
        fs.writeFileSync(this.keysFilePath, JSON.stringify(this.keys))
    }

    /**
     * Generates a random string
     * 
     * @param length Number of character pairs
    */
    protected uid(length: number){
        return crypto.randomBytes(length).toString('hex')
    }
}
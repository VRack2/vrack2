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
vrack2_core_1.ErrorManager.register('Master', 'QHALOLOQBEMN', 'MASTER_COMMAND_NOT_FOUND', 'The master did not find a suitable registered command', {
    command: vrack2_core_1.Rule.string().description('Input command')
});
vrack2_core_1.ErrorManager.register('Master', 'URDWFPFHKEAA', 'MASTER_NO_REQ_DATA', 'It is necessary to specify the command and the data for it');
vrack2_core_1.ErrorManager.register('Master', 'ZEAJYEQFWCUM', 'MASTER_ACCESS_DENIED', 'You need to raise the access level to execute this command', {
    level: vrack2_core_1.Rule.number().description('Requiered level')
});
vrack2_core_1.ErrorManager.register('Master', 'JTTWDXLMPKXD', 'MASTER_ERROR_VALIDATION', 'The data does not meet the teams requirements');
class Master extends vrack2_core_1.Device {
    constructor() {
        super(...arguments);
        this.commands = {};
    }
    inputs() {
        const ports = {
            'command%d': vrack2_core_1.Port.return().dynamic(this.options.commandPorts).requirement(vrack2_core_1.Rule.object().example({}).description('')),
            'register%d': vrack2_core_1.Port.standart().dynamic(this.options.registerPorts)
        };
        return ports;
    }
    outputs() {
        const ports = {
            submaster: vrack2_core_1.Port.return().description('Submaster port')
        };
        return ports;
    }
    checkOptions() {
        return {
            commandPorts: vrack2_core_1.Rule.number().min(0).max(100).integer().default(8).require()
                .description('Count of ports for run command'),
            registerPorts: vrack2_core_1.Rule.number().min(0).max(100).integer().default(8).require()
                .description('Count of ports for registers command')
        };
    }
    preProcess() {
        for (let i = 1; i <= this.options.registerPorts; i++) {
            this.addInputHandler('register' + i, (data) => {
                this.commands[data.command] = data;
            });
        }
        for (let i = 1; i <= this.options.commandPorts; i++) {
            this.addInputHandler('command' + i, (data) => {
                return this.inputCommand(data);
            });
        }
    }
    process() {
        this.commands['commandsList'] = {
            command: 'commandsList',
            short: 'Master command list',
            description: 'Return all command registered',
            level: 1000,
            icon: 'list-ul',
            owner: this.type,
            return: vrack2_core_1.Rule.array().content(vrack2_core_1.Rule.object().fields({
                command: vrack2_core_1.Rule.string().example('commandName').description('Command name/identifier'),
                description: vrack2_core_1.Rule.string().example('Markdown command description').description('Command description'),
                level: vrack2_core_1.Rule.number().integer().example(3).description('Level for access this command'),
                rules: vrack2_core_1.Rule.array().example([]).content(vrack2_core_1.Rule.object().description('Rule Object')).description('Array Rules object for validation data for this command'),
                owner: vrack2_core_1.Rule.string().example('Master').description('Owner devices of this command'),
                short: vrack2_core_1.Rule.string().example('Short Name').description('Short description (3-5 words)'),
                icon: vrack2_core_1.Rule.string().example('sd-card').description('Bootstrap icon (without bi- class only end like a "search","sd-card","share" & etc )'),
                return: vrack2_core_1.Rule.object().example('any').description('Rule object of return type'),
            })).description('Array contain all command for this master'),
            handler: this.apiCommandList.bind(this),
        };
    }
    /**
     * Returns the list of Master commands
    */
    apiCommandList() {
        return __awaiter(this, void 0, void 0, function* () {
            const ret = {};
            for (const comm in this.commands) {
                const command = this.commands[comm];
                if (command.level === 0)
                    continue;
                ret[comm] = {
                    command: command.command,
                    description: command.description,
                    level: command.level,
                    rules: command.rules,
                    owner: command.owner,
                    short: command.short,
                    icon: command.icon,
                    return: command.return,
                };
            }
            return ret;
        });
    }
    /**
     * Executes a registered master command.
     * If the master does not find the command - it will try to execute the submaster command
     *
     * @param data  Command data that comes from the Guard
    */
    inputCommand(data) {
        return __awaiter(this, void 0, void 0, function* () {
            if ((data.command === undefined || typeof data.command !== 'string') ||
                (data.data === undefined || typeof data.data !== 'object')) {
                throw vrack2_core_1.ErrorManager.make('MASTER_NO_REQ_DATA').setTrace(new Error());
            }
            if (!this.commands[data.command]) {
                if (this.ports.output['submaster'].connected) {
                    return yield this.ports.output['submaster'].push(data);
                }
                throw vrack2_core_1.ErrorManager.make('MASTER_COMMAND_NOT_FOUND', { command: data.command }).setTrace(new Error());
            }
            const command = this.commands[data.command];
            if (data.level > command.level)
                throw vrack2_core_1.ErrorManager.make('MASTER_ACCESS_DENIED', { level: command.level });
            if (command.rules !== undefined) {
                try {
                    vrack2_core_1.Validator.validate(command.rules, data.data);
                }
                catch (error) {
                    const vError = vrack2_core_1.ErrorManager.make('MASTER_ERROR_VALIDATION').setTrace(new Error());
                    if (error instanceof vrack2_core_1.CoreError)
                        vError.add(error);
                    throw vError;
                }
            }
            const res = yield command.handler(data.data, data);
            return res;
        });
    }
}
exports.default = Master;

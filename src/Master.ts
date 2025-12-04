import { CoreError, Device, ErrorManager, Port, Rule, Validator } from "vrack2-core";
import BasicPort from "vrack2-core/lib/ports/BasicPort";
import IGuardMessage from "./interfaces/IGuardMessage";
import BasicType from "vrack2-core/lib/validator/types/BasicType";
import ICommandRegister from "./interfaces/ICommandRegister";

ErrorManager.register(
  'Master',
  'QHALOLOQBEMN',
  'MASTER_COMMAND_NOT_FOUND',
  'The master did not find a suitable registered command',
  {
    command: Rule.string().description('Input command')
  }
)

ErrorManager.register(
  'Master',
  'URDWFPFHKEAA',
  'MASTER_NO_REQ_DATA',
  'It is necessary to specify the command and the data for it',
)

ErrorManager.register(
  'Master',
  'ZEAJYEQFWCUM',
  'MASTER_ACCESS_DENIED',
  'You need to raise the access level to execute this command',
  {
    level: Rule.number().description('Requiered level')
  }
)

ErrorManager.register(
  'Master',
  'JTTWDXLMPKXD',
  'MASTER_ERROR_VALIDATION',
  'The data does not meet the teams requirements'
)


export interface ICommandExport {
  command: string
  description: string
  level: number
  owner?: string
  short?: string
  icon?: string
  rules?: { [key: string]: BasicType; }
  return?:  BasicType
}

export default class Master extends Device {

  commands: { [key: string]: ICommandRegister } = {}

  inputs(): { [key: string]: BasicPort; } {
    const ports: { [key: string]: BasicPort; } = {
      'command%d': Port.return().dynamic(this.options.commandPorts).requirement(Rule.object().example({}).description('')),
      'register%d': Port.standart().dynamic(this.options.registerPorts)
    }
    return ports
  }

  outputs(): { [key: string]: BasicPort; } {
    const ports: { [key: string]: BasicPort; } = {
      submaster: Port.return().description('Submaster port')
    }
    return ports
  }

  checkOptions(): { [key: string]: BasicType; } {
    return {
      commandPorts: Rule.number().min(0).max(100).integer().default(8).required()
        .description('Count of ports for run command'),
      registerPorts: Rule.number().min(0).max(100).integer().default(8).required()
        .description('Count of ports for registers command')
    }
  }

  preProcess(): void {
    for (let i = 1; i <= this.options.registerPorts; i++) {
      this.addInputHandler('register' + i, (data: ICommandRegister) => {
        this.commands[data.command] = data
      })
    }

    for (let i = 1; i <= this.options.commandPorts; i++) {
      this.addInputHandler('command' + i, (data: IGuardMessage) => {
        return this.inputCommand(data)
      })
    }

  }

  process(): void {
    this.commands['commandsList'] = {
      command: 'commandsList',
      short: 'Master command list',
      description: 'Return all command registered',
      level: 1000,
      icon:'list-ul',
      owner: this.type,
      return: Rule.array().content(Rule.object().fields({
        command: Rule.string().example('commandName').description('Command name/identifier'),
        description: Rule.string().example('Markdown command description').description('Command description'),
        level: Rule.number().integer().example(3).description('Level for access this command'),
        rules: Rule.array().example([]).content(Rule.object().description('Rule Object')).description('Array Rules object for validation data for this command'),
        owner: Rule.string().example('Master').description('Owner devices of this command'),
        short: Rule.string().example('Short Name').description('Short description (3-5 words)'),
        icon: Rule.string().example('sd-card').description('Bootstrap icon (without bi- class only end like a "search","sd-card","share" & etc )'),
        return: Rule.object().example('any').description('Rule object of return type'),
      })).description('Array contain all command for this master'),
      handler: this.apiCommandList.bind(this),
    }
  }

  /**
   * Returns the list of Master commands
  */
  async apiCommandList() {
    const ret: { [key: string]: ICommandExport } = {}
    for (const comm in this.commands) {
      const command = this.commands[comm]
      if (command.level === 0) continue
      ret[comm] = {
        command: command.command,
        description: command.description,
        level: command.level,
        rules: command.rules,
        owner: command.owner,
        short: command.short,
        icon: command.icon,
        return: command.return,
      }
    }
    return ret
  }


  /**
   * Executes a registered master command. 
   * If the master does not find the command - it will try to execute the submaster command
   * 
   * @param data  Command data that comes from the Guard
  */
  async inputCommand(data: IGuardMessage) {
    if ((data.command === undefined || typeof data.command !== 'string') ||
      (data.data === undefined || typeof data.data !== 'object')) {
      throw ErrorManager.make('MASTER_NO_REQ_DATA').setTrace(new Error())
    }

    if (!this.commands[data.command]) {
      if (this.ports.output['submaster'].connected) {
        return await this.ports.output['submaster'].push(data)
      }
      throw ErrorManager.make('MASTER_COMMAND_NOT_FOUND', { command: data.command }).setTrace(new Error())
    }
    const command = this.commands[data.command]
    if (data.level > command.level) throw ErrorManager.make('MASTER_ACCESS_DENIED', { level: command.level })
    if (command.rules !== undefined) {
      try {
        Validator.validate(command.rules, data.data)
      } catch (error) {
        const vError = ErrorManager.make('MASTER_ERROR_VALIDATION').setTrace(new Error())
        if (error instanceof CoreError) vError.add(error)
        throw vError
      }
    }
    const res = await command.handler(data.data, data)
    return res
  }
}
import { Device } from "vrack2-core";
import BasicPort from "vrack2-core/lib/ports/BasicPort";
import IGuardMessage from "./interfaces/IGuardMessage";
import BasicType from "vrack2-core/lib/validator/types/BasicType";
import ICommandRegister from "./interfaces/ICommandRegister";
export interface ICommandExport {
    command: string;
    description: string;
    level: number;
    owner?: string;
    short?: string;
    icon?: string;
    rules?: {
        [key: string]: BasicType;
    };
    return?: BasicType;
}
export default class Master extends Device {
    commands: {
        [key: string]: ICommandRegister;
    };
    inputs(): {
        [key: string]: BasicPort;
    };
    outputs(): {
        [key: string]: BasicPort;
    };
    checkOptions(): {
        [key: string]: BasicType;
    };
    preProcess(): void;
    process(): void;
    /**
     * Returns the list of Master commands
    */
    apiCommandList(): Promise<{
        [key: string]: ICommandExport;
    }>;
    /**
     * Executes a registered master command.
     * If the master does not find the command - it will try to execute the submaster command
     *
     * @param data  Command data that comes from the Guard
    */
    inputCommand(data: IGuardMessage): Promise<any>;
}

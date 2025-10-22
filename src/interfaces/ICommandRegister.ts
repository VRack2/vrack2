import BasicType from "vrack2-core/lib/validator/types/BasicType";
import IGuardMessage from "./IGuardMessage";

/**
 * Master command registration interface
 * 
*/
export default interface ICommandRegister {
    /**
     * Command name like a 'getMasterCommands' style
    */
    command: string;

    /**
     * Short command descriotion
    */
    short?: string;

    /**
     * Owner device name/module/id string
    */
    owner?: string

    /**
     * Command description
    */
    description: string;

    /**
     * Access level for command 
    */
    level: number;

    /**
     * Icon from bootstrap for Beautiful
    */
    icon?: string
    
    /**
     * Handler for command run
    */
    handler: (data: any, message: IGuardMessage) => Promise<any>;

    /**
     * Command data validation rules
    */
    rules?: { [key: string]: BasicType; };

    /**
     * Return value for documentation
    */
    return?:  BasicType;
}

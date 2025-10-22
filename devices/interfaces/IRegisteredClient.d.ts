import IRegisterProviderClient from "./IRegisterProviderClient";
/**
 *  Internal messages of client registration
 */
export default interface IRegisteredClient extends IRegisterProviderClient {
    /** Provider ID  */
    providerId: number;
}

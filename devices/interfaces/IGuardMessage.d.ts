export default interface IGuardMessage {
    /** Provider type string  (WSProvider default)*/
    providerType: string;
    /** Provider unique ID */
    providerId: number;
    /** Provider client unique ID */
    clientId: number;
    /** Client command string */
    command: string;
    /** Client access level */
    level: number;
    /** Client command data */
    data: any;
}

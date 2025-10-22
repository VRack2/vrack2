export default interface IRegisterProviderClient {
    /** Provider type - default 'WSProvider' */
    providerType: string;
    /** Provider ID  (Define by ProvidersClients device) */
    clientId: number;
    /** Additional infomation for this message */
    additional?: any;
}

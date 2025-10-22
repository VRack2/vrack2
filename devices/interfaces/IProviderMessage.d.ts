import WebSocket from 'ws';
import IRegisterProviderClient from './IRegisterProviderClient';
import IRegisteredClient from './IRegisteredClient';
/**
 * The format of the message between the client and the server.
 * The server accepts messages from the client and forms such an object.
 * When the response is ready - the same response is formed
*/
export default interface IProviderMessage extends IRegisterProviderClient, IRegisteredClient {
    /** Flag that marks that the client has been registered in ProvidersClients */
    registered: boolean;
    /** Client data */
    data: WebSocket.RawData | string;
}

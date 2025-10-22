import { Device } from "vrack2-core";
import BasicPort from "vrack2-core/lib/ports/BasicPort";
import BasicType from "vrack2-core/lib/validator/types/BasicType";
import WebSocket from 'ws';
import IProviderMessage from "./interfaces/IProviderMessage";
import IRegisteredClient from "./interfaces/IRegisteredClient";
import IGuardMessage from "./interfaces/IGuardMessage";
import IBroadcast from "./interfaces/IBroadcast";
import IApiKey from "./interfaces/IApiKey";
/**
 * Internal guard client information
*/
interface IGuardClient extends IRegisteredClient {
    authorize: boolean;
    cipher: boolean;
    key?: IApiKey;
    private: string;
    verify: string;
    level: number;
}
export default class Guard extends Device {
    guardedClients: {
        [key: number]: {
            [key: number]: IGuardClient;
        };
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
    process(): void;
    /**
     * Command apiKeyAuth
     *
     * Performs basic user authentication.
     * It is a basic and mandatory command for any user.
     * It is practically the only and first command that the user must perform
     *
     * To pass authorization, you need to send a key string.
     *
     * If the key is private, a string will be returned that must be encrypted
     * with a private key and returned to the apiPrivateAuth command
     *
     * @see Guard.process
    */
    apiKeyAuth(data: {
        key: string;
    }, message: IGuardMessage): Promise<{
        level: number;
        cipher: boolean;
    } | {
        verify: string;
        cipher: boolean;
    }>;
    /**
     * Command apiPrivateAuth
     *
     * The second authorization command to switch to encrypted communication mode
     * If the private key was recognized correctly, the next message will already use encryption.
     *
     *
     * 'verify' string to verify the authorization that the client encrypted with its key.
     * This string should have been received after the “apiKeyAuth” command.
     *
     * @see Guard.process
     * @see apiKeyAuth
     * @param data Client data with verify string
     */
    apiPrivateAuth(data: {
        verify: string;
    }, message: IGuardMessage): Promise<{
        level: number;
        cipher: boolean;
    }>;
    /**
     * Processes commands coming from providers clients
     *
     * Receives messages from the client, decrypts them and sends the command to the master for execution
     * It encrypts the result of the wizard execution and returns it back to the Provider
     *
     * @param data Provider client message
    */
    inputClientsCommand(data: IProviderMessage): Promise<string | IProviderMessage>;
    /**
     * Sends a broadcast message personally to the customer.
     *
     * @param data Broadcast message
    */
    inputBroadcast(data: IBroadcast): void;
    /**
     * Registration of a new client of the provider
     *
     * @param data Client information
    */
    inputClientsRegister(data: IRegisteredClient): void;
    /**
     *  Unregistratio client of the provider
     *
     * @param data Client information
    */
    inputClientsUnregister(data: IRegisteredClient): void;
    /**
     * client authorization.
     *
     * client authorization. Assigns flags and parameters to the client during authorization
     *
     * @param client Internal guard client information
    */
    protected autorize(client: IGuardClient, cipher?: boolean): {
        level: number;
        cipher: boolean;
    };
    /**
     * Generates a response to the client that requested the data using the provider.
     *
     * @see inputClientsCommand
    */
    protected response(client: IGuardClient | undefined, request: any, result: string, resultData: any): string;
    /**
     * Getting an internal client
     *
     * If the client was not found, it will throw a GUARD_CLIENT_NOT_REGISTERED exception
     * @param message Message
    */
    protected getClient(message: IGuardMessage | IProviderMessage): IGuardClient;
    /**
     * Decrypts data coming from the client
     *
     * @see apiPrivateAuth
    */
    protected decipherData(data: WebSocket.RawData | string, client: IGuardClient): string;
    /**
     * Encrypting data before sending to the client
     *
     * @see apiPrivateAuth
    */
    protected cipherData(data: string, client: IGuardClient): string;
    /**
     * Generates a random string for encryption and subsequent authorization check
     *
     * @param length Number of character pairs
    */
    protected uid(length: number): string;
}
export {};

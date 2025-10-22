import { Device } from "vrack2-core";
import BasicPort from "vrack2-core/lib/ports/BasicPort";
import BasicType from "vrack2-core/lib/validator/types/BasicType";
import IProviderMessage from "./interfaces/IProviderMessage";
import IRegisterProviderClient from "./interfaces/IRegisterProviderClient";
import IUnregisterProviderClient from "./interfaces/IUnregisterProviderClient";
import IRegisteredClient from "./interfaces/IRegisteredClient";
export default class ProvidersClients extends Device {
    /**
     * Registered information
     *
     * providers[providerId][clientId]
    */
    providers: {
        [key: number]: {
            [key: number]: IRegisteredClient;
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
    preProcess(): void;
    /**
     * Sending a message to a specific client
     *
     * It won't do anything if the client doesn't exist
     *
     * @see inputs
    */
    inputClientSend(data: IProviderMessage): void;
    /**
     * Performs a transparent request from the user.
     * Checks the existence of a registered customer and
     * supplements the incoming request with the registration data
     *
     * @param data Provider message from client
    */
    inputClientCommand(data: IProviderMessage, providerId: number): any;
    /**
     * Registration of the client and additional client data
    */
    inputClientRegister(data: IRegisterProviderClient, providerId: number): void;
    /**
     * UnRegistration client
    */
    inputClientUnregister(data: IUnregisterProviderClient, providerId: number): void;
}

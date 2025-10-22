import { Device } from "vrack2-core";
import BasicPort from "vrack2-core/lib/ports/BasicPort";
import IGuardMessage from './interfaces/IGuardMessage';
import IRegisteredClient from "./interfaces/IRegisteredClient";
import IBroadcast from "./interfaces/IBroadcast";
import BasicType from "vrack2-core/lib/validator/types/BasicType";
export default class Broadcaster extends Device {
    inputs(): {
        [key: string]: BasicPort;
    };
    outputs(): {
        [key: string]: BasicPort;
    };
    process(): void;
    checkOptions(): {
        [key: string]: BasicType;
    };
    /**
     * A list of channels - and a list of subscribers to those channels.
     *
     * Structure:
     * ```ts
     *  {
     *      'channel.name': Set<string('ClientProviderHash')>
     *  }
     * ```
     * @see createEntity()
    */
    protected channels: Map<string, Set<string>>;
    /**
     * List of subscribers and the channels they are subscribed to. Like channels only in reverse
     *
     * Structure:
     * ```ts
     *  {
     *      'ClientProviderHash': Set<string('channel.name')>
     *  }
     * ```
     *
     * @see createEntity()
    */
    protected entities: Map<string, Set<string>>;
    /**
     * Stores the real providerId and clientId by hash
     *
     * @see createEntity()
    */
    protected clients: Map<string, {
        providerId: number;
        clientId: number;
    }>;
    preProcess(): void;
    /**
     * Sending data to all channel subscribers
     *
     * @param data Broadcast data
    */
    inputClientsBroadcast(data: IBroadcast): void;
    /**
     * Register the provider clients
     *
     * @param data registration data
    */
    inputClientsRegister(data: IRegisteredClient): void;
    /**
     * Unregister the provider clients
     *
     * @param data unregistration data
    */
    inputClientsUnregister(data: IRegisteredClient): void;
    /**
     * Action to connect the client to the channel
     *
     * @param data Channel settings
    */
    apiChannelJoin(data: {
        channel: string;
    }, gData: IGuardMessage): Promise<string>;
    /**
     * Action for disconnecting a client from a channel
     *
     * @param data Channel settings
    */
    apiChannelLeave(data: {
        channel: string;
    }, gData: IGuardMessage): Promise<string>;
    /**
     * Return channel clients Set
     *
     * @param channel Channel string
    */
    protected getChannel(channel: string): Set<string>;
    /**
     * Returns the list of connected channels by client hash
     *
     * @param entity @see createEntity
    */
    protected getEntity(entity: string): Set<string>;
    /**
     * Creates a unique hash by providerId & clientId
     *
     * @param providerId Provider unique ID
     * @param clientId  Client unique ID for this provider
    */
    protected createEntity(providerId: number, clientId: number): string;
}

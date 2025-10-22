import { BasicMetric, Device } from "vrack2-core";
import BasicPort from "vrack2-core/lib/ports/BasicPort";
import BasicType from "vrack2-core/lib/validator/types/BasicType";
import WebSocket from "ws";
import IProviderMessage from "./interfaces/IProviderMessage";
export default class WSProvider extends Device {
    outputs(): {
        [key: string]: BasicPort;
    };
    inputs(): {
        [key: string]: BasicPort;
    };
    checkOptions(): {
        [key: string]: BasicType;
    };
    metrics(): {
        [key: string]: BasicMetric;
    };
    /**
     * Client index
    */
    websocketIndex: number;
    /**
     * Websocket Map List
    */
    websocketList: Map<number, WebSocket>;
    /**
     * Alive flag for ws client
    */
    websocketAlive: {
        [key: number]: boolean;
    };
    /**
     * This provider name
    */
    provider: string;
    /** Stats for metrics */
    stats: {
        receive: number;
        send: number;
    };
    process(): void;
    /**
     * Create websocket server
     *
     * Handles incoming connections and incoming messages
     *
    */
    createServer(): void;
    /**
     * A special method that sends all clients messages to which they must respond
     * If the client does not respond the connection will be disconnected
    */
    pingInterval(): void;
    /********************
     *   Inputs Handlers
     ********************/
    /**
     * Send data to client (uses for broadcast events)
    */
    inputSend(data: IProviderMessage): void;
    /********************
     *   Server events
     ********************/
    /**
     * Called when the client sends a message to the socket
     *
     * Attempts to call and retrieve data from the connection, then return the data to the client
    */
    clientOnMessage(clientId: number, data: WebSocket.RawData): Promise<void>;
    /**
     * Event if client close connection
    */
    clientOnClose(id: number): void;
    /**
     * If server get error message
    */
    serverOnError(error: Error): void;
    /**
     * Send data to client
     *
     * @param clientId Websocket client id
     * @param data Data for send to client
    */
    clientSend(clientId: number, data: WebSocket.RawData | string): void;
    /**
     * Return next client index
    */
    getIndex(): number;
}

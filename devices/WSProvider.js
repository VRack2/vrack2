"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vrack2_core_1 = require("vrack2-core");
const ws_1 = __importDefault(require("ws"));
class WSProvider extends vrack2_core_1.Device {
    constructor() {
        super(...arguments);
        /**
         * Client index
        */
        this.websocketIndex = 1;
        /**
         * Websocket Map List
        */
        this.websocketList = new Map();
        /**
         * Alive flag for ws client
        */
        this.websocketAlive = {};
        /**
         * This provider name
        */
        this.provider = 'WSProvider';
        /** Stats for metrics */
        this.stats = {
            receive: 0,
            send: 0,
        };
    }
    outputs() {
        return {
            command: vrack2_core_1.Port.return().description('Port for client command request'),
            register: vrack2_core_1.Port.standart().description('Client register'),
            unregister: vrack2_core_1.Port.standart().description('Client unregister')
        };
    }
    inputs() {
        return {
            send: vrack2_core_1.Port.standart().description('To client send port')
        };
    }
    checkOptions() {
        return {
            port: vrack2_core_1.Rule.number().require().integer().default(4044).min(0).description('Websocket server port'),
            host: vrack2_core_1.Rule.string().require().default('').description('Websocket server host')
        };
    }
    metrics() {
        return {
            'byte.send': vrack2_core_1.Metric.inS().retentions('1m:1d, 1h:1w, 6h:1mon, 1d:1y').description('Count bytes send to client in min'),
            'byte.receive': vrack2_core_1.Metric.inS().retentions('1m:1d, 1h:1w, 6h:1mon, 1d:1y').description('Count bytes receive from client in min')
        };
    }
    process() {
        this.createServer();
        this.pingInterval();
        setInterval(() => {
            this.metric('byte.send', this.stats.send / 1024 / 1024);
            this.metric('byte.receive', this.stats.receive / 1024 / 1024);
            this.stats.send = 0;
            this.stats.receive = 0;
        }, 60 * 1000);
    }
    /**
     * Create websocket server
     *
     * Handles incoming connections and incoming messages
     *
    */
    createServer() {
        const wss = new ws_1.default.Server({ port: this.options.port });
        wss.on('connection', (ws, req) => {
            const id = this.getIndex();
            this.websocketAlive[id] = true;
            this.websocketList.set(id, ws);
            this.ports.output.register.push({
                providerType: this.provider, clientId: id, additional: { ip: req.socket.remoteAddress }
            });
            ws.on('pong', () => { this.websocketAlive[id] = true; });
            ws.on('message', (data) => this.clientOnMessage(id, data));
            ws.on('close', () => { this.clientOnClose(id); });
        });
        wss.on('error', this.serverOnError.bind(this));
    }
    /**
     * A special method that sends all clients messages to which they must respond
     * If the client does not respond the connection will be disconnected
    */
    pingInterval() {
        setInterval(() => {
            this.websocketList.forEach((ws, id) => {
                if (this.websocketAlive[id] === false) {
                    this.websocketList.delete(id);
                    delete this.websocketAlive[id];
                    return ws.terminate();
                }
                this.websocketAlive[id] = false;
                ws.ping(() => { return; });
            });
        }, 15000);
    }
    /********************
     *   Inputs Handlers
     ********************/
    /**
     * Send data to client (uses for broadcast events)
    */
    inputSend(data) {
        this.clientSend(data.clientId, data.data);
    }
    /********************
     *   Server events
     ********************/
    /**
     * Called when the client sends a message to the socket
     *
     * Attempts to call and retrieve data from the connection, then return the data to the client
    */
    clientOnMessage(clientId, data) {
        return __awaiter(this, void 0, void 0, function* () {
            if (data instanceof Buffer)
                this.stats.receive += data.length;
            if (data instanceof ArrayBuffer)
                this.stats.receive += data.byteLength;
            if (Array.isArray(data))
                for (const b of data)
                    this.stats.receive += b.length;
            const req = {
                providerType: this.provider, providerId: 0, clientId, registered: false, data,
            };
            const res = yield this.ports.output.command.push(req);
            this.clientSend(res.clientId, res.data);
        });
    }
    /**
     * Event if client close connection
    */
    clientOnClose(id) {
        this.ports.output.unregister.push({ clientId: id });
        this.websocketList.delete(id);
    }
    /**
     * If server get error message
    */
    serverOnError(error) {
        console.error('Error websocket server');
        console.error(error);
        this.error(`Provider '${this.provider}' error`, error);
    }
    /**
     * Send data to client
     *
     * @param clientId Websocket client id
     * @param data Data for send to client
    */
    clientSend(clientId, data) {
        if (data instanceof Buffer)
            this.stats.send += data.length;
        if (data instanceof ArrayBuffer)
            this.stats.send += data.byteLength;
        if (Array.isArray(data))
            for (const b of data)
                this.stats.send += b.length;
        if (typeof data === 'string')
            this.stats.send += data.length;
        if (!this.websocketList.has(clientId))
            return;
        const ws = this.websocketList.get(clientId);
        if (ws === undefined)
            return;
        if (ws.readyState === ws_1.default.OPEN)
            ws.send(data);
        else
            this.websocketList.delete(clientId);
    }
    /**
     * Return next client index
    */
    getIndex() {
        return this.websocketIndex++;
    }
}
exports.default = WSProvider;

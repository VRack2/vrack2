import { BasicMetric, Device, Metric, Port, Rule } from "vrack2-core";
import BasicPort from "vrack2-core/lib/ports/BasicPort";
import BasicType from "vrack2-core/lib/validator/types/BasicType";
import WebSocket from "ws"
import IProviderMessage from "./interfaces/IProviderMessage";

export default class WSProvider extends Device {

  outputs(): { [key: string]: BasicPort; } {
    return {
      command: Port.return().description('Port for client command request'),
      register: Port.standart().description('Client register'),
      unregister: Port.standart().description('Client unregister')
    }
  }

  inputs(): { [key: string]: BasicPort; } {
    return {
      send: Port.standart().description('To client send port')
    }
  }

  checkOptions(): { [key: string]: BasicType; } {
    return {
      port: Rule.number().required().integer().default(4044).min(0).description('Websocket server port'),
      host: Rule.string().required().default('').description('Websocket server host')
    }
  }

  metrics(): { [key: string]: BasicMetric; } {
      return {
        'byte.send': Metric.inS().retentions('1m:1d, 1h:1w, 6h:1mon, 1d:1y').description('Count bytes send to client in min'),
        'byte.receive': Metric.inS().retentions('1m:1d, 1h:1w, 6h:1mon, 1d:1y').description('Count bytes receive from client in min')
      }
  }

  /**
   * Client index
  */
  websocketIndex = 1

  /**
   * Websocket Map List
  */
  websocketList = new Map<number, WebSocket>()

  /**
   * Alive flag for ws client
  */
  websocketAlive: { [key: number]: boolean } = {}

  /**
   * This provider name
  */
  provider = 'WSProvider'

  /** Stats for metrics */
  stats = {
    receive: 0,
    send: 0,
  }

  process() {
    this.createServer()
    this.pingInterval()

    setInterval(()=>{
      this.metric('byte.send', this.stats.send/1024/1024)
      this.metric('byte.receive', this.stats.receive/1024/1024)
      this.stats.send = 0
      this.stats.receive = 0
    },60*1000)
  }

  /**
   * Create websocket server
   * 
   * Handles incoming connections and incoming messages
   * 
  */
  createServer() {
    const wss = new WebSocket.Server({ port: this.options.port })
    wss.on('connection', (ws, req) => {
      const id = this.getIndex()
      this.websocketAlive[id] = true
      this.websocketList.set(id, ws)
      this.ports.output.register.push({
        providerType: this.provider, clientId: id, additional: { ip: req.socket.remoteAddress }
      })
      ws.on('pong', () => { this.websocketAlive[id] = true })
      ws.on('message', (data) => this.clientOnMessage(id, data))
      ws.on('close', () => { this.clientOnClose(id) })
    })
    wss.on('error', this.serverOnError.bind(this))
  }

  /**
   * A special method that sends all clients messages to which they must respond
   * If the client does not respond the connection will be disconnected
  */
  pingInterval(){
    setInterval(() => {
      this.websocketList.forEach((ws, id) => {
        if (this.websocketAlive[id] === false) {
          this.websocketList.delete(id)
          delete this.websocketAlive[id]
          return ws.terminate()
        }
        this.websocketAlive[id] = false
        ws.ping(() => { return })
      })
    }, 15000)
  }

  /********************
   *   Inputs Handlers
   ********************/

  /**
   * Send data to client (uses for broadcast events)
  */
  inputSend(data: IProviderMessage) {
    this.clientSend(data.clientId, data.data)
  }

  /********************
   *   Server events
   ********************/

  /**
   * Called when the client sends a message to the socket
   * 
   * Attempts to call and retrieve data from the connection, then return the data to the client
  */
  async clientOnMessage(clientId: number, data: WebSocket.RawData) {
    if (data instanceof Buffer) this.stats.receive +=  data.length
    if (data instanceof ArrayBuffer) this.stats.receive +=  data.byteLength
    if (Array.isArray(data)) for (const b of data) this.stats.receive +=  b.length

    const req: IProviderMessage = {
      providerType: this.provider, providerId: 0, clientId, registered: false, data,
    }

    const res: IProviderMessage = await this.ports.output.command.push(req)
    this.clientSend(res.clientId, res.data)
  }

  /**
   * Event if client close connection
  */
  clientOnClose(id: number){
    this.ports.output.unregister.push({ clientId: id })
    this.websocketList.delete(id)
  }

  /**
   * If server get error message
  */
  serverOnError(error: Error){
    console.error('Error websocket server')
    console.error(error)
    this.error(`Provider '${this.provider}' error`, error)
  }

  /**
   * Send data to client
   * 
   * @param clientId Websocket client id
   * @param data Data for send to client
  */
  clientSend(clientId: number, data: WebSocket.RawData | string) {
    if (data instanceof Buffer) this.stats.send +=  data.length
    if (data instanceof ArrayBuffer) this.stats.send +=  data.byteLength
    if (Array.isArray(data)) for (const b of data) this.stats.send +=  b.length
    if (typeof data === 'string' ) this.stats.send +=  data.length

    if (!this.websocketList.has(clientId)) return
    const ws = this.websocketList.get(clientId)
    if (ws === undefined) return
    if (ws.readyState === WebSocket.OPEN) ws.send(data)
    else this.websocketList.delete(clientId)
  }

  /**
   * Return next client index
  */
  getIndex() {
    return this.websocketIndex++
  }
}
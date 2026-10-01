import { CoreError, Device, ErrorManager, Port, Rule } from "vrack2-core";
import BasicPort from "vrack2-core/lib/ports/BasicPort";
import BasicType from "vrack2-core/lib/validator/types/BasicType";

import crypto from 'crypto'

import IProviderMessage from "./interfaces/IProviderMessage";
import IRegisteredClient from "./interfaces/IRegisteredClient";
import IGuardMessage from "./interfaces/IGuardMessage";
import IBroadcast from "./interfaces/IBroadcast";
import IApiKey from "./interfaces/IApiKey";

ErrorManager.register(
    'Guard', 'GUARD_CLIENT_NOT_REGISTERED',
    'Somehow it happened that the client was not registered, but a request came from him.', {
    providerId: Rule.number().min(0).integer().required(),
    clientId: Rule.number().min(0).integer().required()
})

ErrorManager.register(
    'Guard', 'GUARD_INCORRECT_CLIENT_JSON',
    'The client sent data in the request that does not comply with the json format.',
    {
        err: Rule.string().description('Error message')
    }
)

ErrorManager.register(
    'Guard', 'GUARD_CLIENT_NOT_AUTH',
    'You are not authenticated. Please use the apiKeyAuth command before'
)

ErrorManager.register(
    'Guard', 'GUARD_VERIFICATION_FAILED',
    'Incorrect verification code'
)

ErrorManager.register(
    'Guard', 'GUARD_DECIPHER_FAILED',
    'Error while decrypting data', {
    error: Rule.string().description('Error description string')
})

ErrorManager.register(
    'Guard', 'GUARD_CIPHER_FAILED',
    'Error while crypting data', {
    error: Rule.string().description('Error description string')
})

ErrorManager.register(
    'Guard', 'GUARD_PRIVATE_VERIFICATION_FAILED',
    'Error while decrypting data')

ErrorManager.register(
    'Guard', 'GUARD_RATE_LIMITED',
    'Too many failed authorization attempts from this source. Try again later.')


/**
 * Internal guard client information
*/
interface IGuardClient extends IRegisteredClient {
    authorize: boolean;
    cipher: boolean;
    key?: IApiKey;
    private: string;
    /** Server challenge nonce the cipher client must return encrypted in the proof */
    verify: string;
    level: number;
    /** Next expected inbound (client→server) frame sequence number */
    inSeq: number;
    /** Next outbound (server→client) frame sequence number */
    outSeq: number;
}

export default class Guard extends Device {

    guardedClients: { [key: number]: { [key: number]: IGuardClient } } = {}
    /** In-memory per-source failed-auth counters (keyed by client IP, falling back to provider:client) */
    rateLimit = new Map<string, { count: number; resetAt: number }>()
    /** Sliding window for rate limiting (60 s) */
    private static readonly RL_WINDOW_MS = 60_000
    /** Max failed auth attempts per source within the window */
    private static readonly RL_MAX_ATTEMPTS = 20
    /**
     * Server-side P-256 keypair for the asymmetric (ECDH) channel. Generated at start,
     * never persisted. The public key is sent to cipher clients in apiKeyAuth; the
     * private key stays here (used in deriveEK for ECDH).
     */
    protected serverPrivPem = ''
    protected serverPubPem = ''
    description(): string {
        return `Guard отвечает за управление клиентами, аутентификацию и шифрование данных. Он обрабатывает команды от клиентов, проверяет их авторизацию и обеспечивает безопасный обмен данными через шифрование AES-256. 
Предоставляет методы для регистрации/разрегистрации клиентов, а также отправки бродкастов.`
    }
    inputs(): { [key: string]: BasicPort; } {
        return {
            'clients.command': Port.return().description('Command sending port from Clients'),
            'clients.register': Port.standard().description('Register Clients port'),
            'clients.unregister': Port.standard().description('Unregister Clients port'),
            'broadcast': Port.standard().description('Port for send broadcast to clients'),
        }
    }

    outputs(): { [key: string]: BasicPort; } {
        return {
            'master.command': Port.return().description('Port for master commands'),
            'register.command': Port.standard().description('Register command into master'),
            'client.send': Port.standard().description('Send data to client'),
        }
    }

    checkOptions(): { [key: string]: BasicType; } {
        return {
            // providers: Rule.number().required().integer().min(0).max(10)
        }
    }

    onStart(): void {
        // Generate the server-side P-256 keypair used for the asymmetric (ECDH) channel.
        // The public key is shared with cipher clients; the private key never leaves the server.
        const kp = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
        this.serverPubPem = kp.publicKey.export({ type: 'spki', format: 'pem' }).toString()
        this.serverPrivPem = kp.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

        this.ports.output['register.command'].push({
            command: 'apiKeyAuth',
            short: 'Api Client authorize',
            description: 'Basic client identification command. Requires a special identification key. If the key uses encryption, returns a special private key verification string. See apiPrivateAuth',
            level: 1000,
            owner: this.type,
            icon: 'person-fill-exclamation',
            handler: this.apiKeyAuth.bind(this),
            rules: {
                key: Rule.string().maxLength(32).example('default').description('Client authentication key'),
            },
            return: Rule.object().fields({
                cipher: Rule.boolean().default(false).description('Does authorization require encryption?'),
                verify: Rule.string().example('9u49ipjeirhh').description('If this line is specified, you need to go through additional authorization with encryption'),
                serverPub: Rule.string().example('-----BEGIN PUBLIC KEY-----').description("Server P-256 public key (PEM) for the asymmetric channel; present when the key is asymmetric"),
                level: Rule.number().example(3).description('If the level is specified, then authorization was successful'),
                authorize: Rule.boolean().default(false).description('If the level is specified, then authorization was successful.'),
            }).description('Success authorized result')
        })

        this.ports.output['register.command'].push({
            command: 'apiPrivateAuth',
            short: 'Authorize with encrypt',
            description: 'Complete cipher authentication: send the challenge nonce GCM-encrypted (req seq) as a frame to prove the secret. After this the channel is encrypted.',
            level: 1000,
            owner: this.type,
            icon: 'person-fill-lock',
            handler: this.apiPrivateAuth.bind(this),
            rules: {
                frame: Rule.string().maxLength(512).example('u1f9...==').description('GCM frame (base64url nonce‖ct‖tag) encrypting the challenge nonce'),
            },
            return:  Rule.object().fields({
                cipher: Rule.boolean().default(true).description('Does authorization require encryption?'),
                level: Rule.number().example(3).description('If the level is specified, then authorization was successful'),
                authorize: Rule.boolean().default(true).description('If the level is specified, then authorization was successful.'),
            }).description('Success authorized result')
        })
    }

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
    async apiKeyAuth(data: { key: string }, message: IGuardMessage) {
        const client = this.getClient(message)
        if (this.rateLimited(client)) throw ErrorManager.make('GUARD_RATE_LIMITED')
        const req: IGuardMessage = {
            providerType: 'Guard',
            providerId: 0,
            clientId: 0,
            command: 'apiKey',
            level: 0,
            data: { key: data.key }
        }
        let key: IApiKey
        try {
            key = await this.ports.output['master.command'].push(req)
        } catch (error) {
            this.rlFail(client)
            throw error
        }
        this.rlReset(client)
        client.key = key
        if (key.public) {
            // Asymmetric cipher key (P-256): the channel key is derived via ECDH between
            // the client's public key and the server keypair. Send the challenge (the client
            // returns it ECDH-encrypted via apiPrivateAuth) plus the server public key.
            client.cipher = false
            client.verify = crypto.randomBytes(16).toString('base64url')
            client.inSeq = 1
            client.outSeq = 1
            return { verify: client.verify, cipher: true, serverPub: this.serverPubPem }
        }
        if (key.private) {
            // Legacy shared-secret cipher key (HKDF): kept for pre-existing keys.
            client.private = key.private
            client.cipher = false
            client.verify = crypto.randomBytes(16).toString('base64url')
            client.inSeq = 1
            client.outSeq = 1
            return { verify: client.verify, cipher: true }
        }
        return this.autorize(client)
    }

    /**
     * Command apiPrivateAuth
     * 
     * The second authorization command to switch to encrypted communication mode
     * If the private key was recognized correctly, the next message will already use encryption.
     * 
     * 
     * 'frame' — the GCM-encrypted challenge (the 'verify' nonce received from apiKeyAuth).
     * It is the first inbound frame (req seq = inSeq). A valid GCM auth tag plus a
     * matching nonce proves the client holds the secret without revealing it.
     *
     * @see Guard.process
     * @see apiKeyAuth
     * @param data Client data with the GCM proof frame
     */
    async apiPrivateAuth(data: { frame: string }, message: IGuardMessage) {
        const client = this.getClient(message)
        if (this.rateLimited(client)) throw ErrorManager.make('GUARD_RATE_LIMITED')
        if (!client.key || (!client.key.private && !client.key.public)) throw ErrorManager.make('GUARD_CLIENT_NOT_AUTH')
        let nonce: string
        try {
            nonce = this.recvFrame(client, client.clientId, data.frame)
        } catch (error) {
            this.rlFail(client)
            throw ErrorManager.make('GUARD_DECIPHER_FAILED', {
                error: (error as Error).toString()
            })
        }
        if (nonce !== client.verify) {
            this.rlFail(client)
            throw ErrorManager.make('GUARD_PRIVATE_VERIFICATION_FAILED')
        }
        this.rlReset(client)
        return this.autorize(client, true)
    }

    /**
     * Processes commands coming from providers clients
     * 
     * Receives messages from the client, decrypts them and sends the command to the master for execution
     * It encrypts the result of the command execution and returns it back to the Provider
     *
     * Channel state is decided at message arrival: if the client was already cipher-authorized
     * the payload is a GCM frame; otherwise it is plain JSON (handshake commands, or a plain key).
     *
     * @param data Provider client message
    */
    async inputClientsCommand(data: IProviderMessage) {
        let client: IGuardClient | undefined
        let clientData: IGuardMessage
        let wasCipher = false
        try {
            client = this.getClient(data)
            wasCipher = client.authorize && client.cipher
            if (wasCipher) {
                clientData = JSON.parse(this.recvFrame(client, data.clientId, data.data.toString('utf8')))
            } else {
                clientData = JSON.parse(data.data.toString('utf8'))
            }
        } catch (error) {
            if (error instanceof CoreError) return this.response(client, {}, 'error', error, wasCipher)
            return this.response(client, {}, 'error', ErrorManager.make('GUARD_INCORRECT_CLIENT_JSON', { err: (error as Error).message }), wasCipher)
        }

        Object.assign(clientData, {
            providerType: data.providerType,
            providerId: data.providerId,
            clientId: data.clientId,
            level: client.level
        })

        try {
            this.Container.emit('Guard.client.command', clientData)
            const result = await this.ports.output['master.command'].push(clientData)
            data.data = this.response(client, clientData, 'success', result, wasCipher)
            this.Container.emit('Guard.client.command.success', { clientData, result })
        } catch (error) {
            this.Container.emit('Guard.client.command.error', { clientData, error })
            data.data = this.response(client, clientData, 'error', error, wasCipher)
        }

        return data
    }

    /**
     * Sends a broadcast message personally to the customer. 
     * 
     * @param data Broadcast message
    */
    inputBroadcast(data: IBroadcast) {
        if (data.clientId === undefined || data.providerId === undefined) return
        if (!this.guardedClients[data.providerId] || !this.guardedClients[data.providerId][data.clientId]) return
        const client = this.guardedClients[data.providerId][data.clientId]
        const stData = client.cipher
            ? this.sendFrame(client, data.clientId, JSON.stringify(data))
            : JSON.stringify(data)
        const send: IProviderMessage = {
            registered: true,
            providerType: '',
            clientId: data.clientId,
            providerId: data.providerId,
            data: stData
        }
        this.ports.output['client.send'].push(send)
    }

    /**
     * Registration of a new client of the provider
     * 
     * @param data Client information
    */
    inputClientsRegister(data: IRegisteredClient) {
        if (!this.guardedClients[data.providerId]) this.guardedClients[data.providerId] = {}
        this.Container.emit('Guard.client.register', data)
        this.guardedClients[data.providerId][data.clientId] = Object.assign({
            authorize: false, cipher: false, private: '', level: 1000, verify: '', inSeq: 1, outSeq: 1
        }, data)
    }

    /**
     *  Unregistratio client of the provider
     * 
     * @param data Client information
    */
    inputClientsUnregister(data: IRegisteredClient) {
        if (!this.guardedClients[data.providerId] || this.guardedClients[data.providerId][data.clientId]) return
        this.Container.emit('Guard.client.unregister', data)
        delete this.guardedClients[data.providerId][data.clientId]
    }

    /**
     * client authorization. 
     * 
     * client authorization. Assigns flags and parameters to the client during authorization
     * 
     * @param client Internal guard client information
    */
    protected autorize(client: IGuardClient, cipher = false) {
        if (!client.key) throw ErrorManager.make('GUARD_CLIENT_NOT_AUTH')
        client.authorize = true
        client.cipher = cipher
        client.level = client.key?.level
        this.Container.emit('Guard.client.autorize', client)
        return { level: client.level, cipher }
    }

    /**
     * Generates a response to the client that requested the data using the provider.
     * 
     * @see inputClientsCommand
    */
    protected response(client: IGuardClient | undefined, request: any, result: string, resultData: any, wasCipher = false) {
        request.result = result
        if (result === 'error') request.resultData = CoreError.objectify(resultData); else request.resultData = resultData
        let ret = JSON.stringify(request)
        if (client === undefined) return ret
        // The response is framed only if the channel was already cipher-authorized when
        // the request arrived (so the proof response stays plain, like its request).
        if (wasCipher) ret = this.sendFrame(client, client.clientId, ret)
        return ret
    }

    /**
     * Getting an internal client 
     * 
     * If the client was not found, it will throw a GUARD_CLIENT_NOT_REGISTERED exception
     * @param message Message
    */
    protected getClient(message: IGuardMessage | IProviderMessage): IGuardClient {
        if (!this.guardedClients[message.providerId] || !this.guardedClients[message.providerId][message.clientId]) {
            throw ErrorManager.make('GUARD_CLIENT_NOT_REGISTERED', {
                providerId: message.providerId,
                clientId: message.clientId
            })
        }
        return this.guardedClients[message.providerId][message.clientId]
    }

    /**
     * Normalizes a Buffer to the Uint8Array type the crypto APIs expect.
     * Purely a type-level cast (Buffer is a Uint8Array at runtime); it silences the
     * @types/node / TypeScript ≥5.7 generic skew where Buffer is Uint8Array<ArrayBufferLike>
     * but the crypto signatures expect Uint8Array<ArrayBuffer>.
     */
    protected u8(b: Buffer): Uint8Array { return b as unknown as Uint8Array }

    /**
     * Derives the per-channel encryption key (32 bytes) from the client secret
     * using HKDF-SHA256, so the raw secret is never used directly as a cipher key.
     *
     * @param client Internal guard client
     */
    protected deriveEK(client: IGuardClient): Buffer {
        if (!client.key || (!client.key.private && !client.key.public)) throw ErrorManager.make('GUARD_CIPHER_FAILED', { error: 'Key in client not found' })
        // Asymmetric (P-256) channel: derive the key from the ECDH shared secret between
        // the client's public key and the server private key. No shared secret on the wire.
        if (client.key.public) {
            const shared = crypto.diffieHellman({
                privateKey: crypto.createPrivateKey(this.serverPrivPem),
                publicKey: crypto.createPublicKey(client.key.public)
            })
            return Buffer.from(crypto.hkdfSync('sha256', this.u8(shared), this.u8(Buffer.alloc(0)), this.u8(Buffer.from('vrack2/v2/ek', 'utf8')), 32))
        }
        // Legacy shared-secret channel (HKDF) for pre-existing keys with a private secret.
        const ikm = this.u8(Buffer.from(client.key.private, 'utf8'))
        const salt = this.u8(Buffer.from('vrack2/v2', 'utf8'))
        const info = this.u8(Buffer.from('vrack2/v2/ek', 'utf8'))
        return Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, 32))
    }

    /**
     * Builds the authenticated additional data binding the frame to this session,
     * channel, sequence number and direction. Including the per-session id (the
     * authorization challenge) makes the AAD unique to one authentication session, so a
     * captured frame cannot be replayed into a later session even if the server reuses
     * the same clientId and the sequence counter lines up.
     */
    protected buildAAD(clientId: number, seq: number, dir: 'req' | 'res', session: string): Buffer {
        return Buffer.from(JSON.stringify({ c: clientId, s: seq, d: dir, v: session }), 'utf8')
    }

    /**
     * Encrypts a payload into a frame: base64url(nonce ‖ ciphertext ‖ authTag), AES-256-GCM.
     */
    protected frameEncrypt(payload: string, ek: Buffer, clientId: number, seq: number, dir: 'req' | 'res', session: string): string {
        const nonce = crypto.randomBytes(12)
        const cipher = crypto.createCipheriv('aes-256-gcm', this.u8(ek), this.u8(nonce), { authTagLength: 16 })
        cipher.setAAD(this.u8(this.buildAAD(clientId, seq, dir, session)))
        const ct = Buffer.concat([this.u8(cipher.update(payload, 'utf8')), this.u8(cipher.final())])
        return Buffer.concat([this.u8(nonce), this.u8(ct), this.u8(cipher.getAuthTag())]).toString('base64url')
    }

    /**
     * Decrypts a frame (base64url nonce ‖ ciphertext ‖ authTag) back to the payload.
     * Throws on a bad auth tag, mismatched AAD (session/channel/sequence/direction) or wrong sequence.
     */
    protected frameDecrypt(frame: string, ek: Buffer, clientId: number, seq: number, dir: 'req' | 'res', session: string): string {
        const raw = Buffer.from(frame, 'base64url')
        if (raw.length < 28) throw ErrorManager.make('GUARD_DECIPHER_FAILED', { error: 'Frame too short' })
        const nonce = raw.subarray(0, 12)
        const tag = raw.subarray(raw.length - 16)
        const ct = raw.subarray(12, raw.length - 16)
        const decipher = crypto.createDecipheriv('aes-256-gcm', this.u8(ek), this.u8(nonce), { authTagLength: 16 })
        decipher.setAAD(this.u8(this.buildAAD(clientId, seq, dir, session)))
        decipher.setAuthTag(this.u8(tag))
        return Buffer.concat([this.u8(decipher.update(this.u8(ct))), this.u8(decipher.final())]).toString('utf8')
    }

    /**
     * Encrypts an outbound (server→client) frame and advances the outbound sequence.
     */
    protected sendFrame(client: IGuardClient, clientId: number, payload: string): string {
        const ek = this.deriveEK(client)
        const seq = client.outSeq
        const frame = this.frameEncrypt(payload, ek, clientId, seq, 'res', client.verify)
        client.outSeq = seq + 1
        return frame
    }

    /**
     * Decrypts an inbound (client→server) frame and advances the inbound sequence.
     * The sequence only advances after a successful (authenticated) decrypt.
     */
    protected recvFrame(client: IGuardClient, clientId: number, frame: string): string {
        const ek = this.deriveEK(client)
        const seq = client.inSeq
        const payload = this.frameDecrypt(frame, ek, clientId, seq, 'req', client.verify)
        client.inSeq = seq + 1
        return payload
    }

    /**
     * Rate limiting for authentication attempts (brute-force protection).
     * Counted per source (client IP, falling back to provider:client). In-memory:
     * this is per-Guard state and does not need to survive a restart.
     */
    private rlKey(client: IGuardClient): string {
        const ip = client && client.additional && client.additional.ip
        return (ip as string) || `${client?.providerId}:${client?.clientId}`
    }

    /** True if the source has exhausted its failed-auth budget in the current window. */
    private rateLimited(client: IGuardClient): boolean {
        const now = Date.now()
        const e = this.rateLimit.get(this.rlKey(client))
        if (!e) return false
        if (now >= e.resetAt) { this.rateLimit.delete(this.rlKey(client)); return false }
        return e.count >= Guard.RL_MAX_ATTEMPTS
    }

    /** Record a failed authentication attempt for the source. */
    private rlFail(client: IGuardClient): void {
        const k = this.rlKey(client)
        const now = Date.now()
        let e = this.rateLimit.get(k)
        if (!e || now >= e.resetAt) { e = { count: 0, resetAt: now + Guard.RL_WINDOW_MS }; this.rateLimit.set(k, e) }
        e.count++
    }

    /** Clear the source's failure budget (e.g. after a successful auth). */
    private rlReset(client: IGuardClient): void {
        this.rateLimit.delete(this.rlKey(client))
    }

    /**
     * Generates a random string for encryption and subsequent authorization check
     * 
     * @param length Number of character pairs
    */
    protected uid(length: number) {
        return crypto.randomBytes(length).toString('hex')
    }
}
import { Device } from "vrack2-core";
import BasicPort from "vrack2-core/lib/ports/BasicPort";
import BasicType from "vrack2-core/lib/validator/types/BasicType";
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
    /** Server challenge nonce the cipher client must return encrypted in the proof */
    verify: string;
    level: number;
    /** Next expected inbound (client→server) frame sequence number */
    inSeq: number;
    /** Next outbound (server→client) frame sequence number */
    outSeq: number;
}
export default class Guard extends Device {
    guardedClients: {
        [key: number]: {
            [key: number]: IGuardClient;
        };
    };
    /** In-memory per-source failed-auth counters (keyed by client IP, falling back to provider:client) */
    rateLimit: Map<string, {
        count: number;
        resetAt: number;
    }>;
    /** Sliding window for rate limiting (60 s) */
    private static readonly RL_WINDOW_MS;
    /** Max failed auth attempts per source within the window */
    private static readonly RL_MAX_ATTEMPTS;
    /**
     * Server-side P-256 keypair for the asymmetric (ECDH) channel. Generated at start,
     * never persisted. The public key is sent to cipher clients in apiKeyAuth; the
     * private key stays here (used in deriveEK for ECDH).
     */
    protected serverPrivPem: string;
    protected serverPubPem: string;
    description(): string;
    inputs(): {
        [key: string]: BasicPort;
    };
    outputs(): {
        [key: string]: BasicPort;
    };
    checkOptions(): {
        [key: string]: BasicType;
    };
    onStart(): void;
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
        serverPub: string;
    } | {
        verify: string;
        cipher: boolean;
        serverPub?: undefined;
    }>;
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
    apiPrivateAuth(data: {
        frame: string;
    }, message: IGuardMessage): Promise<{
        level: number;
        cipher: boolean;
    }>;
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
    protected response(client: IGuardClient | undefined, request: any, result: string, resultData: any, wasCipher?: boolean): string;
    /**
     * Getting an internal client
     *
     * If the client was not found, it will throw a GUARD_CLIENT_NOT_REGISTERED exception
     * @param message Message
    */
    protected getClient(message: IGuardMessage | IProviderMessage): IGuardClient;
    /**
     * Normalizes a Buffer to the Uint8Array type the crypto APIs expect.
     * Purely a type-level cast (Buffer is a Uint8Array at runtime); it silences the
     * @types/node / TypeScript ≥5.7 generic skew where Buffer is Uint8Array<ArrayBufferLike>
     * but the crypto signatures expect Uint8Array<ArrayBuffer>.
     */
    protected u8(b: Buffer): Uint8Array;
    /**
     * Derives the per-channel encryption key (32 bytes) from the client secret
     * using HKDF-SHA256, so the raw secret is never used directly as a cipher key.
     *
     * @param client Internal guard client
     */
    protected deriveEK(client: IGuardClient): Buffer;
    /**
     * Builds the authenticated additional data binding the frame to this session,
     * channel, sequence number and direction. Including the per-session id (the
     * authorization challenge) makes the AAD unique to one authentication session, so a
     * captured frame cannot be replayed into a later session even if the server reuses
     * the same clientId and the sequence counter lines up.
     */
    protected buildAAD(clientId: number, seq: number, dir: 'req' | 'res', session: string): Buffer;
    /**
     * Encrypts a payload into a frame: base64url(nonce ‖ ciphertext ‖ authTag), AES-256-GCM.
     */
    protected frameEncrypt(payload: string, ek: Buffer, clientId: number, seq: number, dir: 'req' | 'res', session: string): string;
    /**
     * Decrypts a frame (base64url nonce ‖ ciphertext ‖ authTag) back to the payload.
     * Throws on a bad auth tag, mismatched AAD (session/channel/sequence/direction) or wrong sequence.
     */
    protected frameDecrypt(frame: string, ek: Buffer, clientId: number, seq: number, dir: 'req' | 'res', session: string): string;
    /**
     * Encrypts an outbound (server→client) frame and advances the outbound sequence.
     */
    protected sendFrame(client: IGuardClient, clientId: number, payload: string): string;
    /**
     * Decrypts an inbound (client→server) frame and advances the inbound sequence.
     * The sequence only advances after a successful (authenticated) decrypt.
     */
    protected recvFrame(client: IGuardClient, clientId: number, frame: string): string;
    /**
     * Rate limiting for authentication attempts (brute-force protection).
     * Counted per source (client IP, falling back to provider:client). In-memory:
     * this is per-Guard state and does not need to survive a restart.
     */
    private rlKey;
    /** True if the source has exhausted its failed-auth budget in the current window. */
    private rateLimited;
    /** Record a failed authentication attempt for the source. */
    private rlFail;
    /** Clear the source's failure budget (e.g. after a successful auth). */
    private rlReset;
    /**
     * Generates a random string for encryption and subsequent authorization check
     *
     * @param length Number of character pairs
    */
    protected uid(length: number): string;
}
export {};

export default interface IBroadcast {
    /** Provider ID  (Define by ProvidersClients devices) */
    providerId?: number;
    /** Client id for this provider id */
    clientId?: number;
    /** Command for broadcast  = 'broadcast' all time */
    command: string;
    /** Path to broadcast channel */
    channel: string;
    /** Broadcast data */
    data: any;
    /**
     * When a broadcast is made, it is made to all layers of the channels that was transmitted.
     * For example, for a `path.to.channel` channel, broadcasts will be made first to `path.to.channel` then `path.to` and `path`.
     * But for all of them the target will always be the same - `path.to.channel`. 
     * */
    target: string;
}

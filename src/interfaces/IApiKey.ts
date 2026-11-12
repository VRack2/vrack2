export default interface IApiKey {
    id: string;
    /** Unique key ID */
    name: string;
    /** Description of the purpose of the key */
    description: string;
    /** Key access level. Can be 1/2/3 by default */
    level: number;
    /** Key for access to VRack2 */
    key: string;
    /** Legacy: shared secret for the channel key (empty for new/asymmetric keys) */
    private: string;
    /** Client's P-256 public key (PEM). When set, the channel key is derived via ECDH. */
    public?: string;
}

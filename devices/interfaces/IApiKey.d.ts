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
    /** Key for traffic encryption  */
    private: string;
}

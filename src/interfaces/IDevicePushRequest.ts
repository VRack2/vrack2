export default interface IDevicePushRequest {
    /** Service ID */
    service: string;
    /** Service Device ID */
    device: string;
    /** Path to action like a 'path.to.action' */
    port: string;
    /** Data for action */
    data: any;
}

/**
 * Device action request
*/
export default interface IDeviceActionRequest {
    /** Service ID */
    service: string;
    /** Service Device ID */
    device: string;
    /** Path to action like a 'path.to.action' */
    action: string;
    /** Data for action */
    data: any;
}

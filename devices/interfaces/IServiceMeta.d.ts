/**
 * Service meta file structure
*/
export default interface IServiceMeta {
    /** Human service name */
    name: string;
    /** Service group */
    group: string;
    /** Service description in markdown style */
    description: string;
    /** If the service is marked as system, it cannot be turned off. */
    system: boolean;
    /** Run service on startup VRack */
    autoStart: boolean;
    /** Auto reload service if him crashed */
    autoReload: boolean;
}

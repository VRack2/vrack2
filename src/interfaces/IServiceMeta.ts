/**
 * Journal capture toggles for a service (unified VRack2-level journal).
 * Absent = everything captured.
*/
export interface IServiceJournal {
    /** Device event channels to capture: whitelist, or false = off. Absent = all. */
    events?: Array<string> | false;
    /** Capture outgoing port pushes. Absent = true. */
    ports?: boolean;
    /** Capture device metrics. Absent = true. */
    metrics?: boolean;
}

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
    /** Требуется ли сервису изоляция от основного процесса */
    isolated: boolean;
    /**  Список подписок на внутренние каналы */
    parentChannels?: Array<string>
    /** Journal capture toggles (absent = capture everything) */
    journal?: IServiceJournal
}

/**
 * Journal capture toggles for a service (unified VRack2-level journal).
 * Persisted in the meta file as flat keys: journalEvents / journalMetrics /
 * journalPorts. Defaults: events and metrics on, ports off — port logging is
 * a debug tool and must be enabled explicitly.
*/
export interface IJournalToggles {
    events?: boolean;
    ports?: boolean;
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
    parentChannels?: Array<string>;
    /** Capture device events to the master journal (default: true) */
    journalEvents?: boolean;
    /** Capture device metrics to the master journal (default: true) */
    journalMetrics?: boolean;
    /** Capture outgoing port pushes to the master journal (default: false, explicit opt-in) */
    journalPorts?: boolean;
}

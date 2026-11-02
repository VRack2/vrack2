import { Device } from "vrack2-core";
import BasicPort from "vrack2-core/lib/ports/BasicPort";
import BasicType from "vrack2-core/lib/validator/types/BasicType";
import { Store, Table } from 'vrack2-journal-db';
import type { AggAcc, ScanOptions } from 'vrack2-journal-db';
import IGuardMessage from "./interfaces/IGuardMessage";
import { IJournalToggles } from "./interfaces/IServiceMeta";
type RawRow = {
    ts: number;
    type: string;
    device: string;
    port: string | null;
    value: any;
};
type LogEntry = {
    t: number;
    l: number;
    n: number;
    type: string;
    device: string;
    port?: string;
    value: any;
};
/**
 * Journal — the unified VRack2-level journal of every service: device channel
 * events, outgoing port pushes and device metrics, captured in the worker and
 * forwarded (batched) to this device, which stores them in one journal-db
 * store (`<journalsDir>/<store>`) in three tables:
 *
 * - `service_event { ts, svc, device, event, data, trace }` — pure TTL
 * - `service_port  { ts, svc, device, port, data }` — pure TTL
 * - `service_metric { ts, svc, device, metric, value }` — Graphite-style
 *   retention tiers with min/max/sum/count/last/first rollups (same policy as
 *   core `JournalDbMetrics`), clustered by `['svc','device','metric']`.
 *
 * Because the journal lives at the platform level, `serviceLog` /
 * `serviceLogStats` / `serviceDeviceMetric` answer for any service at any
 * moment — running or not. Per-service capture toggles live in the service
 * meta (`journal: { events, ports, metrics }`) and are applied live via
 * `serviceLogSet` → `ServiceManager.setJournal`.
 *
 * The store dir is shared with the master's own boot-class journals
 * (`journals/vrack2`) — each table is owned by exactly one Store instance,
 * opened with `lock: 'off'` (the established journal-db pattern).
 */
export default class Journal extends Device {
    description(): string;
    outputs(): {
        [key: string]: BasicPort;
    };
    inputs(): {
        [key: string]: BasicPort;
    };
    checkOptions(): {
        [key: string]: BasicType;
    };
    DB: Store | null;
    eventTable: Table | null;
    portTable: Table | null;
    metricTable: Table | null;
    onStartAsync(): Promise<void>;
    onStop(): void;
    /**
     * Journal batch from a service worker (via WorkersManager.journal port).
     * Fail-soft: an append failure reports on system.error, capture continues.
     */
    inputJournal(data: {
        command?: string;
        events?: any[];
        ports?: any[];
        metrics?: any[];
    }): void;
    /**
     * Validate/normalize journal capture toggles (null = reset to defaults:
     * events/metrics on, ports off).
     */
    protected validateJournal(journal: any): IJournalToggles | null;
    protected svcWhere(service: string): NonNullable<ScanOptions['where']>;
    protected truncValue(value: any): any;
    protected sameValue(a: any, b: any): boolean;
    protected compress(rows: RawRow[]): LogEntry[];
    protected collectRaw(service: string, since: number | string, until: number | string, device?: string, type?: string): RawRow[];
    protected totalRows(service: string): number;
    onStart(): void;
    apiServiceLog(data: {
        service: string;
        limit?: number;
        device?: string;
        type?: string;
        since?: any;
        until?: any;
    }, gData: IGuardMessage): Promise<{
        entries: LogEntry[];
        total: number;
    }>;
    apiServiceLogStats(data: {
        service: string;
        period?: string;
        interval?: string;
        types?: string[];
        devices?: string[];
        maxBuckets?: number;
    }, gData: IGuardMessage): Promise<{
        start: number;
        end: number;
        interval: string;
        total: number;
        buckets: {
            start: number;
            end: number;
            senders: Array<{
                device: string;
                byType: Record<string, number>;
            }>;
        }[];
    }>;
    /**
     * Clear one service's rows via targeted deleteBy (crash-safe: each segment
     * is rewritten atomically via tmp+rename; a partial run is idempotent).
     * Metric tiers are kept (rollup RMW is unsafe).
     */
    apiServiceLogClear(data: {
        service: string;
    }, gData: IGuardMessage): Promise<{
        cleared: boolean;
        removedRows: number;
    }>;
    apiServiceLogSet(data: {
        service: string;
        journal: any;
    }, gData: IGuardMessage): Promise<any>;
    /**
     * Read a device metric from the unified journal — the same dense-grid
     * contract as core `JournalDbMetrics.read()` (vrack-db compatible).
     */
    apiServiceDeviceMetric(data: {
        service: string;
        device: string;
        metric: string;
        period: string;
        precision: string | number;
        func?: string;
    }, gData: IGuardMessage): Promise<any>;
    static readonly AGGREGATE_FUNCTIONS: string[];
    protected parsePrecision(start: number, end: number, precision: string | number): number;
    protected aggregateAcc(acc: AggAcc, func: string): number | null;
}
export {};

import { Device } from "vrack2-core";
import BasicPort from "vrack2-core/lib/ports/BasicPort";
import BasicType from "vrack2-core/lib/validator/types/BasicType";
import { Store, Table } from 'vrack2-journal-db';
import IGuardMessage from "./interfaces/IGuardMessage";
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
type JournalRef = {
    store: Store;
    deviceLog: Table | null;
    portLog: Table | null;
};
export default class ServiceJournal extends Device {
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
    private journals;
    onStart(): void;
    onStop(): void;
    private getJournal;
    private isServiceRunning;
    protected truncValue(value: any): any;
    protected sameValue(a: any, b: any): boolean;
    protected compress(rows: RawRow[]): LogEntry[];
    protected collectRaw(j: JournalRef, since: number | string, until: number | string): RawRow[];
    protected totalRows(j: JournalRef): number;
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
    apiServiceLogClear(data: {
        service: string;
    }, gData: IGuardMessage): Promise<{
        cleared: boolean;
        removedRows: number;
    }>;
}
export {};

import {
    Device,
    Port,
    Rule,
    ErrorManager,
} from "vrack2-core";

import BasicPort from "vrack2-core/lib/ports/BasicPort";
import BasicType from "vrack2-core/lib/validator/types/BasicType";

import { Store, Table, Interval } from 'vrack2-journal-db'
import type { Row, ScanOptions, TruncateResult } from 'vrack2-journal-db'
import path from 'path';

import IGuardMessage from "./interfaces/IGuardMessage";

ErrorManager.register('ServiceJournal', 'SJ_SERVICE_RUNNING', 'Service is running. Stop the service before clearing its journal', {
    service: Rule.string().example('test-service').description('Service id'),
})
ErrorManager.register('ServiceJournal', 'SJ_JOURNAL_NOT_FOUND', 'Journal data not found for this service (no device_log or port_log table)', {
    service: Rule.string().example('test-service').description('Service id'),
})
ErrorManager.register('ServiceJournal', 'SLS_STATS_TOO_MANY_BUCKETS', 'Too many buckets for the requested period/interval — use a coarser interval (e.g. 1d instead of 1h) or a shorter period')

type RawRow = {
    ts: number
    type: string
    device: string
    port: string | null
    value: any
}

type LogEntry = {
    t: number
    l: number
    n: number
    type: string
    device: string
    port?: string
    value: any
}

type JournalRef = { store: Store, deviceLog: Table | null, portLog: Table | null }

export default class ServiceJournal extends Device {

    description(): string {
        return `Устройство ServiceJournal — чтение и очистка журнала сервиса напрямую с диска (vrack2-journal-db),
без запускаемого сервиса. Команды: serviceLog (чтение device_log + port_log),
serviceLogStats (баке-статистика), serviceLogClear (truncate, только для остановленного сервиса).`
    }

    outputs(): { [key: string]: BasicPort; } {
        return {
            'register.command': Port.standard().description('Register command into master'),
        }
    }

    inputs(): { [key: string]: BasicPort; } {
        return {}
    }

    checkOptions(): { [key: string]: BasicType; } {
        return {
            'journalsDir': Rule.string().required().default('./journals').description('Base directory for journal-db stores'),
            'mergeWindow': Rule.number().integer().min(0).default(5).description('Max gap (sec) to merge consecutive identical records into one (t/l/n) at read time'),
            'valueMax': Rule.number().integer().min(32).default(500).description('Max stored value length (truncated at read time)'),
        }
    }

    private journals: Map<string, JournalRef> = new Map()

    onStart(): void {
        this.ports.output['register.command'].push({
            command: 'serviceLog',
            short: 'Service journal read',
            description: 'Read the service journal from disk: device events (device_log) + outgoing port pushes (port_log) in vrack2-journal-db. Works without the service being running. Consecutive identical values are compacted into one record (t/l/n).',
            level: 3,
            owner: this.type,
            icon: 'log-list',
            handler: this.apiServiceLog.bind(this),
            rules: {
                service: Rule.string().maxLength(120).required().example('test-service').description('Service id'),
                limit: Rule.number().integer().min(1).max(100000).default(20).description('Max entries to return (latest)'),
                device: Rule.string().maxLength(120).default('').example('').description('Filter by device id (empty - no filter)'),
                type: Rule.string().maxLength(20).default('').example('port').description('Filter by entry type: port|notify|alert|event|terminal|error|terminate (empty - no filter)'),
                since: Rule.any().default(0).example('now-1h').description('Only entries with t >= this timestamp. Absolute value in ms, or a relative spec like "now-1h"/"now-30m"/"now" (0 - no filter)'),
                until: Rule.any().default('now').example('now').description('Only entries with t <= this timestamp. Absolute value in ms, or a relative spec like "now-1h"/"now" (default "now")'),
            },
            return: Rule.object().fields({
                entries: Rule.array().content(Rule.object().fields({
                    t: Rule.number().integer().example(1).description('First timestamp (ms)'),
                    l: Rule.number().integer().example(1).description('Last timestamp (ms)'),
                    n: Rule.number().integer().example(1).description('Count of compacted occurrences'),
                    type: Rule.string().example('port').description('Entry type: port|notify|alert|event|terminal|error|terminate'),
                    device: Rule.string().example('DeviceID').description('Device id'),
                    port: Rule.string().example('state').description('Output port name (type=port)'),
                    value: Rule.any().description('Value / message'),
                })).description('Journal entries (chronological)'),
                total: Rule.number().integer().example(100).description('Total stored entries'),
            }).description('Journal read result')
        })

        this.ports.output['register.command'].push({
            command: 'serviceLogStats',
            short: 'Service journal stats',
            description: 'Compact journal statistics from disk: per time bucket (interval) over an arbitrary period — who (device) sent what (by type) and how much. Works without the service being running.',
            level: 3,
            owner: this.type,
            icon: 'bar-chart',
            handler: this.apiServiceLogStats.bind(this),
            rules: {
                service: Rule.string().maxLength(120).required().example('test-service').description('Service id'),
                period: Rule.string().default('now-24h:now').example('now-30d:now').description('Period "start:end"; bounds accept ms numbers or "now-1h"-like specs'),
                interval: Rule.string().default('1h').example('1d').description('Bucket size: "15m", "1h", "1d", "1w" or plain ms'),
                types: Rule.array().content(Rule.string().maxLength(20)).default([]).example(['error']).description('Filter by entry type: port|notify|alert|event|terminal|error|terminate (empty - all)'),
                devices: Rule.array().content(Rule.string().maxLength(120)).default([]).example(['Mixer1']).description('Filter by device id (empty - all)'),
                maxBuckets: Rule.number().integer().min(2).max(20000).default(5000).description('Max buckets to return; use a coarser interval if the period is wider'),
            },
            return: Rule.object().fields({
                start: Rule.number().integer().example(1718000000000).description('Period start (ms)'),
                end: Rule.number().integer().example(1718100000000).description('Period end (ms)'),
                interval: Rule.string().example('1d').description('Bucket size (as requested)'),
                total: Rule.number().integer().example(4500).description('Total records in period (after filters)'),
                buckets: Rule.array().content(Rule.object().fields({
                    start: Rule.number().integer().example(1718000000000).description('Bucket interval start (ms)'),
                    end: Rule.number().integer().example(1718100000000).description('Bucket interval end (ms)'),
                    senders: Rule.array().content(Rule.object().fields({
                        device: Rule.string().example('HttpServer').description('Device id (sender)'),
                        byType: Rule.any().example({ port: 51, notify: 21 }).description('Counts by type (non-zero only)'),
                    })).description('Senders in this bucket, sorted by total count desc'),
                })).description('Dense buckets, chronological (empty buckets kept — journal gaps are visible)'),
            }).description('Journal stats result')
        })

        this.ports.output['register.command'].push({
            command: 'serviceLogClear',
            short: 'Service journal clear',
            description: 'Clear the service journal (truncate the device_log and port_log tables in vrack2-journal-db). Only works when the service is NOT running.',
            level: 3,
            owner: this.type,
            icon: 'log-list',
            handler: this.apiServiceLogClear.bind(this),
            rules: {
                service: Rule.string().maxLength(120).required().example('test-service').description('Service id'),
            },
            return: Rule.object().fields({
                cleared: Rule.boolean().example(true).description('Journal cleared'),
                removedRows: Rule.number().integer().example(123).description('Rows removed from both tables'),
            }).description('Clear result')
        })
    }

    onStop(): void {
        for (const entry of this.journals.values()) {
            try { entry.store.closeAll() } catch { /* ignore */ }
        }
        this.journals.clear()
    }

    private getJournal(serviceId: string): JournalRef {
        let entry = this.journals.get(serviceId)
        if (entry) return entry

        const baseDir = path.resolve(this.options.journalsDir, serviceId)
        const store = new Store(baseDir, { lock: 'off' })
        store.init()

        let deviceLog: Table | null = null
        let portLog: Table | null = null
        try { deviceLog = store.open('device_log') } catch { deviceLog = null }
        try { portLog = store.open('port_log') } catch { portLog = null }

        entry = { store, deviceLog, portLog }
        this.journals.set(serviceId, entry)
        return entry
    }

    private isServiceRunning(serviceId: string): boolean {
        const sm = this.Container.devices['ServiceManager'] as any
        if (!sm) return false
        return !!(sm.servicesList?.[serviceId]?.run)
    }

    protected truncValue(value: any): any {
        if (value === undefined || value === null) return value
        const max = Number(this.options.valueMax) || 500
        if (typeof value === 'string') return value.length > max ? value.slice(0, max) + '…' : value
        if (typeof value === 'object') {
            try {
                const s = JSON.stringify(value)
                return s.length > max ? s.slice(0, max) + '…' : value
            } catch {
                return String(value).slice(0, max)
            }
        }
        return value
    }

    protected sameValue(a: any, b: any): boolean {
        try { return JSON.stringify(a) === JSON.stringify(b) } catch { return false }
    }

    protected compress(rows: RawRow[]): LogEntry[] {
        const mergeWindowMs = (Number(this.options.mergeWindow) || 0) * 1000
        const out: LogEntry[] = []
        for (const r of rows) {
            const last = out[out.length - 1]
            if (last
                && last.type === r.type
                && last.device === r.device
                && (last.port ?? null) === (r.port ?? null)
                && this.sameValue(last.value, r.value)
                && (r.ts - last.l) <= mergeWindowMs) {
                last.l = r.ts
                last.n++
            } else {
                out.push({ t: r.ts, l: r.ts, n: 1, type: r.type, device: r.device, port: r.port === null ? undefined : r.port, value: this.truncValue(r.value) })
            }
        }
        return out
    }

    protected collectRaw(j: JournalRef, since: number | string, until: number | string): RawRow[] {
        const raw: RawRow[] = []
        if (j.deviceLog) {
            for (const r of j.deviceLog.query(since, until) as Row[]) {
                raw.push({ ts: Number(r.ts), type: String(r.event), device: String(r.device), port: null, value: r.data })
            }
        }
        if (j.portLog) {
            for (const r of j.portLog.query(since, until) as Row[]) {
                raw.push({ ts: Number(r.ts), type: 'port', device: String(r.device), port: (r.port === null || r.port === undefined) ? null : String(r.port), value: r.data })
            }
        }
        return raw
    }

    protected totalRows(j: JournalRef): number {
        let n = 0
        if (j.deviceLog) n += j.deviceLog.allRows().length
        if (j.portLog) n += j.portLog.allRows().length
        return n
    }

    async apiServiceLog(data: { service: string; limit?: number; device?: string; type?: string; since?: any; until?: any }, gData: IGuardMessage) {
        const j = this.getJournal(data.service)
        if (!j.deviceLog && !j.portLog) throw ErrorManager.make('SJ_JOURNAL_NOT_FOUND', { service: data.service })

        const limit = (data.limit === undefined || data.limit < 1) ? 20 : data.limit
        const since = (data.since === undefined || data.since === null || data.since === '' || data.since === 0) ? 0 : data.since
        const until = (data.until === undefined || data.until === null || data.until === '') ? 'now' : data.until

        const total = this.totalRows(j)
        const raw = this.collectRaw(j, since, until)

        const filtered = raw.filter(r =>
            (!data.device || r.device === data.device)
            && (!data.type || r.type === data.type)
        )

        filtered.sort((a, b) => a.ts - b.ts)
        const entries = this.compress(filtered).slice(-limit)

        return { entries, total }
    }

    async apiServiceLogStats(data: { service: string; period?: string; interval?: string; types?: string[]; devices?: string[]; maxBuckets?: number }, gData: IGuardMessage) {
        const j = this.getJournal(data.service)
        if (!j.deviceLog && !j.portLog) throw ErrorManager.make('SJ_JOURNAL_NOT_FOUND', { service: data.service })

        const period = data.period ?? 'now-24h:now'
        const [start, end] = Interval.period(period)
        const intervalStr = data.interval ?? '1h'
        const intervalMs = Interval.parseInterval(intervalStr)
        if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new RangeError('Bad interval: ' + intervalStr)

        const firstBucket = Math.floor(start / intervalMs) * intervalMs
        const lastBucket = Math.floor(end / intervalMs) * intervalMs
        const nBuckets = Math.round((lastBucket - firstBucket) / intervalMs) + 1
        const maxBuckets = Number(data.maxBuckets) || 5000
        if (nBuckets > maxBuckets) throw ErrorManager.make('SLS_STATS_TOO_MANY_BUCKETS', { nBuckets, maxBuckets })

        const wantedTypes = (data.types ?? []).map(t => String(t)).filter(Boolean)
        const wantedDevices = (data.devices ?? []).map(d => String(d)).filter(Boolean)
        const deviceWhere: NonNullable<ScanOptions['where']> = wantedDevices.length ? [{ field: 'device', op: 'in', value: wantedDevices }] : []

        const acc = new Map<number, Map<string, Map<string, number>>>()
        let total = 0
        const add = (ts: number, type: string, device: string) => {
            const b = Math.floor(ts / intervalMs) * intervalMs
            let dm = acc.get(b)
            if (!dm) { dm = new Map(); acc.set(b, dm) }
            let tm = dm.get(device)
            if (!tm) { tm = new Map(); dm.set(device, tm) }
            tm.set(type, (tm.get(type) ?? 0) + 1)
            total++
        }

        const eventTypes = wantedTypes.length ? wantedTypes.filter(t => t !== 'port') : null
        if (j.deviceLog && (!eventTypes || eventTypes.length)) {
            const where = [...deviceWhere]
            if (eventTypes) where.push({ field: 'event', op: 'in', value: eventTypes })
            const rows = j.deviceLog.scan({ start, end, select: ['ts', 'event', 'device'], where })
            for (const r of rows) { const dev = String(r.device); add(Number(r.ts), String(r.event), dev) }
        }
        if (j.portLog && (!wantedTypes.length || wantedTypes.includes('port'))) {
            const rows = j.portLog.scan({ start, end, select: ['ts', 'device'], where: deviceWhere })
            for (const r of rows) { const dev = String(r.device); add(Number(r.ts), 'port', dev) }
        }

        const sumByType = (byType: Record<string, number>): number => {
            let s = 0
            for (const k in byType) s += byType[k]
            return s
        }

        const buckets: Array<{ start: number, end: number, senders: Array<{ device: string, byType: Record<string, number> }> }> = []
        for (let b = firstBucket; b <= lastBucket; b += intervalMs) {
            const dm = acc.get(b)
            const senders: Array<{ device: string, byType: Record<string, number> }> = []
            if (dm) {
                for (const [device, tm] of dm) {
                    const byType: Record<string, number> = {}
                    for (const [t, c] of tm) byType[t] = c
                    senders.push({ device, byType })
                }
            }
            senders.sort((a, b2) => sumByType(b2.byType) - sumByType(a.byType))
            buckets.push({ start: b, end: b + intervalMs, senders })
        }

        return { start, end, interval: intervalStr, total, buckets }
    }

    async apiServiceLogClear(data: { service: string }, gData: IGuardMessage) {
        if (this.isServiceRunning(data.service)) {
            throw ErrorManager.make('SJ_SERVICE_RUNNING', { service: data.service })
        }

        const j = this.getJournal(data.service)
        if (!j.deviceLog && !j.portLog) throw ErrorManager.make('SJ_JOURNAL_NOT_FOUND', { service: data.service })

        let removedRows = 0
        if (j.deviceLog) removedRows += (j.deviceLog.truncate() as TruncateResult).removedRows
        if (j.portLog) removedRows += (j.portLog.truncate() as TruncateResult).removedRows

        return { cleared: true, removedRows }
    }
}

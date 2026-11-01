import {
    Device,
    Port,
    Rule,
    ErrorManager,
} from "vrack2-core";

import BasicPort from "vrack2-core/lib/ports/BasicPort";
import BasicType from "vrack2-core/lib/validator/types/BasicType";

import { Store, Table, Interval, Aggregation, defineLogTable } from 'vrack2-journal-db'
import type { AggAcc, Row, ScanOptions } from 'vrack2-journal-db'
import path from 'path';

import IGuardMessage from "./interfaces/IGuardMessage";
import { IServiceJournal } from "./interfaces/IServiceMeta";

ErrorManager.register('Journal', 'JRN_JOURNAL_NOT_FOUND', 'Journal data not found for this service (no rows in the unified journal tables)', {
    service: Rule.string().example('test-service').description('Service id'),
})
ErrorManager.register('Journal', 'JRN_STATS_TOO_MANY_BUCKETS', 'Too many buckets for the requested period/interval — use a coarser interval (e.g. 1d instead of 1h) or a shorter period')
ErrorManager.register('Journal', 'JRN_BAD_JOURNAL', 'Bad journal capture config: expected null or { events: [channel,...] | false, ports: boolean, metrics: boolean }')
ErrorManager.register('Journal', 'JRN_POINTS_LIMIT', 'Read window exceeds maxReadPoints — narrow the period or coarsen the precision', {
    points: Rule.number().required().description('Points/rows the call would materialize'),
    limit: Rule.number().required().description('Configured maxReadPoints'),
})
ErrorManager.register('Journal', 'JRN_SERVICE_MANAGER_NF', 'ServiceManager device not found in this container (serviceLogSet needs it to persist and live-toggle the journal)')

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

    description(): string {
        return `Устройство Journal — единый журнал всех сервисов уровня VRack2 (события устройств, пуши портов, метрики),
хранимый на платформе: данные читаются в любое время, даже когда сервис остановлен.
Команды: serviceLog, serviceLogStats, serviceLogClear, serviceLogSet, serviceDeviceMetric.`
    }

    outputs(): { [key: string]: BasicPort; } {
        return {
            'register.command': Port.standard().description('Register command into master'),
        }
    }

    inputs(): { [key: string]: BasicPort; } {
        return {
            'journal': Port.standard().requirement(
                Rule.object().description('Batched journal message from a service worker: { command: "journal", events, ports, metrics }')
            ).description('Journal batch from WorkersManager'),
        }
    }

    checkOptions(): { [key: string]: BasicType; } {
        return {
            'journalsDir': Rule.string().required().default('./journals').description('Base directory for the unified journal-db store'),
            'store': Rule.string().required().default('vrack2').description('Store name (subdir of journalsDir) holding the unified journal tables'),
            'eventRetention': Rule.string().required().default('1s:30d').description('service_event retention "res:ttl" (single tier = pure TTL)'),
            'portRetention': Rule.string().required().default('1s:30d').description('service_port retention "res:ttl" (single tier = pure TTL)'),
            'metricRetention': Rule.string().required().default('5s:10m, 1m:2h, 15m:1d, 1h:1w, 6h:1mon, 1d:1y').description('service_metric retention "res:ttl[,...]" (multi-tier = rollups)'),
            'mergeWindow': Rule.number().integer().min(0).default(5).description('Max gap (sec) to merge consecutive identical records into one (t/l/n) at read time'),
            'valueMax': Rule.number().integer().min(32).default(500).description('Max stored value length (truncated at read time)'),
            'maxReadPoints': Rule.number().integer().min(10).default(200000).description('Max grid buckets / scanned rows a single serviceDeviceMetric read may materialize'),
        }
    }

    DB: Store | null = null
    eventTable: Table | null = null
    portTable: Table | null = null
    metricTable: Table | null = null

    async onStartAsync(): Promise<void> {
        const baseDir = path.resolve(this.options.journalsDir, this.options.store)
        // wal:'off' — rows persist on segment rotation/closeAll() only;
        // an abrupt master stop may lose the un-rotated tail.
        this.DB = new Store(baseDir, { lock: 'off', wal: 'off' })
        this.DB.init()
        this.eventTable = this.DB.create(defineLogTable({
            name: 'service_event',
            desc: 'Device channel events of every service: { ts, svc, device, event, data, trace }',
            columns: { ts: 'delta', svc: 'dictionary', device: 'dictionary', event: 'dictionary', data: 'auto', trace: 'catchall' },
            retention: this.options.eventRetention,
        }))
        this.portTable = this.DB.create(defineLogTable({
            name: 'service_port',
            desc: 'Outgoing port pushes of every service: { ts, svc, device, port, data }',
            columns: { ts: 'delta', svc: 'dictionary', device: 'dictionary', port: 'dictionary', data: 'auto' },
            retention: this.options.portRetention,
        }))
        this.metricTable = this.DB.create(defineLogTable({
            name: 'service_metric',
            desc: 'Device metrics of every service: { ts, svc, device, metric, value }',
            columns: { ts: 'delta', svc: 'auto', device: 'auto', metric: 'auto', value: 'auto' },
            retention: this.options.metricRetention,
            agg: { value: ['min', 'max', 'sum', 'count', 'last', 'first'] },
            dims: ['svc', 'device', 'metric'],
            cluster: ['svc', 'device', 'metric'],
        }))
    }

    onStop(): void {
        if (this.DB) {
            // flush rotates a segment per call; merge the pieces back on a
            // graceful stop so the store does not accumulate thousands of
            // tiny segments between auto-compaction passes.
            for (const t of [this.eventTable, this.portTable, this.metricTable]) {
                if (!t) continue
                t.flush()
                t.compact()
            }
            this.DB.closeAll()
            this.DB = null
            this.eventTable = null
            this.portTable = null
            this.metricTable = null
        }
    }

    /**
     * Journal batch from a service worker (via WorkersManager.journal port).
     * Fail-soft: an append failure reports on system.error, capture continues.
     */
    inputJournal(data: { command?: string, events?: any[], ports?: any[], metrics?: any[] }) {
        if (!this.eventTable || !this.portTable || !this.metricTable) return
        try {
            for (const r of data.events ?? []) {
                this.eventTable.append({ ts: r.ts, svc: r.svc, device: r.device, event: r.event, data: r.data, trace: r.trace })
            }
            for (const r of data.ports ?? []) {
                this.portTable.append({ ts: r.ts, svc: r.svc, device: r.device, port: r.port, data: r.data })
            }
            for (const r of data.metrics ?? []) {
                this.metricTable.append({
                    ts: r.ts,
                    svc: String(r.svc).toLowerCase(),
                    device: String(r.device).toLowerCase(),
                    metric: String(r.metric).toLowerCase(),
                    value: r.value,
                })
            }
        } catch (e) {
            this.error('Journal append failed', e as Error)
        }
    }

    /**
     * Validate/normalize a journal capture config (null = default = capture all).
     */
    protected validateJournal(journal: any): IServiceJournal | null {
        if (journal === null || journal === undefined) return null
        if (typeof journal !== 'object' || Array.isArray(journal)) throw ErrorManager.make('JRN_BAD_JOURNAL')
        const out: IServiceJournal = {}
        if (journal.events !== undefined) {
            if (journal.events === false) out.events = false
            else if (Array.isArray(journal.events) && journal.events.every((c: any) => typeof c === 'string')) out.events = journal.events.slice()
            else throw ErrorManager.make('JRN_BAD_JOURNAL')
        }
        if (journal.ports !== undefined) {
            if (typeof journal.ports !== 'boolean') throw ErrorManager.make('JRN_BAD_JOURNAL')
            out.ports = journal.ports
        }
        if (journal.metrics !== undefined) {
            if (typeof journal.metrics !== 'boolean') throw ErrorManager.make('JRN_BAD_JOURNAL')
            out.metrics = journal.metrics
        }
        return out
    }

    protected svcWhere(service: string): NonNullable<ScanOptions['where']> {
        return [{ field: 'svc', op: 'eq', value: service }]
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

    protected collectRaw(service: string, since: number | string, until: number | string, device?: string, type?: string): RawRow[] {
        const raw: RawRow[] = []
        const eventWhere: NonNullable<ScanOptions['where']> = this.svcWhere(service)
        const portWhere: NonNullable<ScanOptions['where']> = this.svcWhere(service)
        if (device) {
            eventWhere.push({ field: 'device', op: 'eq', value: device })
            portWhere.push({ field: 'device', op: 'eq', value: device })
        }
        if (this.eventTable && type !== 'port') {
            if (type) eventWhere.push({ field: 'event', op: 'eq', value: type })
            for (const r of this.eventTable.scan({ start: since, end: until, where: eventWhere, select: ['ts', 'event', 'device', 'data'] }) as Row[]) {
                raw.push({ ts: Number(r.ts), type: String(r.event), device: String(r.device), port: null, value: r.data })
            }
        }
        if (this.portTable && type !== undefined && type !== '' && type !== 'port') {
            // type is an event type — portTable has no matching rows
        } else if (this.portTable) {
            for (const r of this.portTable.scan({ start: since, end: until, where: portWhere, select: ['ts', 'device', 'port', 'data'] }) as Row[]) {
                raw.push({ ts: Number(r.ts), type: 'port', device: String(r.device), port: (r.port === null || r.port === undefined) ? null : String(r.port), value: r.data })
            }
        }
        return raw
    }

    protected totalRows(service: string): number {
        let n = 0
        if (this.eventTable) n += (this.eventTable.aggregate(0, 'now', [{ field: 'ts', fn: 'count' }], this.svcWhere(service)) as Record<string, number | null>).ts_count ?? 0
        if (this.portTable) n += (this.portTable.aggregate(0, 'now', [{ field: 'ts', fn: 'count' }], this.svcWhere(service)) as Record<string, number | null>).ts_count ?? 0
        return n
    }

    onStart(): void {
        this.ports.output['register.command'].push({
            command: 'serviceLog',
            short: 'Service journal read',
            description: 'Read the unified VRack2 journal of a service: device events + outgoing port pushes. Works whether or not the service is running (the journal lives at the platform level). Consecutive identical values are compacted into one record (t/l/n).',
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
            description: 'Compact journal statistics: per time bucket (interval) over an arbitrary period — who (device) sent what (by type) and how much. Works whether or not the service is running.',
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
            description: 'Clear the journal of one service (removes its rows from the unified service_event/service_port tables, other services untouched). Metric tiers are kept.',
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

        this.ports.output['register.command'].push({
            command: 'serviceLogSet',
            short: 'Service journal capture config',
            description: 'Set per-service journal capture toggles (persisted in the service meta and applied live on a running service): journal = null (default: capture everything) or { events: [channel,...] | false, ports: boolean, metrics: boolean }.',
            level: 3,
            owner: this.type,
            icon: 'log-list',
            handler: this.apiServiceLogSet.bind(this),
            rules: {
                service: Rule.string().maxLength(120).required().example('test-service').description('Service id'),
                journal: Rule.any().default(null).example({ events: ['error', 'alert'], ports: false, metrics: true }).description('null = default (all), or { events: [channel,...] | false, ports: boolean, metrics: boolean }'),
            },
            return: Rule.object().fields({
                journal: Rule.any().description('Journal capture config after the call (null = default)'),
            }).description('Set result')
        })

        this.ports.output['register.command'].push({
            command: 'serviceDeviceMetric',
            short: 'Get service device metric',
            description: 'Getting a service device metric from the unified platform journal. Works whether or not the service is running.',
            level: 3,
            owner: this.type,
            icon: 'graph-up',
            handler: this.apiServiceDeviceMetric.bind(this),
            rules: {
                service: Rule.string().maxLength(120).required().example('test-service').description('Service id'),
                device: Rule.string().maxLength(120).required().example('DeviceID').description('Device id'),
                metric: Rule.string().maxLength(120).required().example('metric.id').description('Device metric path'),
                period: Rule.string().maxLength(120).required().example('now-1h:now').description('Journal period'),
                precision: Rule.string().maxLength(60).required().example('30s').description('Bucket size: interval string or point count'),
                func: Rule.string().default('last').maxLength(10).example('last').description('Read function (last,first,min,max,avg,sum)')
            },
            return: Rule.object().fields({
                relevant: Rule.boolean().default(false).example(false).description('result relevance flag'),
                start: Rule.number().integer().example(1).description('Beginning of the period (seconds)'),
                end: Rule.number().integer().example(100).description('End of period (seconds)'),
                rows: Rule.array().content(
                    Rule.object().fields({
                        time: Rule.number().integer().example(10).description('Time in seconds'),
                        value: Rule.number().example(12.3223).description('Metric value || null')
                    }).description('Metric storage object')
                ).description('Array of metrics')
            }).description('Metric request result - see vrack2-journal-db read documentation')
        })
    }

    async apiServiceLog(data: { service: string; limit?: number; device?: string; type?: string; since?: any; until?: any }, gData: IGuardMessage) {
        const limit = (data.limit === undefined || data.limit < 1) ? 20 : data.limit
        const since = (data.since === undefined || data.since === null || data.since === '' || data.since === 0) ? 0 : data.since
        const until = (data.until === undefined || data.until === null || data.until === '') ? 'now' : data.until

        const total = this.totalRows(data.service)
        const raw = this.collectRaw(data.service, since, until, data.device || undefined, data.type || undefined)

        raw.sort((a, b) => a.ts - b.ts)
        const entries = this.compress(raw).slice(-limit)

        return { entries, total }
    }

    async apiServiceLogStats(data: { service: string; period?: string; interval?: string; types?: string[]; devices?: string[]; maxBuckets?: number }, gData: IGuardMessage) {
        const period = data.period ?? 'now-24h:now'
        const [start, end] = Interval.period(period)
        const intervalStr = data.interval ?? '1h'
        const intervalMs = Interval.parseInterval(intervalStr)
        if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new RangeError('Bad interval: ' + intervalStr)

        const firstBucket = Math.floor(start / intervalMs) * intervalMs
        const lastBucket = Math.floor(end / intervalMs) * intervalMs
        const nBuckets = Math.round((lastBucket - firstBucket) / intervalMs) + 1
        const maxBuckets = Number(data.maxBuckets) || 5000
        if (nBuckets > maxBuckets) throw ErrorManager.make('JRN_STATS_TOO_MANY_BUCKETS', { nBuckets, maxBuckets })

        const wantedTypes = (data.types ?? []).map(t => String(t)).filter(Boolean)
        const wantedDevices = (data.devices ?? []).map(d => String(d)).filter(Boolean)
        const baseWhere: NonNullable<ScanOptions['where']> = this.svcWhere(data.service)
        if (wantedDevices.length) baseWhere.push({ field: 'device', op: 'in', value: wantedDevices })

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
        if (this.eventTable && (!eventTypes || eventTypes.length)) {
            const where = [...baseWhere]
            if (eventTypes) where.push({ field: 'event', op: 'in', value: eventTypes })
            for (const r of this.eventTable.scan({ start, end, select: ['ts', 'event', 'device'], where }) as Row[]) {
                add(Number(r.ts), String(r.event), String(r.device))
            }
        }
        if (this.portTable && (!wantedTypes.length || wantedTypes.includes('port'))) {
            for (const r of this.portTable.scan({ start, end, select: ['ts', 'device'], where: baseWhere }) as Row[]) {
                add(Number(r.ts), 'port', String(r.device))
            }
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

    /**
     * Clear one service's rows via targeted deleteBy (crash-safe: each segment
     * is rewritten atomically via tmp+rename; a partial run is idempotent).
     * Metric tiers are kept (rollup RMW is unsafe).
     */
    async apiServiceLogClear(data: { service: string }, gData: IGuardMessage) {
        let removedRows = 0
        for (const table of [this.eventTable, this.portTable]) {
            if (!table) continue
            const result = table.deleteBy([{ field: 'svc', op: 'eq', value: data.service }])
            removedRows += result.removedRows
        }
        return { cleared: true, removedRows }
    }

    async apiServiceLogSet(data: { service: string, journal: any }, gData: IGuardMessage) {
        const journal = this.validateJournal(data.journal)
        const sm = this.Container.devices['ServiceManager'] as any
        if (!sm || typeof sm.setJournal !== 'function') throw ErrorManager.make('JRN_SERVICE_MANAGER_NF')
        return await sm.setJournal(data.service, journal)
    }

    /**
     * Read a device metric from the unified journal — the same dense-grid
     * contract as core `JournalDbMetrics.read()` (vrack-db compatible).
     */
    async apiServiceDeviceMetric(data: { service: string, device: string, metric: string, period: string, precision: string | number, func?: string }, gData: IGuardMessage): Promise<any> {
        if (!this.metricTable) throw ErrorManager.make('JRN_JOURNAL_NOT_FOUND', { service: data.service })
        const func = data.func ?? 'last'
        if (!Journal.AGGREGATE_FUNCTIONS.includes(func)) throw new RangeError(`Journal: unknown aggregate function '${func}' (available: ${Journal.AGGREGATE_FUNCTIONS.join(', ')})`)

        const [start, end] = Interval.period(data.period)
        const step = this.parsePrecision(start, end, data.precision)
        const grid = Interval.getIntervals(start, end, step)
        const max = Number(this.options.maxReadPoints) || 200000
        if (grid.length > max) throw ErrorManager.make('JRN_POINTS_LIMIT', { points: grid.length, limit: max })
        const s = grid[0]
        const e = grid[grid.length - 1]

        const where: NonNullable<ScanOptions['where']> = [
            { field: 'svc', op: 'eq', value: data.service.toLowerCase() },
            { field: 'device', op: 'eq', value: data.device.toLowerCase() },
            { field: 'metric', op: 'eq', value: String(data.metric).toLowerCase() },
        ]
        const buckets: (AggAcc | null)[] = new Array(grid.length).fill(null)
        let seen = 0
        for (const row of this.metricTable.scan({
            start, end, where,
            select: ['ts', 'value', 'value_min', 'value_max', 'value_sum', 'value_count', 'value_avg', 'value_last', 'value_last_ts', 'value_first', 'value_first_ts'],
        }) as Row[]) {
            const t = row.ts
            if (typeof t !== 'number') continue
            seen++
            const i = Math.min(grid.length - 1, Math.max(0, Math.floor((t - s) / step)))
            const acc = buckets[i] ??= Aggregation.newAcc()
            if (Aggregation.hasRollupCols(row, 'value')) {
                const o = Aggregation.fromRollupRow(row, 'value')
                if (o !== null) Aggregation.merge(acc, o)
            } else {
                const v = row.value
                if (typeof v === 'number' && Number.isFinite(v)) Aggregation.addValue(acc, v, t)
            }
        }

        return {
            relevant: seen > 0,
            start: s / 1000,
            end: e / 1000,
            rows: grid.map((time, i) => ({ time: time / 1000, value: buckets[i] ? this.aggregateAcc(buckets[i] as AggAcc, func) : null })),
        }
    }

    static readonly AGGREGATE_FUNCTIONS: string[] = ['last', 'first', 'max', 'min', 'avg', 'sum']

    protected parsePrecision(start: number, end: number, precision: string | number): number {
        if (typeof precision === 'number') return Interval.getIntervalOfFixedCount(start, end, precision)
        const s = String(precision).trim()
        if (/^\d+$/.test(s)) return Interval.getIntervalOfFixedCount(start, end, parseInt(s, 10))
        return Interval.parseInterval(s)
    }

    protected aggregateAcc(acc: AggAcc, func: string): number | null {
        switch (func) {
            case 'last': return acc.count > 0 ? acc.lastVal : null
            case 'first': return acc.count > 0 ? acc.firstVal : null
            case 'max': return acc.count > 0 ? acc.max : null
            case 'min': return acc.count > 0 ? acc.min : null
            case 'avg': return acc.count > 0 ? acc.sum / acc.count : null
            case 'sum': return acc.count > 0 ? acc.sum : null
            default: throw new RangeError(`Journal: unknown aggregate function '${func}'`)
        }
    }
}

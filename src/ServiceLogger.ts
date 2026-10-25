import {
    Container,
    Device,
    Port,
    Rule,
    ErrorManager,
    ServiceLogger as CoreServiceLogger,
    PortLogger as CorePortLogger,
} from "vrack2-core";

import BasicPort from "vrack2-core/lib/ports/BasicPort";
import BasicType from "vrack2-core/lib/validator/types/BasicType";

import { Interval } from 'vrack2-journal-db'
import type { Row, ScanOptions } from 'vrack2-journal-db'

import IGuardMessage from "./interfaces/IGuardMessage";

ErrorManager.register('ServiceLogger', 'SERVICE_JOURNAL_DISABLED', 'Service journal is unavailable. Enable the core ServiceLogger/PortLogger boot classes (vrack2-core.DEFAULT_BOOTLIST) for this service and restart')
ErrorManager.register('ServiceLogger', 'SLS_STATS_TOO_MANY_BUCKETS', 'Too many buckets for the requested period/interval — use a coarser interval (e.g. 1d instead of 1h) or a shorter period')

/**
 * Единая «сырая» строка журнала, независимо от того, из какой таблицы она:
 * device_log (boot-класс ServiceLogger) или port_log (boot-класс PortLogger).
 */
type RawRow = {
    ts: number          // ms (Date.now())
    type: string        // port | notify | alert | event | terminal | error | terminate
    device: string
    port: string | null // имя выходного порта (только для type=port)
    value: any          // payload (event data / port data)
}

/** Компактированная запись журнала (формат MCP-ответа) */
type LogEntry = {
    t: number           // время первой записи (сек)
    l: number           // время последней записи (сек)
    n: number           // количество повторений
    type: string
    device: string
    port?: string
    value: any
}

/**
 * Device-обёртка над core-boot-классами журнала.
 *
 * С этой итерации сам захват и хранение журнала вынесены в core:
 *   - `vrack2-core.ServiceLogger` (таблица `device_log`) — события каналов устройств
 *     (terminal/notify/event/alert/error/terminate, без render),
 *   - `vrack2-core.PortLogger`  (таблица `port_log`)  — исходящие push'ы устройств.
 * Оба boot-класса живут в контейнере сервиса (MainProcess.DEFAULT_BOOTLIST),
 * владеют store vrack2-journal-db и сами пишут строки.
 *
 * Это устройство — только поверх интерфейса команд/чтения:
 *   - serviceLog        — чтение обеих таблиц (device_log + port_log), фильтр,
 *                         склейка повторяющихся (t/l/n) при чтении;
 *   - serviceLogStats   — компактная статистика: по бакетам (interval) за произвольный
 *                         период — кто (device) что (byType) и сколько отправил
 *                         (senders внутри каждого бакета, по убыванию количества);
 *   - serviceLogSet     — live вкл/выкл обоих boot-классов (enable/disable);
 *   - serviceLogClear   — truncate обеих таблиц.
 *
 * Контейнер сервиса приходит по входному порту `container` (его передаёт
 * Service.ts в worker'е до run()); device достаёт из него boot-классы через
 * `container.Bootstrap.getBootClass(...)`.
 */
export default class ServiceLogger extends Device {

    description(): string {
        return `Устройство ServiceLogger — поверх журнала запущенного сервиса, который ведут core-boot-классы
vrack2-core.ServiceLogger (таблица device_log: события устройств) и vrack2-core.PortLogger (таблица port_log:
исходящие push'ы устройств), хранящие данные в vrack2-journal-db (<path>/<service>).
Команды: serviceLog (чтение обеих таблиц со склейкой t/l/n), serviceLogSet (live вкл/выкл),
serviceLogClear (truncate).`
    }

    inputs(): { [key: string]: BasicPort; } {
        return {
            container: Port.standard()
                .requirement(Rule.object().fields({
                    container: Rule.any().description('Live Container of the started service'),
                    meta: Rule.any().description('Service meta (IServiceMeta), informational'),
                }))
                .description('Conveyor for { container, meta } of the started service, delivered before container run')
        }
    }

    outputs(): { [key: string]: BasicPort; } {
        return {
            'register.command': Port.standard().description('Register command into master'),
        }
    }

    checkOptions(): { [key: string]: BasicType; } {
        return {
            'mergeWindow': Rule.number().integer().min(0).default(5).description('Max gap (sec) to merge consecutive identical records into one (t/l/n) at read time'),
            'valueMax': Rule.number().integer().min(32).default(500).description('Max stored value length (truncated at read time)'),
        }
    }

    /**
     * Контейнер запущенного сервиса (live-объект)
     */
    ContainerRef: Container | null = null

    /**
     * core-boot-класс ServiceLogger (таблица device_log) — если присутствует в bootlist сервиса
     */
    sl: CoreServiceLogger | null = null

    /**
     * core-boot-класс PortLogger (таблица port_log) — если присутствует в bootlist сервиса
     */
    pl: CorePortLogger | null = null

    onStart(): void {
        this.ports.output['register.command'].push({
            command: 'serviceLog',
            short: 'Service journal read',
            description: 'Read the service journal: device events (core ServiceLogger, device_log) + outgoing port pushes (core PortLogger, port_log) in vrack2-journal-db. Consecutive identical values are compacted into one record (t/l/n).',
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
            },
            return: Rule.object().fields({
                enabled: Rule.boolean().example(true).description('Journal capture enabled flag'),
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
                dropped: Rule.number().integer().example(0).description('Legacy field, always 0'),
            }).description('Journal read result')
        })

        this.ports.output['register.command'].push({
            command: 'serviceLogClear',
            short: 'Service journal clear',
            description: 'Clear the service journal (truncate the device_log and port_log tables in vrack2-journal-db). Removes data left from previous runs',
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
            short: 'Service journal on/off',
            description: 'Enable (enabled:true) or disable (enabled:false) the live service journal (core ServiceLogger + PortLogger) on a RUNNING service without restart.',
            level: 3,
            owner: this.type,
            icon: 'log-list',
            handler: this.apiServiceLogSet.bind(this),
            rules: {
                service: Rule.string().maxLength(120).required().example('test-service').description('Service id'),
                enabled: Rule.boolean().required().example(true).description('true = start capturing, false = stop'),
            },
            return: Rule.object().fields({
                enabled: Rule.boolean().description('Journal capture enabled after the call'),
                total: Rule.number().integer().description('Total stored entries'),
            })
        })

        this.ports.output['register.command'].push({
            command: 'serviceLogStats',
            short: 'Service journal stats',
            description: 'Compact journal statistics: per time bucket (interval) over an arbitrary period (days/weeks/months) — who (device) sent what (by type) and how much. Computed against vrack2-journal-db in the service worker — returns dense buckets {start, end, senders:[{device, byType}]} instead of raw entries, so hot periods and gaps are visible without pulling the log. senders in each bucket are sorted by total count desc.',
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

    }

    /**
     * Вход: контейнер запущенного сервиса (+ мета). Достаём из контейнера
     * core-boot-классы ServiceLogger / PortLogger (через container.Bootstrap).
     */
    inputContainer(data: { container: Container, meta?: any }) {
        this.ContainerRef = data.container
        this.sl = null
        this.pl = null
        const bs = this.ContainerRef?.Bootstrap
        if (bs) {
            try { this.sl = bs.getBootClass('ServiceLogger', CoreServiceLogger) as CoreServiceLogger } catch { this.sl = null }
            try { this.pl = bs.getBootClass('PortLogger', CorePortLogger) as CorePortLogger } catch { this.pl = null }
        }
    }

    /**
     * Общее: хотя бы один boot-класс журнала доступен
     */
    protected hasJournal(): boolean {
        return !!(this.sl || this.pl)
    }

    /**
     * Всего записей в обеих таблицах (0, если таблицы ещё не созданы)
     */
    protected totalRows(): number {
        let n = 0
        if (this.sl?.table) n += this.sl.table.allRows().length
        if (this.pl?.table) n += this.pl.table.allRows().length
        return n
    }

    /**
     * Ограничение размера значения (обрезка при чтении)
     */
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

    /**
     * Склейка последовательных одинаковых записей (одинаковые type/device/port/value,
     * разрыв <= mergeWindow сек) в одну: t = первая, l = последняя, n = количество.
     * Вход — по возрастанию ts; выход — компактные записи.
     */
    protected compress(rows: RawRow[]): LogEntry[] {
        // mergeWindow — в секундах (опция), сравниваем в мс
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

    /**
     * Собирает сырые строки из обеих core-таблиц (device_log + port_log).
     * Чтение через allRows(): журналы сервиса умеренны по объёму (события + push'ы),
     * а core-классы сами используют allRows() в tail()/count().
     */
    protected collectRaw(since: number | string): RawRow[] {
        const raw: RawRow[] = []
        if (this.sl?.table) {
            for (const r of this.sl.table.query(since, 'now') as Row[]) {
                raw.push({ ts: Number(r.ts), type: String(r.event), device: String(r.device), port: null, value: r.data })
            }
        }
        if (this.pl?.table) {
            for (const r of this.pl.table.query(since, 'now') as Row[]) {
                raw.push({ ts: Number(r.ts), type: 'port', device: String(r.device), port: (r.port === null || r.port === undefined) ? null : String(r.port), value: r.data })
            }
        }
        return raw
    }

    /**
     * Чтение журнала сервиса (обе таблицы: device_log + port_log),
     * фильтр по device/type/since, склейка t/l/n, последние `limit`.
     */
    async apiServiceLog(data: { service: string; limit?: number; device?: string; type?: string; since?: any }, gData: IGuardMessage) {
        const limit = (data.limit === undefined || data.limit < 1) ? 20 : data.limit
        const since = (data.since === undefined || data.since === null || data.since === '' || data.since === 0) ? 0 : data.since

        const total = this.totalRows()
        const raw = this.collectRaw(since)

        // Фильтр по устройству и типу (до склейки)
        const filtered = raw.filter(r =>
            (!data.device || r.device === data.device)
            && (!data.type || r.type === data.type)
        )

        // По возрастанию, склейка повторяющихся (t/l в мс), последние `limit`
        filtered.sort((a, b) => a.ts - b.ts)
        const entries = this.compress(filtered).slice(-limit)

        const enabled = !!(this.sl?.enabled || this.pl?.enabled)
        return { enabled, entries, total, dropped: 0 }
    }

    /**
     * Компактная статистика журнала: количество записей в периоде, разбитое
     * по бакетам (interval) и по типам. Считается на стороне воркера поверх
     * vrack2-journal-db (scan с проекцией ts+type), ответ компактный — подходит
     * для длинных периодов (недели/месяцы) без тягания сырых записей.
     */
    async apiServiceLogStats(data: { service: string; period?: string; interval?: string; types?: string[]; devices?: string[]; maxBuckets?: number }, gData: IGuardMessage) {
        if (!(this.sl?.table) && !(this.pl?.table)) throw ErrorManager.make('SERVICE_JOURNAL_DISABLED')

        const period = data.period ?? 'now-24h:now'
        const [start, end] = Interval.period(period)
        const intervalStr = data.interval ?? '1h'
        const intervalMs = Interval.parseInterval(intervalStr)
        if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new RangeError('Bad interval: ' + intervalStr)

        // Бакетная сетка (плотная, включая пустые — видны провалы журнала)
        const firstBucket = Math.floor(start / intervalMs) * intervalMs
        const lastBucket = Math.floor(end / intervalMs) * intervalMs
        const nBuckets = Math.round((lastBucket - firstBucket) / intervalMs) + 1
        const maxBuckets = Number(data.maxBuckets) || 5000
        if (nBuckets > maxBuckets) throw ErrorManager.make('SLS_STATS_TOO_MANY_BUCKETS', { nBuckets, maxBuckets })

        const wantedTypes = (data.types ?? []).map(t => String(t)).filter(Boolean)
        const wantedDevices = (data.devices ?? []).map(d => String(d)).filter(Boolean)
        const deviceWhere: NonNullable<ScanOptions['where']> = wantedDevices.length ? [{ field: 'device', op: 'in', value: wantedDevices }] : []

        // bucketStart -> device -> type -> count
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

        // device_log (события каналов): тип = поле event
        const eventTypes = wantedTypes.length ? wantedTypes.filter(t => t !== 'port') : null
        if (this.sl?.table && (!eventTypes || eventTypes.length)) {
            const where = [...deviceWhere]
            if (eventTypes) where.push({ field: 'event', op: 'in', value: eventTypes })
            const rows = this.sl.table.scan({ start, end, select: ['ts', 'event', 'device'], where })
            for (const r of rows) { const dev = String(r.device); add(Number(r.ts), String(r.event), dev) }
        }
        // port_log (исходящие push'ы): тип = 'port'
        if (this.pl?.table && (!wantedTypes.length || wantedTypes.includes('port'))) {
            const rows = this.pl.table.scan({ start, end, select: ['ts', 'device'], where: deviceWhere })
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

        return {
            start,
            end,
            interval: intervalStr,
            total,
            buckets,
        }
    }

    /**
     * Live-вкл/выкл журнала на УЖЕ РАБОТАЮЩЕМ сервисе (оба boot-класса сразу).
     */
    async apiServiceLogSet(data: { service: string; enabled: boolean }, gData: IGuardMessage) {
        if (!this.hasJournal()) throw ErrorManager.make('SERVICE_JOURNAL_DISABLED')
        if (data.enabled === true) {
            this.sl?.enable()
            this.pl?.enable()
        } else {
            this.sl?.disable()
            this.pl?.disable()
        }
        return { enabled: !!(this.sl?.enabled || this.pl?.enabled), total: this.totalRows() }
    }

    /**
     * Очистка журнала (truncate обеих таблиц).
     */
    async apiServiceLogClear(data: { service: string }, gData: IGuardMessage) {
        let removedRows = 0
        if (this.sl?.table) removedRows += this.sl.truncate().removedRows
        if (this.pl?.table) removedRows += this.pl.truncate().removedRows
        return { cleared: true, removedRows }
    }
}

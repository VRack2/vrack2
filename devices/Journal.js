"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vrack2_core_1 = require("vrack2-core");
const vrack2_journal_db_1 = require("vrack2-journal-db");
const path_1 = __importDefault(require("path"));
vrack2_core_1.ErrorManager.register('Journal', 'JRN_JOURNAL_NOT_FOUND', 'Journal data not found for this service (no rows in the unified journal tables)', {
    service: vrack2_core_1.Rule.string().example('test-service').description('Service id'),
});
vrack2_core_1.ErrorManager.register('Journal', 'JRN_STATS_TOO_MANY_BUCKETS', 'Too many buckets for the requested period/interval — use a coarser interval (e.g. 1d instead of 1h) or a shorter period');
vrack2_core_1.ErrorManager.register('Journal', 'JRN_BAD_JOURNAL', 'Bad journal capture toggles: expected null or { events: boolean, ports: boolean, metrics: boolean }');
vrack2_core_1.ErrorManager.register('Journal', 'JRN_POINTS_LIMIT', 'Read window exceeds maxReadPoints — narrow the period or coarsen the precision', {
    points: vrack2_core_1.Rule.number().required().description('Points/rows the call would materialize'),
    limit: vrack2_core_1.Rule.number().required().description('Configured maxReadPoints'),
});
vrack2_core_1.ErrorManager.register('Journal', 'JRN_SERVICE_MANAGER_NF', 'ServiceManager device not found in this container (serviceLogSet needs it to persist and live-toggle the journal)');
vrack2_core_1.ErrorManager.register('Journal', 'JRN_APPEND_FAILED', 'Journal-db append failed; the row is dropped, capture continues', {
    stage: vrack2_core_1.Rule.string().example('own-event').description('Which append path failed (own-event | own-metric | worker-batch)'),
});
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
class Journal extends vrack2_core_1.Device {
    constructor() {
        super(...arguments);
        this.DB = null;
        this.eventTable = null;
        this.portTable = null;
        this.metricTable = null;
    }
    description() {
        return `Устройство Journal — единый журнал всех сервисов уровня VRack2 (события устройств, пуши портов, метрики),
хранимый на платформе: данные читаются в любое время, даже когда сервис остановлен.
Команды: serviceLog, serviceLogStats, serviceLogClear, serviceLogSet, serviceDeviceMetric.`;
    }
    outputs() {
        return {
            'register.command': vrack2_core_1.Port.standard().description('Register command into master'),
        };
    }
    inputs() {
        return {
            'journal': vrack2_core_1.Port.standard().requirement(vrack2_core_1.Rule.object().description('Batched journal message from a service worker: { command: "journal", events, ports, metrics }')).description('Journal batch from WorkersManager'),
        };
    }
    checkOptions() {
        return {
            'journalsDir': vrack2_core_1.Rule.string().required().default('./journals').description('Base directory for the unified journal-db store'),
            'store': vrack2_core_1.Rule.string().required().default('vrack2').description('Store name (subdir of journalsDir) holding the unified journal tables'),
            'eventRetention': vrack2_core_1.Rule.string().required().default('1s:30d').description('service_event retention "res:ttl" (single tier = pure TTL)'),
            'portRetention': vrack2_core_1.Rule.string().required().default('1s:30d').description('service_port retention "res:ttl" (single tier = pure TTL)'),
            'metricRetention': vrack2_core_1.Rule.string().required().default('5s:10m, 1m:2h, 15m:1d, 1h:1w, 6h:1mon, 1d:1y').description('service_metric retention "res:ttl[,...]" (multi-tier = rollups)'),
            'mergeWindow': vrack2_core_1.Rule.number().integer().min(0).default(5).description('Max gap (sec) to merge consecutive identical records into one (t/l/n) at read time'),
            'valueMax': vrack2_core_1.Rule.number().integer().min(32).default(500).description('Max stored value length (truncated at read time)'),
            'maxReadPoints': vrack2_core_1.Rule.number().integer().min(10).default(200000).description('Max grid buckets / scanned rows a single serviceDeviceMetric read may materialize'),
        };
    }
    onStartAsync() {
        return __awaiter(this, void 0, void 0, function* () {
            const baseDir = path_1.default.resolve(this.options.journalsDir, this.options.store);
            // wal:'off' — rows persist on segment rotation/closeAll() only;
            // an abrupt master stop may lose the un-rotated tail.
            this.DB = new vrack2_journal_db_1.Store(baseDir, { lock: 'off', wal: 'off' });
            this.DB.init();
            this.eventTable = this.DB.create((0, vrack2_journal_db_1.defineLogTable)({
                name: 'service_event',
                desc: 'Device channel events of every service: { ts, svc, device, event, data, trace }',
                columns: { ts: 'delta', svc: 'dictionary', device: 'dictionary', event: 'dictionary', data: 'auto', trace: 'catchall' },
                retention: this.options.eventRetention,
            }));
            this.portTable = this.DB.create((0, vrack2_journal_db_1.defineLogTable)({
                name: 'service_port',
                desc: 'Outgoing port pushes of every service: { ts, svc, device, port, data }',
                columns: { ts: 'delta', svc: 'dictionary', device: 'dictionary', port: 'dictionary', data: 'auto' },
                retention: this.options.portRetention,
            }));
            this.metricTable = this.DB.create((0, vrack2_journal_db_1.defineLogTable)({
                name: 'service_metric',
                desc: 'Device metrics of every service: { ts, svc, device, metric, value }',
                columns: { ts: 'delta', svc: 'auto', device: 'auto', metric: 'auto', value: 'auto' },
                retention: this.options.metricRetention,
                agg: { value: ['min', 'max', 'sum', 'count', 'last', 'first'] },
                dims: ['svc', 'device', 'metric'],
                cluster: ['svc', 'device', 'metric'],
            }));
            // The master's own container events join the unified journal under
            // svc = container id (`vrack2`) — same channels Service.bindJournal
            // captures for services (all except render), so `serviceLog` with
            // service=`vrack2` reads the master's own event history.
            const channels = {
                'device.error': 'error',
                'device.notify': 'notify',
                'device.alert': 'alert',
                'device.terminal': 'terminal',
                'device.event': 'event',
                'device.terminate': 'terminate',
            };
            for (const channel in channels) {
                this.Container.on(channel, (data) => {
                    if (!this.eventTable)
                        return;
                    try {
                        this.eventTable.append({
                            ts: Date.now(),
                            svc: String(this.Container.id),
                            device: String(data.device),
                            event: channels[channel],
                            data: data.data,
                            trace: data.trace,
                        });
                    }
                    catch (e) {
                        this.error('journal own-event append failed', vrack2_core_1.ErrorManager.make('JRN_APPEND_FAILED', { stage: 'own-event' }).add(e));
                    }
                });
            }
            // The master's own container metrics join the unified journal under
            // svc = container id (`vrack2`), so `serviceDeviceMetric` is the only
            // metrics read API for every container: <svc>, worker::<svc>, vrack2.
            this.Container.on('device.metric', (data) => {
                if (!this.metricTable)
                    return;
                const value = data.trace && typeof data.trace === 'object' ? data.trace.value : data.trace;
                if (typeof value !== 'number' || !Number.isFinite(value))
                    return;
                try {
                    this.metricTable.append({
                        ts: Date.now(),
                        svc: String(this.Container.id).toLowerCase(),
                        device: String(data.device).toLowerCase(),
                        metric: String(data.data).toLowerCase(),
                        value,
                    });
                }
                catch (e) {
                    this.error('journal own-metric append failed', vrack2_core_1.ErrorManager.make('JRN_APPEND_FAILED', { stage: 'own-metric' }).add(e));
                }
            });
        });
    }
    onStop() {
        if (this.DB) {
            // flush rotates a segment per call; merge the pieces back on a
            // graceful stop so the store does not accumulate thousands of
            // tiny segments between auto-compaction passes.
            for (const t of [this.eventTable, this.portTable, this.metricTable]) {
                if (!t)
                    continue;
                t.flush();
                t.compact();
            }
            this.DB.closeAll();
            this.DB = null;
            this.eventTable = null;
            this.portTable = null;
            this.metricTable = null;
        }
    }
    /**
     * Journal batch from a service worker (via WorkersManager.journal port).
     * Fail-soft: an append failure reports on system.error, capture continues.
     */
    inputJournal(data) {
        var _a, _b, _c;
        if (!this.eventTable || !this.portTable || !this.metricTable)
            return;
        try {
            for (const r of (_a = data.events) !== null && _a !== void 0 ? _a : []) {
                this.eventTable.append({ ts: r.ts, svc: r.svc, device: r.device, event: r.event, data: r.data, trace: r.trace });
            }
            for (const r of (_b = data.ports) !== null && _b !== void 0 ? _b : []) {
                this.portTable.append({ ts: r.ts, svc: r.svc, device: r.device, port: r.port, data: r.data });
            }
            for (const r of (_c = data.metrics) !== null && _c !== void 0 ? _c : []) {
                this.metricTable.append({
                    ts: r.ts,
                    svc: String(r.svc).toLowerCase(),
                    device: String(r.device).toLowerCase(),
                    metric: String(r.metric).toLowerCase(),
                    value: r.value,
                });
            }
        }
        catch (e) {
            this.error('journal worker-batch append failed', vrack2_core_1.ErrorManager.make('JRN_APPEND_FAILED', { stage: 'worker-batch' }).add(e));
        }
    }
    /**
     * Validate/normalize journal capture toggles (null = reset to defaults:
     * events/metrics on, ports off).
     */
    validateJournal(journal) {
        if (journal === null || journal === undefined)
            return null;
        if (typeof journal !== 'object' || Array.isArray(journal))
            throw vrack2_core_1.ErrorManager.make('JRN_BAD_JOURNAL');
        const out = {};
        for (const key of ['events', 'ports', 'metrics']) {
            if (journal[key] !== undefined) {
                if (typeof journal[key] !== 'boolean')
                    throw vrack2_core_1.ErrorManager.make('JRN_BAD_JOURNAL');
                out[key] = journal[key];
            }
        }
        return out;
    }
    svcWhere(service) {
        return [{ field: 'svc', op: 'eq', value: service }];
    }
    truncValue(value) {
        if (value === undefined || value === null)
            return value;
        const max = Number(this.options.valueMax) || 500;
        if (typeof value === 'string')
            return value.length > max ? value.slice(0, max) + '…' : value;
        if (typeof value === 'object') {
            try {
                const s = JSON.stringify(value);
                return s.length > max ? s.slice(0, max) + '…' : value;
            }
            catch (_a) {
                return String(value).slice(0, max);
            }
        }
        return value;
    }
    sameValue(a, b) {
        try {
            return JSON.stringify(a) === JSON.stringify(b);
        }
        catch (_a) {
            return false;
        }
    }
    compress(rows) {
        var _a, _b;
        const mergeWindowMs = (Number(this.options.mergeWindow) || 0) * 1000;
        const out = [];
        for (const r of rows) {
            const last = out[out.length - 1];
            if (last
                && last.type === r.type
                && last.device === r.device
                && ((_a = last.port) !== null && _a !== void 0 ? _a : null) === ((_b = r.port) !== null && _b !== void 0 ? _b : null)
                && this.sameValue(last.value, r.value)
                && (r.ts - last.l) <= mergeWindowMs) {
                last.l = r.ts;
                last.n++;
            }
            else {
                out.push({ t: r.ts, l: r.ts, n: 1, type: r.type, device: r.device, port: r.port === null ? undefined : r.port, value: this.truncValue(r.value) });
            }
        }
        return out;
    }
    collectRaw(service, since, until, device, type) {
        const raw = [];
        const eventWhere = this.svcWhere(service);
        const portWhere = this.svcWhere(service);
        if (device) {
            eventWhere.push({ field: 'device', op: 'eq', value: device });
            portWhere.push({ field: 'device', op: 'eq', value: device });
        }
        if (this.eventTable && type !== 'port') {
            if (type)
                eventWhere.push({ field: 'event', op: 'eq', value: type });
            for (const r of this.eventTable.scan({ start: since, end: until, where: eventWhere, select: ['ts', 'event', 'device', 'data'] })) {
                raw.push({ ts: Number(r.ts), type: String(r.event), device: String(r.device), port: null, value: r.data });
            }
        }
        if (this.portTable && type !== undefined && type !== '' && type !== 'port') {
            // type is an event type — portTable has no matching rows
        }
        else if (this.portTable) {
            for (const r of this.portTable.scan({ start: since, end: until, where: portWhere, select: ['ts', 'device', 'port', 'data'] })) {
                raw.push({ ts: Number(r.ts), type: 'port', device: String(r.device), port: (r.port === null || r.port === undefined) ? null : String(r.port), value: r.data });
            }
        }
        return raw;
    }
    totalRows(service) {
        var _a, _b;
        let n = 0;
        if (this.eventTable)
            n += (_a = this.eventTable.aggregate(0, 'now', [{ field: 'ts', fn: 'count' }], this.svcWhere(service)).ts_count) !== null && _a !== void 0 ? _a : 0;
        if (this.portTable)
            n += (_b = this.portTable.aggregate(0, 'now', [{ field: 'ts', fn: 'count' }], this.svcWhere(service)).ts_count) !== null && _b !== void 0 ? _b : 0;
        return n;
    }
    onStart() {
        this.ports.output['register.command'].push({
            command: 'serviceLog',
            short: 'Service journal read',
            description: 'Read the unified VRack2 journal of a service: device events + outgoing port pushes. Works whether or not the service is running (the journal lives at the platform level). Consecutive identical values are compacted into one record (t/l/n).',
            level: 3,
            owner: this.type,
            icon: 'log-list',
            handler: this.apiServiceLog.bind(this),
            rules: {
                service: vrack2_core_1.Rule.string().maxLength(120).required().example('test-service').description('Service id'),
                limit: vrack2_core_1.Rule.number().integer().min(1).max(100000).default(20).description('Max entries to return (latest)'),
                device: vrack2_core_1.Rule.string().maxLength(120).default('').example('').description('Filter by device id (empty - no filter)'),
                type: vrack2_core_1.Rule.string().maxLength(20).default('').example('port').description('Filter by entry type: port|notify|alert|event|terminal|error|terminate (empty - no filter)'),
                since: vrack2_core_1.Rule.any().default(0).example('now-1h').description('Only entries with t >= this timestamp. Absolute value in ms, or a relative spec like "now-1h"/"now-30m"/"now" (0 - no filter)'),
                until: vrack2_core_1.Rule.any().default('now').example('now').description('Only entries with t <= this timestamp. Absolute value in ms, or a relative spec like "now-1h"/"now" (default "now")'),
            },
            return: vrack2_core_1.Rule.object().fields({
                entries: vrack2_core_1.Rule.array().content(vrack2_core_1.Rule.object().fields({
                    t: vrack2_core_1.Rule.number().integer().example(1).description('First timestamp (ms)'),
                    l: vrack2_core_1.Rule.number().integer().example(1).description('Last timestamp (ms)'),
                    n: vrack2_core_1.Rule.number().integer().example(1).description('Count of compacted occurrences'),
                    type: vrack2_core_1.Rule.string().example('port').description('Entry type: port|notify|alert|event|terminal|error|terminate'),
                    device: vrack2_core_1.Rule.string().example('DeviceID').description('Device id'),
                    port: vrack2_core_1.Rule.string().example('state').description('Output port name (type=port)'),
                    value: vrack2_core_1.Rule.any().description('Value / message'),
                })).description('Journal entries (chronological)'),
                total: vrack2_core_1.Rule.number().integer().example(100).description('Total stored entries'),
            }).description('Journal read result')
        });
        this.ports.output['register.command'].push({
            command: 'serviceLogStats',
            short: 'Service journal stats',
            description: 'Compact journal statistics: per time bucket (interval) over an arbitrary period — who (device) sent what (by type) and how much. Works whether or not the service is running.',
            level: 3,
            owner: this.type,
            icon: 'bar-chart',
            handler: this.apiServiceLogStats.bind(this),
            rules: {
                service: vrack2_core_1.Rule.string().maxLength(120).required().example('test-service').description('Service id'),
                period: vrack2_core_1.Rule.string().default('now-24h:now').example('now-30d:now').description('Period "start:end"; bounds accept ms numbers or "now-1h"-like specs'),
                interval: vrack2_core_1.Rule.string().default('1h').example('1d').description('Bucket size: "15m", "1h", "1d", "1w" or plain ms'),
                types: vrack2_core_1.Rule.array().content(vrack2_core_1.Rule.string().maxLength(20)).default([]).example(['error']).description('Filter by entry type: port|notify|alert|event|terminal|error|terminate (empty - all)'),
                devices: vrack2_core_1.Rule.array().content(vrack2_core_1.Rule.string().maxLength(120)).default([]).example(['Mixer1']).description('Filter by device id (empty - all)'),
                maxBuckets: vrack2_core_1.Rule.number().integer().min(2).max(20000).default(5000).description('Max buckets to return; use a coarser interval if the period is wider'),
            },
            return: vrack2_core_1.Rule.object().fields({
                start: vrack2_core_1.Rule.number().integer().example(1718000000000).description('Period start (ms)'),
                end: vrack2_core_1.Rule.number().integer().example(1718100000000).description('Period end (ms)'),
                interval: vrack2_core_1.Rule.string().example('1d').description('Bucket size (as requested)'),
                total: vrack2_core_1.Rule.number().integer().example(4500).description('Total records in period (after filters)'),
                buckets: vrack2_core_1.Rule.array().content(vrack2_core_1.Rule.object().fields({
                    start: vrack2_core_1.Rule.number().integer().example(1718000000000).description('Bucket interval start (ms)'),
                    end: vrack2_core_1.Rule.number().integer().example(1718100000000).description('Bucket interval end (ms)'),
                    senders: vrack2_core_1.Rule.array().content(vrack2_core_1.Rule.object().fields({
                        device: vrack2_core_1.Rule.string().example('HttpServer').description('Device id (sender)'),
                        byType: vrack2_core_1.Rule.any().example({ port: 51, notify: 21 }).description('Counts by type (non-zero only)'),
                    })).description('Senders in this bucket, sorted by total count desc'),
                })).description('Dense buckets, chronological (empty buckets kept — journal gaps are visible)'),
            }).description('Journal stats result')
        });
        this.ports.output['register.command'].push({
            command: 'serviceLogClear',
            short: 'Service journal clear',
            description: 'Clear the journal of one service (removes its rows from the unified service_event/service_port tables, other services untouched). Metric tiers are kept.',
            level: 3,
            owner: this.type,
            icon: 'log-list',
            handler: this.apiServiceLogClear.bind(this),
            rules: {
                service: vrack2_core_1.Rule.string().maxLength(120).required().example('test-service').description('Service id'),
            },
            return: vrack2_core_1.Rule.object().fields({
                cleared: vrack2_core_1.Rule.boolean().example(true).description('Journal cleared'),
                removedRows: vrack2_core_1.Rule.number().integer().example(123).description('Rows removed from both tables'),
            }).description('Clear result')
        });
        this.ports.output['register.command'].push({
            command: 'serviceLogSet',
            short: 'Service journal capture config',
            description: 'Set per-service journal capture toggles (persisted in the service meta and applied live on a running service): journal = { events, ports, metrics } booleans, or null to reset to defaults (events/metrics on, ports off — port logging is opt-in).',
            level: 3,
            owner: this.type,
            icon: 'log-list',
            handler: this.apiServiceLogSet.bind(this),
            rules: {
                service: vrack2_core_1.Rule.string().maxLength(120).required().example('test-service').description('Service id'),
                journal: vrack2_core_1.Rule.any().default(null).example({ ports: true }).description('{ events, ports, metrics } booleans or null = defaults (events/metrics on, ports off)'),
            },
            return: vrack2_core_1.Rule.object().fields({
                journal: vrack2_core_1.Rule.any().description('Effective capture config after the call: { events, ports, metrics }'),
            }).description('Set result')
        });
        this.ports.output['register.command'].push({
            command: 'serviceDeviceMetric',
            short: 'Get service device metric',
            description: 'Getting a device metric from the unified platform journal — the single metrics read API for every container: service id (`backup-server`) reads the service container devices, `worker::<service>` reads the service process (vrack2 `Service` device metrics: memory.*), `vrack2` reads the master itself. Works whether or not the service is running.',
            level: 3,
            owner: this.type,
            icon: 'graph-up',
            handler: this.apiServiceDeviceMetric.bind(this),
            rules: {
                service: vrack2_core_1.Rule.string().maxLength(120).required().example('test-service').description('Container id: service id, worker::<service> (service process) or vrack2 (master)'),
                device: vrack2_core_1.Rule.string().maxLength(120).required().example('DeviceID').description('Device id'),
                metric: vrack2_core_1.Rule.string().maxLength(120).required().example('metric.id').description('Device metric path'),
                period: vrack2_core_1.Rule.string().maxLength(120).required().example('now-1h:now').description('Journal period'),
                precision: vrack2_core_1.Rule.string().maxLength(60).required().example('30s').description('Bucket size: interval string or point count'),
                func: vrack2_core_1.Rule.string().default('last').maxLength(10).example('last').description('Read function (last,first,min,max,avg,sum)')
            },
            return: vrack2_core_1.Rule.object().fields({
                relevant: vrack2_core_1.Rule.boolean().default(false).example(false).description('result relevance flag'),
                start: vrack2_core_1.Rule.number().integer().example(1).description('Beginning of the period (seconds)'),
                end: vrack2_core_1.Rule.number().integer().example(100).description('End of period (seconds)'),
                rows: vrack2_core_1.Rule.array().content(vrack2_core_1.Rule.object().fields({
                    time: vrack2_core_1.Rule.number().integer().example(10).description('Time in seconds'),
                    value: vrack2_core_1.Rule.number().example(12.3223).description('Metric value || null')
                }).description('Metric storage object')).description('Array of metrics')
            }).description('Metric request result - see vrack2-journal-db read documentation')
        });
    }
    apiServiceLog(data, gData) {
        return __awaiter(this, void 0, void 0, function* () {
            const limit = (data.limit === undefined || data.limit < 1) ? 20 : data.limit;
            const since = (data.since === undefined || data.since === null || data.since === '' || data.since === 0) ? 0 : data.since;
            const until = (data.until === undefined || data.until === null || data.until === '') ? 'now' : data.until;
            const total = this.totalRows(data.service);
            const raw = this.collectRaw(data.service, since, until, data.device || undefined, data.type || undefined);
            raw.sort((a, b) => a.ts - b.ts);
            const entries = this.compress(raw).slice(-limit);
            return { entries, total };
        });
    }
    apiServiceLogStats(data, gData) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            const period = (_a = data.period) !== null && _a !== void 0 ? _a : 'now-24h:now';
            const [start, end] = vrack2_journal_db_1.Interval.period(period);
            const intervalStr = (_b = data.interval) !== null && _b !== void 0 ? _b : '1h';
            const intervalMs = vrack2_journal_db_1.Interval.parseInterval(intervalStr);
            if (!Number.isFinite(intervalMs) || intervalMs <= 0)
                throw new RangeError('Bad interval: ' + intervalStr);
            const firstBucket = Math.floor(start / intervalMs) * intervalMs;
            const lastBucket = Math.floor(end / intervalMs) * intervalMs;
            const nBuckets = Math.round((lastBucket - firstBucket) / intervalMs) + 1;
            const maxBuckets = Number(data.maxBuckets) || 5000;
            if (nBuckets > maxBuckets)
                throw vrack2_core_1.ErrorManager.make('JRN_STATS_TOO_MANY_BUCKETS', { nBuckets, maxBuckets });
            const wantedTypes = ((_c = data.types) !== null && _c !== void 0 ? _c : []).map(t => String(t)).filter(Boolean);
            const wantedDevices = ((_d = data.devices) !== null && _d !== void 0 ? _d : []).map(d => String(d)).filter(Boolean);
            const baseWhere = this.svcWhere(data.service);
            if (wantedDevices.length)
                baseWhere.push({ field: 'device', op: 'in', value: wantedDevices });
            const acc = new Map();
            let total = 0;
            const add = (ts, type, device) => {
                var _a;
                const b = Math.floor(ts / intervalMs) * intervalMs;
                let dm = acc.get(b);
                if (!dm) {
                    dm = new Map();
                    acc.set(b, dm);
                }
                let tm = dm.get(device);
                if (!tm) {
                    tm = new Map();
                    dm.set(device, tm);
                }
                tm.set(type, ((_a = tm.get(type)) !== null && _a !== void 0 ? _a : 0) + 1);
                total++;
            };
            const eventTypes = wantedTypes.length ? wantedTypes.filter(t => t !== 'port') : null;
            if (this.eventTable && (!eventTypes || eventTypes.length)) {
                const where = [...baseWhere];
                if (eventTypes)
                    where.push({ field: 'event', op: 'in', value: eventTypes });
                for (const r of this.eventTable.scan({ start, end, select: ['ts', 'event', 'device'], where })) {
                    add(Number(r.ts), String(r.event), String(r.device));
                }
            }
            if (this.portTable && (!wantedTypes.length || wantedTypes.includes('port'))) {
                for (const r of this.portTable.scan({ start, end, select: ['ts', 'device'], where: baseWhere })) {
                    add(Number(r.ts), 'port', String(r.device));
                }
            }
            const sumByType = (byType) => {
                let s = 0;
                for (const k in byType)
                    s += byType[k];
                return s;
            };
            const buckets = [];
            for (let b = firstBucket; b <= lastBucket; b += intervalMs) {
                const dm = acc.get(b);
                const senders = [];
                if (dm) {
                    for (const [device, tm] of dm) {
                        const byType = {};
                        for (const [t, c] of tm)
                            byType[t] = c;
                        senders.push({ device, byType });
                    }
                }
                senders.sort((a, b2) => sumByType(b2.byType) - sumByType(a.byType));
                buckets.push({ start: b, end: b + intervalMs, senders });
            }
            return { start, end, interval: intervalStr, total, buckets };
        });
    }
    /**
     * Clear one service's rows via targeted deleteBy (crash-safe: each segment
     * is rewritten atomically via tmp+rename; a partial run is idempotent).
     * Metric tiers are kept (rollup RMW is unsafe).
     */
    apiServiceLogClear(data, gData) {
        return __awaiter(this, void 0, void 0, function* () {
            let removedRows = 0;
            for (const table of [this.eventTable, this.portTable]) {
                if (!table)
                    continue;
                const result = table.deleteBy([{ field: 'svc', op: 'eq', value: data.service }]);
                removedRows += result.removedRows;
            }
            return { cleared: true, removedRows };
        });
    }
    apiServiceLogSet(data, gData) {
        return __awaiter(this, void 0, void 0, function* () {
            const journal = this.validateJournal(data.journal);
            const sm = this.Container.devices['ServiceManager'];
            if (!sm || typeof sm.setJournal !== 'function')
                throw vrack2_core_1.ErrorManager.make('JRN_SERVICE_MANAGER_NF');
            return yield sm.setJournal(data.service, journal);
        });
    }
    /**
     * Read a device metric from the unified journal — the same dense-grid
     * contract as core `JournalDbMetrics.read()` (vrack-db compatible).
     * `svc` is a container id: `<service>` (service container),
     * `worker::<service>` (service process) or `vrack2` (the master itself).
     */
    apiServiceDeviceMetric(data, gData) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.readMetric(data.service, data.device, data.metric, data.period, data.precision, data.func);
        });
    }
    readMetric(svc, device, metric, period, precision, func) {
        var _a;
        if (!this.metricTable)
            throw vrack2_core_1.ErrorManager.make('JRN_JOURNAL_NOT_FOUND', { service: svc });
        const fn = func !== null && func !== void 0 ? func : 'last';
        if (!Journal.AGGREGATE_FUNCTIONS.includes(fn))
            throw new RangeError(`Journal: unknown aggregate function '${fn}' (available: ${Journal.AGGREGATE_FUNCTIONS.join(', ')})`);
        const [start, end] = vrack2_journal_db_1.Interval.period(period);
        const step = this.parsePrecision(start, end, precision);
        const grid = vrack2_journal_db_1.Interval.getIntervals(start, end, step);
        const max = Number(this.options.maxReadPoints) || 200000;
        if (grid.length > max)
            throw vrack2_core_1.ErrorManager.make('JRN_POINTS_LIMIT', { points: grid.length, limit: max });
        const s = grid[0];
        const e = grid[grid.length - 1];
        const where = [
            { field: 'svc', op: 'eq', value: svc.toLowerCase() },
            { field: 'device', op: 'eq', value: device.toLowerCase() },
            { field: 'metric', op: 'eq', value: String(metric).toLowerCase() },
        ];
        const buckets = new Array(grid.length).fill(null);
        let seen = 0;
        for (const row of this.metricTable.scan({
            start, end, where,
            select: ['ts', 'value', 'value_min', 'value_max', 'value_sum', 'value_count', 'value_avg', 'value_last', 'value_last_ts', 'value_first', 'value_first_ts'],
        })) {
            const t = row.ts;
            if (typeof t !== 'number')
                continue;
            seen++;
            const i = Math.min(grid.length - 1, Math.max(0, Math.floor((t - s) / step)));
            const acc = (_a = buckets[i]) !== null && _a !== void 0 ? _a : (buckets[i] = vrack2_journal_db_1.Aggregation.newAcc());
            if (vrack2_journal_db_1.Aggregation.hasRollupCols(row, 'value')) {
                const o = vrack2_journal_db_1.Aggregation.fromRollupRow(row, 'value');
                if (o !== null)
                    vrack2_journal_db_1.Aggregation.merge(acc, o);
            }
            else {
                const v = row.value;
                if (typeof v === 'number' && Number.isFinite(v))
                    vrack2_journal_db_1.Aggregation.addValue(acc, v, t);
            }
        }
        return {
            relevant: seen > 0,
            start: s / 1000,
            end: e / 1000,
            rows: grid.map((time, i) => ({ time: time / 1000, value: buckets[i] ? this.aggregateAcc(buckets[i], fn) : null })),
        };
    }
    parsePrecision(start, end, precision) {
        if (typeof precision === 'number')
            return vrack2_journal_db_1.Interval.getIntervalOfFixedCount(start, end, precision);
        const s = String(precision).trim();
        if (/^\d+$/.test(s))
            return vrack2_journal_db_1.Interval.getIntervalOfFixedCount(start, end, parseInt(s, 10));
        return vrack2_journal_db_1.Interval.parseInterval(s);
    }
    aggregateAcc(acc, func) {
        switch (func) {
            case 'last': return acc.count > 0 ? acc.lastVal : null;
            case 'first': return acc.count > 0 ? acc.firstVal : null;
            case 'max': return acc.count > 0 ? acc.max : null;
            case 'min': return acc.count > 0 ? acc.min : null;
            case 'avg': return acc.count > 0 ? acc.sum / acc.count : null;
            case 'sum': return acc.count > 0 ? acc.sum : null;
            default: throw new RangeError(`Journal: unknown aggregate function '${func}'`);
        }
    }
}
Journal.AGGREGATE_FUNCTIONS = ['last', 'first', 'max', 'min', 'avg', 'sum'];
exports.default = Journal;

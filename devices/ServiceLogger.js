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
Object.defineProperty(exports, "__esModule", { value: true });
const vrack2_core_1 = require("vrack2-core");
const vrack2_journal_db_1 = require("vrack2-journal-db");
vrack2_core_1.ErrorManager.register('ServiceLogger', 'SERVICE_JOURNAL_DISABLED', 'Service journal is unavailable. Enable the core ServiceLogger/PortLogger boot classes (vrack2-core.DEFAULT_BOOTLIST) for this service and restart');
vrack2_core_1.ErrorManager.register('ServiceLogger', 'SLS_STATS_TOO_MANY_BUCKETS', 'Too many buckets for the requested period/interval — use a coarser interval (e.g. 1d instead of 1h) or a shorter period');
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
 *   - serviceLogStats   — компактная статистика: счётчики записей по бакетам
 *                         (interval) и типам за произвольный период;
 *   - serviceLogSet     — live вкл/выкл обоих boot-классов (enable/disable);
 *   - serviceLogClear   — truncate обеих таблиц;
 *   - serviceLogCompact — compact (дедупликация) обеих таблиц.
 *
 * Контейнер сервиса приходит по входному порту `container` (его передаёт
 * Service.ts в worker'е до run()); device достаёт из него boot-классы через
 * `container.Bootstrap.getBootClass(...)`.
 */
class ServiceLogger extends vrack2_core_1.Device {
    constructor() {
        super(...arguments);
        /**
         * Контейнер запущенного сервиса (live-объект)
         */
        this.ContainerRef = null;
        /**
         * core-boot-класс ServiceLogger (таблица device_log) — если присутствует в bootlist сервиса
         */
        this.sl = null;
        /**
         * core-boot-класс PortLogger (таблица port_log) — если присутствует в bootlist сервиса
         */
        this.pl = null;
    }
    description() {
        return `Устройство ServiceLogger — поверх журнала запущенного сервиса, который ведут core-boot-классы
vrack2-core.ServiceLogger (таблица device_log: события устройств) и vrack2-core.PortLogger (таблица port_log:
исходящие push'ы устройств), хранящие данные в vrack2-journal-db (<path>/<service>).
Команды: serviceLog (чтение обеих таблиц со склейкой t/l/n), serviceLogSet (live вкл/выкл),
serviceLogClear (truncate), serviceLogCompact (компакция/дедупликация).`;
    }
    inputs() {
        return {
            container: vrack2_core_1.Port.standard()
                .requirement(vrack2_core_1.Rule.object().fields({
                container: vrack2_core_1.Rule.any().description('Live Container of the started service'),
                meta: vrack2_core_1.Rule.any().description('Service meta (IServiceMeta), informational'),
            }))
                .description('Conveyor for { container, meta } of the started service, delivered before container run')
        };
    }
    outputs() {
        return {
            'register.command': vrack2_core_1.Port.standard().description('Register command into master'),
        };
    }
    checkOptions() {
        return {
            'mergeWindow': vrack2_core_1.Rule.number().integer().min(0).default(5).description('Max gap (sec) to merge consecutive identical records into one (t/l/n) at read time'),
            'valueMax': vrack2_core_1.Rule.number().integer().min(32).default(500).description('Max stored value length (truncated at read time)'),
        };
    }
    onStart() {
        this.ports.output['register.command'].push({
            command: 'serviceLog',
            short: 'Service journal read',
            description: 'Read the service journal: device events (core ServiceLogger, device_log) + outgoing port pushes (core PortLogger, port_log) in vrack2-journal-db. Consecutive identical values are compacted into one record (t/l/n).',
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
            },
            return: vrack2_core_1.Rule.object().fields({
                enabled: vrack2_core_1.Rule.boolean().example(true).description('Journal capture enabled flag'),
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
                dropped: vrack2_core_1.Rule.number().integer().example(0).description('Legacy field, always 0'),
            }).description('Journal read result')
        });
        this.ports.output['register.command'].push({
            command: 'serviceLogClear',
            short: 'Service journal clear',
            description: 'Clear the service journal (truncate the device_log and port_log tables in vrack2-journal-db). Removes data left from previous runs',
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
            short: 'Service journal on/off',
            description: 'Enable (enabled:true) or disable (enabled:false) the live service journal (core ServiceLogger + PortLogger) on a RUNNING service without restart.',
            level: 3,
            owner: this.type,
            icon: 'log-list',
            handler: this.apiServiceLogSet.bind(this),
            rules: {
                service: vrack2_core_1.Rule.string().maxLength(120).required().example('test-service').description('Service id'),
                enabled: vrack2_core_1.Rule.boolean().required().example(true).description('true = start capturing, false = stop'),
            },
            return: vrack2_core_1.Rule.object().fields({
                enabled: vrack2_core_1.Rule.boolean().description('Journal capture enabled after the call'),
                total: vrack2_core_1.Rule.number().integer().description('Total stored entries'),
            })
        });
        this.ports.output['register.command'].push({
            command: 'serviceLogStats',
            short: 'Service journal stats',
            description: 'Compact journal statistics: record counts per time bucket (interval) and per type over an arbitrary period (days/weeks/months). Computed against vrack2-journal-db in the service worker — returns dense buckets {t, n, byType} instead of raw entries, so hot periods and gaps are visible without pulling the log.',
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
                period: vrack2_core_1.Rule.object().fields({
                    start: vrack2_core_1.Rule.number().integer().example(1718000000000).description('Period start (ms)'),
                    end: vrack2_core_1.Rule.number().integer().example(1718100000000).description('Period end (ms)'),
                }).description('Resolved period'),
                interval: vrack2_core_1.Rule.string().example('1d').description('Bucket size (as requested)'),
                total: vrack2_core_1.Rule.number().integer().example(4500).description('Total records in period (after filters)'),
                totals: vrack2_core_1.Rule.any().example({ error: 140, terminal: 3100 }).description('Totals by type'),
                buckets: vrack2_core_1.Rule.array().content(vrack2_core_1.Rule.object().fields({
                    t: vrack2_core_1.Rule.number().integer().example(1718000000000).description('Bucket start (ms)'),
                    n: vrack2_core_1.Rule.number().integer().example(123).description('Record count in bucket'),
                    byType: vrack2_core_1.Rule.any().example({ terminal: 100, error: 5 }).description('Counts by type (non-zero only)'),
                })).description('Dense buckets, chronological (empty buckets kept — journal gaps are visible)'),
            }).description('Journal stats result')
        });
        this.ports.output['register.command'].push({
            command: 'serviceLogCompact',
            short: 'Service journal compact',
            description: 'Compact (deduplicate) the service journal tables (device_log + port_log) in vrack2-journal-db',
            level: 3,
            owner: this.type,
            icon: 'log-list',
            handler: this.apiServiceLogCompact.bind(this),
            rules: {
                service: vrack2_core_1.Rule.string().maxLength(120).required().example('test-service').description('Service id'),
            },
            return: vrack2_core_1.Rule.object().fields({
                mergedSegments: vrack2_core_1.Rule.number().integer().example(5).description('Closed segments merged into one'),
                logicalRows: vrack2_core_1.Rule.number().integer().example(100).description('Logical rows preserved'),
                physicalBefore: vrack2_core_1.Rule.number().integer().example(200).description('Physical rows before compaction (incl. duplicates)'),
                physicalAfter: vrack2_core_1.Rule.number().integer().example(100).description('Physical rows after compaction'),
            }).description('Compact result')
        });
    }
    /**
     * Вход: контейнер запущенного сервиса (+ мета). Достаём из контейнера
     * core-boot-классы ServiceLogger / PortLogger (через container.Bootstrap).
     */
    inputContainer(data) {
        var _a;
        this.ContainerRef = data.container;
        this.sl = null;
        this.pl = null;
        const bs = (_a = this.ContainerRef) === null || _a === void 0 ? void 0 : _a.Bootstrap;
        if (bs) {
            try {
                this.sl = bs.getBootClass('ServiceLogger', vrack2_core_1.ServiceLogger);
            }
            catch (_b) {
                this.sl = null;
            }
            try {
                this.pl = bs.getBootClass('PortLogger', vrack2_core_1.PortLogger);
            }
            catch (_c) {
                this.pl = null;
            }
        }
    }
    /**
     * Общее: хотя бы один boot-класс журнала доступен
     */
    hasJournal() {
        return !!(this.sl || this.pl);
    }
    /**
     * Всего записей в обеих таблицах (0, если таблицы ещё не созданы)
     */
    totalRows() {
        var _a, _b;
        let n = 0;
        if ((_a = this.sl) === null || _a === void 0 ? void 0 : _a.table)
            n += this.sl.table.allRows().length;
        if ((_b = this.pl) === null || _b === void 0 ? void 0 : _b.table)
            n += this.pl.table.allRows().length;
        return n;
    }
    /**
     * Ограничение размера значения (обрезка при чтении)
     */
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
    /**
     * Склейка последовательных одинаковых записей (одинаковые type/device/port/value,
     * разрыв <= mergeWindow сек) в одну: t = первая, l = последняя, n = количество.
     * Вход — по возрастанию ts; выход — компактные записи.
     */
    compress(rows) {
        var _a, _b;
        // mergeWindow — в секундах (опция), сравниваем в мс
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
    /**
     * Собирает сырые строки из обеих core-таблиц (device_log + port_log).
     * Чтение через allRows(): журналы сервиса умеренны по объёму (события + push'ы),
     * а core-классы сами используют allRows() в tail()/count().
     */
    collectRaw(since) {
        var _a, _b;
        const raw = [];
        if ((_a = this.sl) === null || _a === void 0 ? void 0 : _a.table) {
            for (const r of this.sl.table.query(since, 'now')) {
                raw.push({ ts: Number(r.ts), type: String(r.event), device: String(r.device), port: null, value: r.data });
            }
        }
        if ((_b = this.pl) === null || _b === void 0 ? void 0 : _b.table) {
            for (const r of this.pl.table.query(since, 'now')) {
                raw.push({ ts: Number(r.ts), type: 'port', device: String(r.device), port: (r.port === null || r.port === undefined) ? null : String(r.port), value: r.data });
            }
        }
        return raw;
    }
    /**
     * Чтение журнала сервиса (обе таблицы: device_log + port_log),
     * фильтр по device/type/since, склейка t/l/n, последние `limit`.
     */
    apiServiceLog(data, gData) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const limit = (data.limit === undefined || data.limit < 1) ? 20 : data.limit;
            const since = (data.since === undefined || data.since === null || data.since === '' || data.since === 0) ? 0 : data.since;
            const total = this.totalRows();
            const raw = this.collectRaw(since);
            // Фильтр по устройству и типу (до склейки)
            const filtered = raw.filter(r => (!data.device || r.device === data.device)
                && (!data.type || r.type === data.type));
            // По возрастанию, склейка повторяющихся (t/l в мс), последние `limit`
            filtered.sort((a, b) => a.ts - b.ts);
            const entries = this.compress(filtered).slice(-limit);
            const enabled = !!(((_a = this.sl) === null || _a === void 0 ? void 0 : _a.enabled) || ((_b = this.pl) === null || _b === void 0 ? void 0 : _b.enabled));
            return { enabled, entries, total, dropped: 0 };
        });
    }
    /**
     * Компактная статистика журнала: количество записей в периоде, разбитое
     * по бакетам (interval) и по типам. Считается на стороне воркера поверх
     * vrack2-journal-db (scan с проекцией ts+type), ответ компактный — подходит
     * для длинных периодов (недели/месяцы) без тягания сырых записей.
     */
    apiServiceLogStats(data, gData) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g, _h;
            if (!((_a = this.sl) === null || _a === void 0 ? void 0 : _a.table) && !((_b = this.pl) === null || _b === void 0 ? void 0 : _b.table))
                throw vrack2_core_1.ErrorManager.make('SERVICE_JOURNAL_DISABLED');
            const period = (_c = data.period) !== null && _c !== void 0 ? _c : 'now-24h:now';
            const [start, end] = vrack2_journal_db_1.Interval.period(period);
            const intervalStr = (_d = data.interval) !== null && _d !== void 0 ? _d : '1h';
            const intervalMs = vrack2_journal_db_1.Interval.parseInterval(intervalStr);
            if (!Number.isFinite(intervalMs) || intervalMs <= 0)
                throw new RangeError('Bad interval: ' + intervalStr);
            // Бакетная сетка (плотная, включая пустые — видны провалы журнала)
            const firstBucket = Math.floor(start / intervalMs) * intervalMs;
            const lastBucket = Math.floor(end / intervalMs) * intervalMs;
            const nBuckets = Math.round((lastBucket - firstBucket) / intervalMs) + 1;
            const maxBuckets = Number(data.maxBuckets) || 5000;
            if (nBuckets > maxBuckets)
                throw vrack2_core_1.ErrorManager.make('SLS_STATS_TOO_MANY_BUCKETS', { nBuckets, maxBuckets });
            const wantedTypes = ((_e = data.types) !== null && _e !== void 0 ? _e : []).map(t => String(t)).filter(Boolean);
            const wantedDevices = ((_f = data.devices) !== null && _f !== void 0 ? _f : []).map(d => String(d)).filter(Boolean);
            const deviceWhere = wantedDevices.length ? [{ field: 'device', op: 'in', value: wantedDevices }] : [];
            // bucketStart -> { type -> count }
            const acc = new Map();
            const totals = {};
            let total = 0;
            const add = (ts, type) => {
                var _a, _b;
                const b = Math.floor(ts / intervalMs) * intervalMs;
                let m = acc.get(b);
                if (!m) {
                    m = new Map();
                    acc.set(b, m);
                }
                m.set(type, ((_a = m.get(type)) !== null && _a !== void 0 ? _a : 0) + 1);
                totals[type] = ((_b = totals[type]) !== null && _b !== void 0 ? _b : 0) + 1;
                total++;
            };
            // device_log (события каналов): тип = поле event
            const eventTypes = wantedTypes.length ? wantedTypes.filter(t => t !== 'port') : null;
            if (((_g = this.sl) === null || _g === void 0 ? void 0 : _g.table) && (!eventTypes || eventTypes.length)) {
                const where = [...deviceWhere];
                if (eventTypes)
                    where.push({ field: 'event', op: 'in', value: eventTypes });
                const rows = this.sl.table.scan({ start, end, select: ['ts', 'event'], where });
                for (const r of rows)
                    add(Number(r.ts), String(r.event));
            }
            // port_log (исходящие push'ы): тип = 'port'
            if (((_h = this.pl) === null || _h === void 0 ? void 0 : _h.table) && (!wantedTypes.length || wantedTypes.includes('port'))) {
                const rows = this.pl.table.scan({ start, end, select: ['ts'], where: deviceWhere });
                for (const r of rows)
                    add(Number(r.ts), 'port');
            }
            const buckets = [];
            for (let b = firstBucket; b <= lastBucket; b += intervalMs) {
                const m = acc.get(b);
                const byType = {};
                let n = 0;
                if (m)
                    for (const [t, c] of m) {
                        byType[t] = c;
                        n += c;
                    }
                buckets.push({ t: b, n, byType });
            }
            return {
                period: { start, end },
                interval: intervalStr,
                total,
                totals,
                buckets,
            };
        });
    }
    /**
     * Live-вкл/выкл журнала на УЖЕ РАБОТАЮЩЕМ сервисе (оба boot-класса сразу).
     */
    apiServiceLogSet(data, gData) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f;
            if (!this.hasJournal())
                throw vrack2_core_1.ErrorManager.make('SERVICE_JOURNAL_DISABLED');
            if (data.enabled === true) {
                (_a = this.sl) === null || _a === void 0 ? void 0 : _a.enable();
                (_b = this.pl) === null || _b === void 0 ? void 0 : _b.enable();
            }
            else {
                (_c = this.sl) === null || _c === void 0 ? void 0 : _c.disable();
                (_d = this.pl) === null || _d === void 0 ? void 0 : _d.disable();
            }
            return { enabled: !!(((_e = this.sl) === null || _e === void 0 ? void 0 : _e.enabled) || ((_f = this.pl) === null || _f === void 0 ? void 0 : _f.enabled)), total: this.totalRows() };
        });
    }
    /**
     * Очистка журнала (truncate обеих таблиц).
     */
    apiServiceLogClear(data, gData) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            let removedRows = 0;
            if ((_a = this.sl) === null || _a === void 0 ? void 0 : _a.table)
                removedRows += this.sl.truncate().removedRows;
            if ((_b = this.pl) === null || _b === void 0 ? void 0 : _b.table)
                removedRows += this.pl.truncate().removedRows;
            return { cleared: true, removedRows };
        });
    }
    /**
     * Компакция (дедупликация) обеих таблиц.
     */
    apiServiceLogCompact(data, gData) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            if (!((_a = this.sl) === null || _a === void 0 ? void 0 : _a.table) && !((_b = this.pl) === null || _b === void 0 ? void 0 : _b.table))
                throw vrack2_core_1.ErrorManager.make('SERVICE_JOURNAL_DISABLED');
            const agg = { mergedSegments: 0, logicalRows: 0, physicalBefore: 0, physicalAfter: 0 };
            const merge = (r) => {
                agg.mergedSegments += r.mergedSegments;
                agg.logicalRows += r.logicalRows;
                agg.physicalBefore += r.physicalBefore;
                agg.physicalAfter += r.physicalAfter;
            };
            if ((_c = this.sl) === null || _c === void 0 ? void 0 : _c.table)
                merge(this.sl.table.compact());
            if ((_d = this.pl) === null || _d === void 0 ? void 0 : _d.table)
                merge(this.pl.table.compact());
            return agg;
        });
    }
}
exports.default = ServiceLogger;

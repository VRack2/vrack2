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
vrack2_core_1.ErrorManager.register('ServiceJournal', 'SJ_SERVICE_RUNNING', 'Service is running. Stop the service before clearing its journal', {
    service: vrack2_core_1.Rule.string().example('test-service').description('Service id'),
});
vrack2_core_1.ErrorManager.register('ServiceJournal', 'SJ_JOURNAL_NOT_FOUND', 'Journal data not found for this service (no device_log or port_log table)', {
    service: vrack2_core_1.Rule.string().example('test-service').description('Service id'),
});
vrack2_core_1.ErrorManager.register('ServiceJournal', 'SLS_STATS_TOO_MANY_BUCKETS', 'Too many buckets for the requested period/interval — use a coarser interval (e.g. 1d instead of 1h) or a shorter period');
class ServiceJournal extends vrack2_core_1.Device {
    constructor() {
        super(...arguments);
        this.journals = new Map();
    }
    description() {
        return `Устройство ServiceJournal — чтение и очистка журнала сервиса напрямую с диска (vrack2-journal-db),
без запускаемого сервиса. Команды: serviceLog (чтение device_log + port_log),
serviceLogStats (баке-статистика), serviceLogClear (truncate, только для остановленного сервиса).`;
    }
    outputs() {
        return {
            'register.command': vrack2_core_1.Port.standard().description('Register command into master'),
        };
    }
    inputs() {
        return {};
    }
    checkOptions() {
        return {
            'journalsDir': vrack2_core_1.Rule.string().required().default('./journals').description('Base directory for journal-db stores'),
            'mergeWindow': vrack2_core_1.Rule.number().integer().min(0).default(5).description('Max gap (sec) to merge consecutive identical records into one (t/l/n) at read time'),
            'valueMax': vrack2_core_1.Rule.number().integer().min(32).default(500).description('Max stored value length (truncated at read time)'),
        };
    }
    onStart() {
        this.ports.output['register.command'].push({
            command: 'serviceLog',
            short: 'Service journal read',
            description: 'Read the service journal from disk: device events (device_log) + outgoing port pushes (port_log) in vrack2-journal-db. Works without the service being running. Consecutive identical values are compacted into one record (t/l/n).',
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
            description: 'Compact journal statistics from disk: per time bucket (interval) over an arbitrary period — who (device) sent what (by type) and how much. Works without the service being running.',
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
            description: 'Clear the service journal (truncate the device_log and port_log tables in vrack2-journal-db). Only works when the service is NOT running.',
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
    }
    onStop() {
        for (const entry of this.journals.values()) {
            try {
                entry.store.closeAll();
            }
            catch ( /* ignore */_a) { /* ignore */ }
        }
        this.journals.clear();
    }
    getJournal(serviceId) {
        let entry = this.journals.get(serviceId);
        if (entry)
            return entry;
        const baseDir = path_1.default.resolve(this.options.journalsDir, serviceId);
        const store = new vrack2_journal_db_1.Store(baseDir, { lock: 'off' });
        store.init();
        let deviceLog = null;
        let portLog = null;
        try {
            deviceLog = store.open('device_log');
        }
        catch (_a) {
            deviceLog = null;
        }
        try {
            portLog = store.open('port_log');
        }
        catch (_b) {
            portLog = null;
        }
        entry = { store, deviceLog, portLog };
        this.journals.set(serviceId, entry);
        return entry;
    }
    isServiceRunning(serviceId) {
        var _a, _b;
        const sm = this.Container.devices['ServiceManager'];
        if (!sm)
            return false;
        return !!((_b = (_a = sm.servicesList) === null || _a === void 0 ? void 0 : _a[serviceId]) === null || _b === void 0 ? void 0 : _b.run);
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
    collectRaw(j, since, until) {
        const raw = [];
        if (j.deviceLog) {
            for (const r of j.deviceLog.query(since, until)) {
                raw.push({ ts: Number(r.ts), type: String(r.event), device: String(r.device), port: null, value: r.data });
            }
        }
        if (j.portLog) {
            for (const r of j.portLog.query(since, until)) {
                raw.push({ ts: Number(r.ts), type: 'port', device: String(r.device), port: (r.port === null || r.port === undefined) ? null : String(r.port), value: r.data });
            }
        }
        return raw;
    }
    totalRows(j) {
        let n = 0;
        if (j.deviceLog)
            n += j.deviceLog.allRows().length;
        if (j.portLog)
            n += j.portLog.allRows().length;
        return n;
    }
    apiServiceLog(data, gData) {
        return __awaiter(this, void 0, void 0, function* () {
            const j = this.getJournal(data.service);
            if (!j.deviceLog && !j.portLog)
                throw vrack2_core_1.ErrorManager.make('SJ_JOURNAL_NOT_FOUND', { service: data.service });
            const limit = (data.limit === undefined || data.limit < 1) ? 20 : data.limit;
            const since = (data.since === undefined || data.since === null || data.since === '' || data.since === 0) ? 0 : data.since;
            const until = (data.until === undefined || data.until === null || data.until === '') ? 'now' : data.until;
            const total = this.totalRows(j);
            const raw = this.collectRaw(j, since, until);
            const filtered = raw.filter(r => (!data.device || r.device === data.device)
                && (!data.type || r.type === data.type));
            filtered.sort((a, b) => a.ts - b.ts);
            const entries = this.compress(filtered).slice(-limit);
            return { entries, total };
        });
    }
    apiServiceLogStats(data, gData) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            const j = this.getJournal(data.service);
            if (!j.deviceLog && !j.portLog)
                throw vrack2_core_1.ErrorManager.make('SJ_JOURNAL_NOT_FOUND', { service: data.service });
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
                throw vrack2_core_1.ErrorManager.make('SLS_STATS_TOO_MANY_BUCKETS', { nBuckets, maxBuckets });
            const wantedTypes = ((_c = data.types) !== null && _c !== void 0 ? _c : []).map(t => String(t)).filter(Boolean);
            const wantedDevices = ((_d = data.devices) !== null && _d !== void 0 ? _d : []).map(d => String(d)).filter(Boolean);
            const deviceWhere = wantedDevices.length ? [{ field: 'device', op: 'in', value: wantedDevices }] : [];
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
            if (j.deviceLog && (!eventTypes || eventTypes.length)) {
                const where = [...deviceWhere];
                if (eventTypes)
                    where.push({ field: 'event', op: 'in', value: eventTypes });
                const rows = j.deviceLog.scan({ start, end, select: ['ts', 'event', 'device'], where });
                for (const r of rows) {
                    const dev = String(r.device);
                    add(Number(r.ts), String(r.event), dev);
                }
            }
            if (j.portLog && (!wantedTypes.length || wantedTypes.includes('port'))) {
                const rows = j.portLog.scan({ start, end, select: ['ts', 'device'], where: deviceWhere });
                for (const r of rows) {
                    const dev = String(r.device);
                    add(Number(r.ts), 'port', dev);
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
    apiServiceLogClear(data, gData) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.isServiceRunning(data.service)) {
                throw vrack2_core_1.ErrorManager.make('SJ_SERVICE_RUNNING', { service: data.service });
            }
            const j = this.getJournal(data.service);
            if (!j.deviceLog && !j.portLog)
                throw vrack2_core_1.ErrorManager.make('SJ_JOURNAL_NOT_FOUND', { service: data.service });
            let removedRows = 0;
            if (j.deviceLog)
                removedRows += j.deviceLog.truncate().removedRows;
            if (j.portLog)
                removedRows += j.portLog.truncate().removedRows;
            return { cleared: true, removedRows };
        });
    }
}
exports.default = ServiceJournal;

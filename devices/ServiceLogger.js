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
vrack2_core_1.ErrorManager.register('ServiceLogger', 'SERVICE_JOURNAL_DISABLED', 'Service journal is unavailable. Enable the core ServiceLogger/PortLogger boot classes (vrack2-core.DEFAULT_BOOTLIST) for this service and restart');
/**
 * Live вкл/выкл журнала на запущенном сервисе.
 *
 * Чтение (serviceLog / serviceLogStats) и очистка (serviceLogClear)
 * вынесены в ServiceJournal (работает с диска, без запущенного сервиса).
 * Здесь остаётся только serviceLogSet — live toggle, который требует
 * живых boot-классов в контейнере.
 */
class ServiceLogger extends vrack2_core_1.Device {
    constructor() {
        super(...arguments);
        this.ContainerRef = null;
        this.sl = null;
        this.pl = null;
    }
    description() {
        return `Устройство ServiceLogger — live вкл/выкл журнала запущенного сервиса (serviceLogSet).
Чтение (serviceLog/serviceLogStats) и очистка (serviceLogClear) — в устройстве ServiceJournal.`;
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
        return {};
    }
    onStart() {
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
    }
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
    hasJournal() {
        return !!(this.sl || this.pl);
    }
    totalRows() {
        var _a, _b;
        let n = 0;
        if ((_a = this.sl) === null || _a === void 0 ? void 0 : _a.table)
            n += this.sl.table.allRows().length;
        if ((_b = this.pl) === null || _b === void 0 ? void 0 : _b.table)
            n += this.pl.table.allRows().length;
        return n;
    }
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
}
exports.default = ServiceLogger;

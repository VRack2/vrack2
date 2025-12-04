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
class Interval extends vrack2_core_1.Device {
    constructor() {
        super(...arguments);
        this.shares = {
            count: 0
        };
    }
    outputs() {
        return {
            gate: vrack2_core_1.Port.return().description('Gate port')
        };
    }
    actions() {
        return {
            'test.action': vrack2_core_1.Action.global().requirements({
                id: vrack2_core_1.Rule.string().required().default('www').description('Произвольный ID'),
                list: vrack2_core_1.Rule.array().required().content(vrack2_core_1.Rule.array().required().content(vrack2_core_1.Rule.string().default('').maxLength(24).description('Element of list'))).description('Long long description'),
                obj: vrack2_core_1.Rule.object().fields({
                    bool: vrack2_core_1.Rule.boolean().required().default(true).description('Boolean checkbox')
                }).description('TEst ibject description'),
            }).description('Тестовый запрос Action')
        };
    }
    checkOptions() {
        return {
            timeout: vrack2_core_1.Rule.number().integer().min(0).description('Interval timeout').example(0)
        };
    }
    metrics() {
        return {
            'test.metric': vrack2_core_1.Metric.inS().retentions('1s:6h').description('Первая метрика'),
            'test.metric2': vrack2_core_1.Metric.inS().retentions('1s:6h').description('Вторая метрика'),
            'test.metric3': vrack2_core_1.Metric.inS().retentions('1s:6h').description('Еще одна'),
            'test.metric4': vrack2_core_1.Metric.inS().retentions('1s:6h').description('И еще одна')
        };
    }
    process() {
        const DM = this.Container.Bootstrap.getBootClass('DeviceMetrics', vrack2_core_1.DeviceMetrics);
        setInterval(() => {
            this.shares.count++;
            this.render();
            // this.ports.output.gate.push(0)
            this.terminal('gate output', { push: 0 });
            this.metric('test.metric', Math.sin(Date.now() / 100000));
            this.metric('test.metric2', Math.cos(Date.now() / 100000));
            this.metric('test.metric3', -Math.sin(Date.now() / 100000));
            this.metric('test.metric4', -Math.cos(Date.now() / 100000));
        }, this.options.timeout);
        setInterval(() => __awaiter(this, void 0, void 0, function* () {
            const s = yield this.ports.output['gate'].push({
                command: 'service',
                data: { service: 'test' }
            });
        }), 5000);
    }
    actionTestAction(data) {
        return ['12', '34', '56'];
    }
}
exports.default = Interval;

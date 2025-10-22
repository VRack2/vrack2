import { Action, Device, Port, Rule, Metric, Bootstrap, DeviceMetrics } from "vrack2-core";
import BasicAction from "vrack2-core/lib/actions/BasicAction";
import BasicMetric from "vrack2-core/lib/metrics/BasicMetric";
import BasicPort from "vrack2-core/lib/ports/BasicPort";
import BasicType from "vrack2-core/lib/validator/types/BasicType";

export default class Interval extends Device {

    outputs(): { [key: string]: BasicPort; } {
        return {
            gate: Port.return().description('Gate port')
        }
    }

    actions(): { [key: string]: BasicAction; } {
        return {
            'test.action': Action.global().requirements({
                id: Rule.string().require().default('www').description('Произвольный ID'),
                list: Rule.array().require().content(
                    Rule.array().require().content(
                        Rule.string().default('').maxLength(24).description('Element of list')
                    )
                ).description('Long long description'),
                obj: Rule.object().fields({
                    bool: Rule.boolean().require().default(true).description('Boolean checkbox')
                }).description('TEst ibject description'),
            }).description('Тестовый запрос Action')
        }
    }

    checkOptions(): { [key: string]: BasicType; } {
        return {
            timeout: Rule.number().integer().min(0).description('Interval timeout').example(0)
        }
    }

    metrics(): { [key: string]: BasicMetric; } {
        return {
            'test.metric': Metric.inS().retentions('1s:6h').description('Первая метрика'),
            'test.metric2': Metric.inS().retentions('1s:6h').description('Вторая метрика'),
            'test.metric3': Metric.inS().retentions('1s:6h').description('Еще одна'),
            'test.metric4': Metric.inS().retentions('1s:6h').description('И еще одна')
        }
    }

    shares = {
        count: 0
    }

    process(){
        const DM = this.Container.Bootstrap.getBootClass('DeviceMetrics', DeviceMetrics) as DeviceMetrics

        setInterval(() => {
            this.shares.count++
            this.render()
            // this.ports.output.gate.push(0)
            this.terminal('gate output', { push: 0 })
            this.metric('test.metric', Math.sin(Date.now()/100000))
            this.metric('test.metric2', Math.cos(Date.now()/100000))
            this.metric('test.metric3', -Math.sin(Date.now()/100000))
            this.metric('test.metric4', -Math.cos(Date.now()/100000))
        }, this.options.timeout);        

        setInterval(async ()=>{
            const s = await this.ports.output['gate'].push({
                command: 'service',
                data: { service: 'test' }
            })
        }, 5000)
    }

    actionTestAction(data: { id: string }){
        return ['12','34','56']
    }
}
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

import IGuardMessage from "./interfaces/IGuardMessage";

ErrorManager.register('ServiceLogger', 'SERVICE_JOURNAL_DISABLED', 'Service journal is unavailable. Enable the core ServiceLogger/PortLogger boot classes (vrack2-core.DEFAULT_BOOTLIST) for this service and restart')

/**
 * Live вкл/выкл журнала на запущенном сервисе.
 *
 * Чтение (serviceLog / serviceLogStats) и очистка (serviceLogClear)
 * вынесены в ServiceJournal (работает с диска, без запущенного сервиса).
 * Здесь остаётся только serviceLogSet — live toggle, который требует
 * живых boot-классов в контейнере.
 */
export default class ServiceLogger extends Device {

    description(): string {
        return `Устройство ServiceLogger — live вкл/выкл журнала запущенного сервиса (serviceLogSet).
Чтение (serviceLog/serviceLogStats) и очистка (serviceLogClear) — в устройстве ServiceJournal.`
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
        return {}
    }

    ContainerRef: Container | null = null

    sl: CoreServiceLogger | null = null

    pl: CorePortLogger | null = null

    onStart(): void {
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
    }

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

    protected hasJournal(): boolean {
        return !!(this.sl || this.pl)
    }

    protected totalRows(): number {
        let n = 0
        if (this.sl?.table) n += this.sl.table.allRows().length
        if (this.pl?.table) n += this.pl.table.allRows().length
        return n
    }

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
}

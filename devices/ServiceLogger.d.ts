import { Container, Device, ServiceLogger as CoreServiceLogger, PortLogger as CorePortLogger } from "vrack2-core";
import BasicPort from "vrack2-core/lib/ports/BasicPort";
import BasicType from "vrack2-core/lib/validator/types/BasicType";
import IGuardMessage from "./interfaces/IGuardMessage";
/**
 * Live вкл/выкл журнала на запущенном сервисе.
 *
 * Чтение (serviceLog / serviceLogStats) и очистка (serviceLogClear)
 * вынесены в ServiceJournal (работает с диска, без запущенного сервиса).
 * Здесь остаётся только serviceLogSet — live toggle, который требует
 * живых boot-классов в контейнере.
 */
export default class ServiceLogger extends Device {
    description(): string;
    inputs(): {
        [key: string]: BasicPort;
    };
    outputs(): {
        [key: string]: BasicPort;
    };
    checkOptions(): {
        [key: string]: BasicType;
    };
    ContainerRef: Container | null;
    sl: CoreServiceLogger | null;
    pl: CorePortLogger | null;
    onStart(): void;
    inputContainer(data: {
        container: Container;
        meta?: any;
    }): void;
    protected hasJournal(): boolean;
    protected totalRows(): number;
    apiServiceLogSet(data: {
        service: string;
        enabled: boolean;
    }, gData: IGuardMessage): Promise<{
        enabled: boolean;
        total: number;
    }>;
}

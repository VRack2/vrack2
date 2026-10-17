import { Container, Device, ServiceLogger as CoreServiceLogger, PortLogger as CorePortLogger } from "vrack2-core";
import BasicPort from "vrack2-core/lib/ports/BasicPort";
import BasicType from "vrack2-core/lib/validator/types/BasicType";
import IGuardMessage from "./interfaces/IGuardMessage";
/**
 * Единая «сырая» строка журнала, независимо от того, из какой таблицы она:
 * device_log (boot-класс ServiceLogger) или port_log (boot-класс PortLogger).
 */
type RawRow = {
    ts: number;
    type: string;
    device: string;
    port: string | null;
    value: any;
};
/** Компактированная запись журнала (формат MCP-ответа) */
type LogEntry = {
    t: number;
    l: number;
    n: number;
    type: string;
    device: string;
    port?: string;
    value: any;
};
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
 *                         (interval) и типам за произвольный период + топ
 *                         отправителей (device+port по убыванию количества);
 *   - serviceLogSet     — live вкл/выкл обоих boot-классов (enable/disable);
 *   - serviceLogClear   — truncate обеих таблиц.
 *
 * Контейнер сервиса приходит по входному порту `container` (его передаёт
 * Service.ts в worker'е до run()); device достаёт из него boot-классы через
 * `container.Bootstrap.getBootClass(...)`.
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
    /**
     * Контейнер запущенного сервиса (live-объект)
     */
    ContainerRef: Container | null;
    /**
     * core-boot-класс ServiceLogger (таблица device_log) — если присутствует в bootlist сервиса
     */
    sl: CoreServiceLogger | null;
    /**
     * core-boot-класс PortLogger (таблица port_log) — если присутствует в bootlist сервиса
     */
    pl: CorePortLogger | null;
    onStart(): void;
    /**
     * Вход: контейнер запущенного сервиса (+ мета). Достаём из контейнера
     * core-boot-классы ServiceLogger / PortLogger (через container.Bootstrap).
     */
    inputContainer(data: {
        container: Container;
        meta?: any;
    }): void;
    /**
     * Общее: хотя бы один boot-класс журнала доступен
     */
    protected hasJournal(): boolean;
    /**
     * Всего записей в обеих таблицах (0, если таблицы ещё не созданы)
     */
    protected totalRows(): number;
    /**
     * Ограничение размера значения (обрезка при чтении)
     */
    protected truncValue(value: any): any;
    protected sameValue(a: any, b: any): boolean;
    /**
     * Склейка последовательных одинаковых записей (одинаковые type/device/port/value,
     * разрыв <= mergeWindow сек) в одну: t = первая, l = последняя, n = количество.
     * Вход — по возрастанию ts; выход — компактные записи.
     */
    protected compress(rows: RawRow[]): LogEntry[];
    /**
     * Собирает сырые строки из обеих core-таблиц (device_log + port_log).
     * Чтение через allRows(): журналы сервиса умеренны по объёму (события + push'ы),
     * а core-классы сами используют allRows() в tail()/count().
     */
    protected collectRaw(since: number | string): RawRow[];
    /**
     * Чтение журнала сервиса (обе таблицы: device_log + port_log),
     * фильтр по device/type/since, склейка t/l/n, последние `limit`.
     */
    apiServiceLog(data: {
        service: string;
        limit?: number;
        device?: string;
        type?: string;
        since?: any;
    }, gData: IGuardMessage): Promise<{
        enabled: boolean;
        entries: LogEntry[];
        total: number;
        dropped: number;
    }>;
    /**
     * Компактная статистика журнала: количество записей в периоде, разбитое
     * по бакетам (interval) и по типам. Считается на стороне воркера поверх
     * vrack2-journal-db (scan с проекцией ts+type), ответ компактный — подходит
     * для длинных периодов (недели/месяцы) без тягания сырых записей.
     */
    apiServiceLogStats(data: {
        service: string;
        period?: string;
        interval?: string;
        types?: string[];
        devices?: string[];
        maxBuckets?: number;
    }, gData: IGuardMessage): Promise<{
        period: {
            start: number;
            end: number;
        };
        interval: string;
        total: number;
        totals: Record<string, number>;
        buckets: {
            header: string[];
            rows: [number, number, Record<string, number>][];
        };
        senders: {
            header: string[];
            rows: [string, string | null, number][];
        };
    }>;
    /**
     * Live-вкл/выкл журнала на УЖЕ РАБОТАЮЩЕМ сервисе (оба boot-класса сразу).
     */
    apiServiceLogSet(data: {
        service: string;
        enabled: boolean;
    }, gData: IGuardMessage): Promise<{
        enabled: boolean;
        total: number;
    }>;
    /**
     * Очистка журнала (truncate обеих таблиц).
     */
    apiServiceLogClear(data: {
        service: string;
    }, gData: IGuardMessage): Promise<{
        cleared: boolean;
        removedRows: number;
    }>;
}
export {};

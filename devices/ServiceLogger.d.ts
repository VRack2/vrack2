import { Container, Device } from "vrack2-core";
import BasicPort from "vrack2-core/lib/ports/BasicPort";
import BasicType from "vrack2-core/lib/validator/types/BasicType";
import { Journal } from 'vrack2-journal-db';
import IGuardMessage from "./interfaces/IGuardMessage";
import IServiceMeta from "./interfaces/IServiceMeta";
/** Строка журнала в базе данных */
type JournalRow = {
    ts: number;
    l: number;
    type: string;
    device: string;
    port: string | null;
    n: number;
    value: any;
};
/**
 * Device that captures the service journal of the started service container.
 *
 * Gets the live `Container` (together with the service meta) via the `container`
 * input port before the container is started, so it can subscribe to device
 * events and outgoing port pushes while the devices are running up.
 * The journal is enabled by the service meta "journal": true flag.
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
     * Service container (live object)
     */
    ContainerRef: Container | null;
    /**
     * Service meta (IServiceMeta)
     */
    Meta: IServiceMeta | null;
    /**
     * Журнал: включен ли (meta "journal": true)
     */
    logEnabled: boolean;
    /**
     * Журнал: база данных vrack2-journal-db (открыта на сервис, если журнал включен)
     */
    journal: Journal | null;
    /**
     * Журнал: последняя компактированная запись, еще не записанная в базу
     * (склейка повторяющихся событий до mergeWindow; фиксируется при следующей записи или перед чтением)
     */
    pendingRow: JournalRow | null;
    /**
     * Журнал: ключ последней записи (для склейки одинаковых значений)
     */
    pendingKey: string;
    /**
     * Журнал: порты, уже обёрнутые для захвата (защита от двойной обёртки)
     */
    logWrappedPorts: Set<any>;
    /**
     * Devices events list
     */
    eventsChannels: {
        [key: string]: string;
    };
    process(): void;
    /**
     * Вход: контейнер запущенного сервиса + мета
     * Подписки выполняются до run() контейнера, поэтому журнал
     * фиксирует события запуска устройств
     *
     * @param data { container, meta }
     */
    inputContainer(data: {
        container: Container;
        meta: IServiceMeta;
    }): void;
    /**
     * Stop-хук: Container.stopDevice()/stopAll() вызывает stop(), а затем AWAIT этого метода.
     * Дописывает накопленную запись и закрывает базу журнала (синхронные операции),
     * поэтому данные гарантированно на диске до выхода воркера из памяти.
     */
    stopPromise(): Promise<void>;
    /**
     * Запись накопленной (еще не зафиксированной) записи в базу и закрытие журнала
     */
    protected closeJournal(): void;
    /**
     * Привязка захвата журнала (только если meta "journal": true, по умолчанию выключен)
     *
     * 1) Открытие журнала сервиса в базе vrack2-journal-db (<baseDir>/journals/<serviceId>)
     * 2) Подписка на события устройств (error/notify/alert/terminal/event/terminate)
     * 3) Обертка push() всех OUTPUT-портов устройств сервиса —
     *    каждая исходящая запись фиксируется в журнале (входящие порты не логируются)
     *
     * @see logAppend
     * @see apiServiceLog
     */
    protected bindLogCapture(): Promise<void>;
    /**
     * Добавление записи в журнал (база vrack2-journal-db, append-only + WAL)
     *
     * Последовательные одинаковые значения (одинаковые type/device/port/value,
     * разрыв <= mergeWindow сек) склеиваются в одну запись: n++ и l = время последней.
     * Пока идет склейка, запись держится в pendingRow; она фиксируется в базе
     * при следующей отличной записи или перед чтением (apiServiceLog/clear).
     *
     * @param {Object} e Запись журнала
     * @param {string} e.type Тип записи (port/notify/alert/event/terminal/error/terminate)
     * @param {string} e.device ID устройства
     * @param {string} [e.port] Название выходного порта (для type=port)
     * @param {any} e.value Значение / сообщение
     */
    protected logAppend(e: {
        type: string;
        device: string;
        port?: string;
        value: any;
    }): void;
    /**
     * Фиксация накопленной записи (pendingRow) в базе перед чтением
     */
    protected flushPending(): void;
    /**
     * Получение хвоста журнала сервиса (база vrack2-journal-db, включается в meta: "journal": true)
     *
     * Записи берутся из базы свежайшими к старым (page desc), поэтому старые
     * сегменты не читаются зря; фильтры применяются поверх выборки.
     *
     * @param {Object} data Данные запроса
     * @param {string} data.service ID сервиса
     * @param {number} [data.limit] Максимум записей (последние), по умолчанию 20
     * @param {string} [data.device] Фильтр по ID устройства
     * @param {string} [data.type] Фильтр по типу записи: port|notify|alert|event|terminal|error|terminate
     * @param {number} [data.since] Только записи с t >= этого времени (сек)
     */
    apiServiceLog(data: {
        service: string;
        limit?: number;
        device?: string;
        type?: string;
        since?: number;
    }, gData: IGuardMessage): Promise<{
        enabled: boolean;
        entries: {
            t: number;
            l: number;
            n: number;
            type: string;
            device: string;
            port: string | undefined;
            value: any;
        }[];
        total: number;
        dropped: number;
    }>;
    /**
     * Очистка журнала сервиса (база vrack2-journal-db)
     *
     * @param {Object} data Данные запроса
     * @param {string} data.service ID сервиса
     */
    apiServiceLogClear(data: {
        service: string;
    }, gData: IGuardMessage): Promise<{
        cleared: boolean;
    }>;
    /**
     * Очистка данных журнала на диске, когда журнал выключен в meta.
     * Базу открываем только если директория уже существует (не создаем пустой журнал для сервиса без данных)
     */
    protected clearDiskJournal(serviceId: string): {
        cleared: boolean;
    };
    /**
     * Компакция журнала сервиса (база vrack2-journal-db):
     * склейка закрытых сегментов в один файл (уменьшает количество файлов на диске)
     *
     * @param {Object} data Данные запроса
     * @param {string} data.service ID сервиса
     */
    apiServiceLogCompact(data: {
        service: string;
    }, gData: IGuardMessage): Promise<{
        mergedSegments: number;
        logicalRows: number;
        physicalBefore: number;
        physicalAfter: number;
    }>;
}
export {};

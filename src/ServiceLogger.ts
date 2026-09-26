import { Container, Device, Port, Rule, ErrorManager } from "vrack2-core";

import BasicPort from "vrack2-core/lib/ports/BasicPort";
import BasicType from "vrack2-core/lib/validator/types/BasicType";

import { Journal } from 'vrack2-journal-db'
import type { Schema } from 'vrack2-journal-db'

import { join } from 'path'
import * as fs from 'fs'

import IGuardMessage from "./interfaces/IGuardMessage";
import IServiceMeta from "./interfaces/IServiceMeta";

ErrorManager.register('ServiceLogger', 'SERVICE_JOURNAL_DISABLED', 'Service journal is disabled. Add "journal": true to the service meta file (services/<id>.meta.json) and restart the service')

/** Схема записей журнала в vrack2-journal-db */
const JOURNAL_SCHEMA: Schema = {
    ts: 'delta',        // время первой записи (неубывает при append'е)
    l: 'delta',         // время последней записи компактированной строки
    type: 'dictionary',
    device: 'dictionary',
    port: 'auto',       // null для событий без порта
    n: 'rle',           // количество повторений (серии 1 — схлопываются)
    value: 'raw',
}

/** Строка журнала в базе данных */
type JournalRow = {
    ts: number
    l: number
    type: string
    device: string
    port: string | null
    n: number
    value: any
}

/**
 * Device that captures the service journal of the started service container.
 *
 * Gets the live `Container` (together with the service meta) via the `container`
 * input port before the container is started, so it can subscribe to device
 * events and outgoing port pushes while the devices are running up.
 * The journal is enabled by the service meta "journal": true flag.
 */
export default class ServiceLogger extends Device {

    description(): string {
        return `Устройство ServiceLogger ведет журнал запущенного сервиса: подписывается на события устройств
(notify/alert/event/terminal/error/terminate) и обертывает исходящие порты устройств контейнера.
Журнал хранится персистентно в базе vrack2-journal-db (файлы <baseDir>/journals/<service>), включается в meta сервиса ("journal": true).`
    }

    inputs(): { [key: string]: BasicPort; } {
        return {
            container: Port.standard()
                .requirement(Rule.object().fields({
                    container: Rule.any().description('Live Container of the started service'),
                    meta: Rule.any().description('Service meta (IServiceMeta)'),
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
        return {
            'baseDir': Rule.string().default('.').description('Base dir of vrack2-journal-db relative to process cwd. Service journal files live at <baseDir>/journals/<serviceId>'),
            'rowsPerSegment': Rule.number().integer().min(1).default(10000).description('Rows per segment file in vrack2-journal-db (bigger — fewer files; default 10000)'),
            'mergeWindow': Rule.number().integer().min(0).default(5).description('Max gap (sec) to merge consecutive identical records into one (t/l/n)'),
            'valueMax': Rule.number().integer().min(32).default(500).description('Max stored value length'),
        }
    }

    /**
     * Service container (live object)
     */
    ContainerRef: Container | null = null

    /**
     * Service meta (IServiceMeta)
     */
    Meta: IServiceMeta | null = null

    /**
     * Журнал: включен ли (meta "journal": true)
     */
    logEnabled: boolean = false

    /**
     * Журнал: база данных vrack2-journal-db (открыта на сервис, если журнал включен)
     */
    journal: Journal | null = null

    /**
     * Журнал: последняя компактированная запись, еще не записанная в базу
     * (склейка повторяющихся событий до mergeWindow; фиксируется при следующей записи или перед чтением)
     */
    pendingRow: JournalRow | null = null

    /**
     * Журнал: ключ последней записи (для склейки одинаковых значений)
     */
    pendingKey: string = ''

    /**
     * Журнал: порты, уже обёрнутые для захвата (защита от двойной обёртки)
     */
    logWrappedPorts: Set<any> = new Set()

    /**
     * Devices events list
     */
    eventsChannels: { [key: string]: string } = {
        'device.error':  'error',
        'device.notify': 'notify',
        'device.alert':  'alert',
        'device.terminal': 'terminal',
        'device.event':  'event'
    }

    process(): void {
        this.ports.output['register.command'].push({
            command: 'serviceLog',
            short: 'Service journal tail',
            description: 'Get the last entries of the service journal stored in vrack2-journal-db at <baseDir>/journals/<serviceId> (enabled by service meta "journal": true, disabled by default). Records: outgoing port pushes and device events (notify/alert/event/terminal/error/terminate). Consecutive identical values are compacted into one record (t/l/n).',
            level: 3,
            owner: this.type,
            icon: 'log-list',
            handler: this.apiServiceLog.bind(this),
            rules: {
                service: Rule.string().maxLength(120).required().example('test-service').description('Service id'),
                limit: Rule.number().integer().min(1).max(100000).default(20).description('Max entries to return (latest)'),
                device: Rule.string().maxLength(120).default('').example('').description('Filter by device id (empty - no filter)'),
                type: Rule.string().maxLength(20).default('').example('port').description('Filter by entry type: port|notify|alert|event|terminal|error|terminate (empty - no filter)'),
                since: Rule.number().integer().default(0).example(0).description('Only entries with t >= this timestamp (sec, 0 - no filter)'),
            },
            return: Rule.object().fields({
                enabled: Rule.boolean().example(true).description('Journal enabled flag'),
                entries: Rule.array().content(Rule.object().fields({
                    t: Rule.number().integer().example(1).description('First timestamp (sec)'),
                    l: Rule.number().integer().example(1).description('Last timestamp (sec)'),
                    n: Rule.number().integer().example(1).description('Count of compacted occurrences'),
                    type: Rule.string().example('port').description('Entry type: port|notify|alert|event|terminal|error|terminate'),
                    device: Rule.string().example('DeviceID').description('Device id'),
                    port: Rule.string().example('state').description('Output port name (type=port)'),
                    value: Rule.any().description('Value / message'),
                })).description('Journal entries (chronological)'),
                total: Rule.number().integer().example(100).description('Total stored entries'),
                dropped: Rule.number().integer().example(0).description('Legacy field, always 0 (journal is stored persistently and has no capacity limit)'),
            }).description('Journal tail result')
        })

        this.ports.output['register.command'].push({
            command: 'serviceLogClear',
            short: 'Service journal clear',
            description: 'Clear the service journal data stored in vrack2-journal-db at <baseDir>/journals/<serviceId>. Works even when the journal is disabled in meta — removes data left from previous runs',
            level: 3,
            owner: this.type,
            icon: 'log-list',
            handler: this.apiServiceLogClear.bind(this),
            rules: {
                service: Rule.string().maxLength(120).required().example('test-service').description('Service id'),
            },
            return: Rule.object().description('Clear result')
        })

        this.ports.output['register.command'].push({
            command: 'serviceLogCompact',
            short: 'Service journal compact',
            description: 'Repack the service journal in vrack2-journal-db at <baseDir>/journals/<serviceId>: merge all closed segment files into one (reduces file count)',
            level: 3,
            owner: this.type,
            icon: 'log-list',
            handler: this.apiServiceLogCompact.bind(this),
            rules: {
                service: Rule.string().maxLength(120).required().example('test-service').description('Service id'),
            },
            return: Rule.object().fields({
                mergedSegments: Rule.number().integer().example(5).description('Closed segments merged into one'),
                logicalRows: Rule.number().integer().example(100).description('Logical rows preserved'),
                physicalBefore: Rule.number().integer().example(200).description('Physical rows before compaction (incl. duplicates)'),
                physicalAfter: Rule.number().integer().example(100).description('Physical rows after compaction'),
            }).description('Compact result')
        })
    }

    /**
     * Вход: контейнер запущенного сервиса + мета
     * Подписки выполняются до run() контейнера, поэтому журнал
     * фиксирует события запуска устройств
     *
     * @param data { container, meta }
     */
    inputContainer(data: { container: Container, meta: IServiceMeta }) {
        this.ContainerRef = data.container
        this.Meta = data.meta
        this.closeJournal()
        this.pendingRow = null
        this.logWrappedPorts = new Set()
        this.bindLogCapture()
    }

    /**
     * Stop-хук: Container.stopDevice()/stopAll() вызывает stop(), а затем AWAIT этого метода.
     * Дописывает накопленную запись и закрывает базу журнала (синхронные операции),
     * поэтому данные гарантированно на диске до выхода воркера из памяти.
     */
    async stopPromise(): Promise<void> {
        this.closeJournal()
    }

    /**
     * Запись накопленной (еще не зафиксированной) записи в базу и закрытие журнала
     */
    protected closeJournal() {
        if (!this.journal) return
        try {
            if (this.pendingRow) {
                this.journal.append(this.pendingRow)
                this.pendingRow = null
            }
            this.journal.close()
        } catch (err) {
            console.error(`[ServiceLogger] failed to flush/close journal: ${(err as Error).message}`)
        } finally {
            this.journal = null
        }
    }

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
    protected async bindLogCapture() {
        if (!this.ContainerRef) return
        this.logEnabled = this.Meta?.journal === true
        if (!this.logEnabled) return

        // База данных журнала: <baseDir>/journals/<serviceId> (файлы переживают перезапуск)
        const serviceId = String((this.ContainerRef as any).id || this.Meta?.name || 'service')
        try {
            const rpsRaw = Number(this.options.rowsPerSegment)
            const rowsPerSegment = (Number.isInteger(rpsRaw) && rpsRaw >= 1) ? rpsRaw : 10000
            // lock:'off' — не создавать/проверять .lock файлы: сервисы vrack2 живут в worker_threads,
            // PID-блокировка при живом процессе выглядит «занятой» навсегда; владелец журнала уникален (контейнер сервиса)
            this.journal = new Journal(join(process.cwd(), String(this.options.baseDir)), { rowsPerSegment, lock: 'off' })
            this.journal.open(serviceId, JOURNAL_SCHEMA, { owner: 'vrack2.ServiceLogger' })
        } catch (err) {
            this.logEnabled = false
            console.error(`[ServiceLogger] failed to open journal db for service "${serviceId}": ${(err as Error).message}`)
            return
        }

        // События устройств
        for (const channel in this.eventsChannels) {
            const type = channel.replace('device.', '')
            this.ContainerRef.on(channel, (data: { device: string; data: any; trace: any; }) => {
                this.logAppend({ type, device: data.device, value: data.data })
            })
        }
        this.ContainerRef.on('device.terminate', (data: { device: string; data: any; trace: any; }) => {
            this.logAppend({ type: 'terminate', device: data.device, value: data.data })
        })

        // Исходящие порты: обертываем push после инициализации устройства
        // (порты уже существуют и связаны, иначе записи не дошли бы до коннектов)
        const wrap = () => {
            for (const id in (this.ContainerRef as Container).devices) {
                const dev = (this.ContainerRef as Container).devices[id]
                for (const pname in dev.ports.output) {
                    const port = dev.ports.output[pname]
                    if (port === undefined || typeof port.push !== 'function') continue
                    if (this.logWrappedPorts.has(port)) continue
                    const orig = port.push.bind(port)
                    port.push = (data: any) => {
                        this.logAppend({ type: 'port', device: id, port: pname, value: data })
                        return orig(data)
                    }
                    this.logWrappedPorts.add(port)
                }
            }
        }
        if (Object.keys((this.ContainerRef as Container).devices).length > 0) wrap()
        else (this.ContainerRef as Container).once('afterInit', wrap)
    }

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
    protected logAppend(e: { type: string; device: string; port?: string; value: any; }) {
        if (!this.journal || !this.logEnabled) return

        // Ограничение размера значения
        let value = e.value
        if (value !== null && typeof value === 'object') {
            try {
                const s = JSON.stringify(value)
                if (s.length > this.options.valueMax) value = s.slice(0, this.options.valueMax) + '…'
            } catch {
                value = String(value).slice(0, this.options.valueMax)
            }
        } else if (typeof value === 'string' && value.length > this.options.valueMax) {
            value = value.slice(0, this.options.valueMax) + '…'
        }

        const key = [e.type, e.device, e.port === undefined ? '' : e.port, JSON.stringify(value === undefined ? null : value)].join('|')
        const now = Math.floor(Date.now() / 1000)

        // Склейка с предыдущей записью (пока она не зафиксирована в базе)
        if (this.pendingRow && this.pendingKey === key && now - this.pendingRow.l <= this.options.mergeWindow) {
            this.pendingRow.l = now
            this.pendingRow.n++
            return
        }

        // Предыдущая запись зафиксирована, новая — в буфер склейки
        if (this.pendingRow) this.journal.append(this.pendingRow)
        this.pendingKey = key
        this.pendingRow = { ts: now, l: now, type: e.type, device: e.device, port: e.port === undefined ? null : e.port, n: 1, value: value === undefined ? null : value }
    }

    /**
     * Фиксация накопленной записи (pendingRow) в базе перед чтением
     */
    protected flushPending() {
        if (!this.journal || !this.pendingRow) return
        try {
            this.journal.append(this.pendingRow)
        } catch (err) {
            console.error(`[ServiceLogger] failed to append journal row: ${(err as Error).message}`)
        }
        this.pendingRow = null
    }

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
    async apiServiceLog(data: { service: string; limit?: number; device?: string; type?: string; since?: number; }, gData: IGuardMessage) {
        if (!this.logEnabled || !this.journal) throw ErrorManager.make('SERVICE_JOURNAL_DISABLED')

        // Фиксируем накопленную запись, чтобы она попала в выборку и total
        this.flushPending()

        const limit = (data.limit === undefined || data.limit < 1) ? 20 : data.limit
        const since = (data.since && data.since > 0) ? data.since : 0

        // Выборка свежайших записей с фильтрами: идем чанками от новых к старым,
        // пока не соберем `limit` совпадений или не дойдем до начала журнала.
        // Записи идут в порядке убывания ts — ниже since совпадений уже не будет.
        const matches: JournalRow[] = []
        let offset = 0
        let exhausted = false
        const chunk = Math.max(100, limit * 5)
        for (;;) {
            const batch = this.journal.page(chunk, offset, 'desc') as JournalRow[]
            if (batch.length === 0) break
            for (const r of batch) {
                if (since && (!r.ts || r.ts < since)) { exhausted = true; break }
                if (data.device && r.device !== data.device) continue
                if (data.type && r.type !== data.type) continue
                matches.unshift(r)
            }
            offset += batch.length
            if (exhausted || matches.length >= limit || batch.length < chunk) break
        }

        return {
            enabled: true,
            entries: matches.slice(-limit).map((e) => ({ t: e.ts, l: e.l, n: e.n, type: e.type, device: e.device, port: e.port === null ? undefined : e.port, value: e.value })),
            total: this.journal!.stats().totalRows,
            dropped: 0,
        }
    }

    /**
     * Очистка журнала сервиса (база vrack2-journal-db)
     *
     * @param {Object} data Данные запроса
     * @param {string} data.service ID сервиса
     */
    async apiServiceLogClear(data: { service: string }, gData: IGuardMessage) {
        if (!this.logEnabled || !this.journal) {
            // Журнал выключен в meta, но данные от предыдущих запусков могли остаться на диске — удаляем их тоже
            const serviceId = String((this.ContainerRef as any).id || this.Meta?.name || 'service')
            return this.clearDiskJournal(serviceId)
        }
        this.flushPending()
        try {
            this.journal.clear()
        } catch (err) {
            console.error(`[ServiceLogger] failed to clear journal: ${(err as Error).message}`)
            throw err
        }
        return { cleared: true }
    }

    /**
     * Очистка данных журнала на диске, когда журнал выключен в meta.
     * Базу открываем только если директория уже существует (не создаем пустой журнал для сервиса без данных)
     */
    protected clearDiskJournal(serviceId: string): { cleared: boolean } {
        const baseDir = join(process.cwd(), String(this.options.baseDir))
        if (!fs.existsSync(join(baseDir, 'journals', serviceId))) return { cleared: false }

        let journal: Journal | null = null
        try {
            const rpsRaw = Number(this.options.rowsPerSegment)
            const rowsPerSegment = (Number.isInteger(rpsRaw) && rpsRaw >= 1) ? rpsRaw : 10000
            journal = new Journal(baseDir, { rowsPerSegment, lock: 'off' })
            journal.open(serviceId, JOURNAL_SCHEMA, { owner: 'vrack2.ServiceLogger.clear' })
            journal.clear()
            return { cleared: true }
        } catch (err) {
            console.error(`[ServiceLogger] failed to clear on-disk journal for service "${serviceId}": ${(err as Error).message}`)
            throw err
        } finally {
            try { if (journal) journal.close() } catch { /* уже закрыта или не открылась */ }
        }
    }

    /**
     * Компакция журнала сервиса (база vrack2-journal-db):
     * склейка закрытых сегментов в один файл (уменьшает количество файлов на диске)
     *
     * @param {Object} data Данные запроса
     * @param {string} data.service ID сервиса
     */
    async apiServiceLogCompact(data: { service: string }, gData: IGuardMessage) {
        if (!this.logEnabled || !this.journal) throw ErrorManager.make('SERVICE_JOURNAL_DISABLED')
        this.flushPending()
        try {
            const r = this.journal.compact()
            return { mergedSegments: r.mergedSegments, logicalRows: r.logicalRows, physicalBefore: r.physicalBefore, physicalAfter: r.physicalAfter }
        } catch (err) {
            console.error(`[ServiceLogger] failed to compact journal: ${(err as Error).message}`)
            throw err
        }
    }
}

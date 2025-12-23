/// <reference types="node" />
import { Device } from "vrack2-core";
import BasicPort from "vrack2-core/lib/ports/BasicPort";
import BasicType from "vrack2-core/lib/validator/types/BasicType";
import IGuardMessage from "./interfaces/IGuardMessage";
import IServiceConfig from "./interfaces/IServiceConfig";
import IServiceMeta from "./interfaces/IServiceMeta";
export default class ServiceManager extends Device {
    outputs(): {
        [key: string]: BasicPort;
    };
    inputs(): {
        [key: string]: BasicPort;
    };
    options: {
        autoStart: boolean;
        autoReload: boolean;
        printErrors: boolean;
        ignoreAutoReloadErrors: Array<string>;
        servicesDirs: Array<{
            dir: string;
            generate: boolean;
        }>;
    };
    checkOptions(): {
        [key: string]: BasicType;
    };
    /**
     * Содержит данные конфигурации всех сервисов
    */
    protected servicesList: {
        [key: string]: IServiceConfig;
    };
    /**
     * Содержит метадата сервисов
    */
    protected servicesMeta: {
        [key: string]: IServiceMeta;
    };
    /**
     * Содержит ошибки сервисов
    */
    protected servicesErrors: {
        [key: string]: Array<any>;
    };
    /**
     * Содержит воркеры сервисов
    */
    protected servicesWorker: {
        [key: string]: number;
    };
    /**
     * Содержит таймеры перезапуска сервисов
    */
    protected servicesTimer: {
        [key: string]: NodeJS.Timeout | undefined;
    };
    /**
     * Мета данные сервиса по умолчанию
    */
    protected defaultMeta: IServiceMeta;
    /**
     * Очередь для отслеживание и перегенерации файлов сервисов
     * Файл сорвиса генерируется не сразу а спустя 500мс после сохранения
     * В этой очереди хранятся таймауты перегенерации
     * */
    protected Queue: Map<string, NodeJS.Timeout | undefined>;
    /**
     * Поля конфигурации сервиса для документации
    */
    protected ServiceRule: import("vrack2-core/lib/validator/types/ObjectType").default;
    process(): void;
    processPromise(): Promise<void>;
    /**
     * Return a general service info
     *
     * @see IServiceConfig
    */
    apiService(data: {
        service: string;
    }): Promise<IServiceConfig>;
    /**
     * Return service meta info
     *
     * @see IServiceMeta
    */
    apiServiceMeta(data: {
        service: string;
    }): Promise<IServiceMeta>;
    /**
     * Return a service list
     *
     * like a
     * ```ts
     * {
     *    "serviceId": {
     *      service data with service metadata
     *    }
     * }
     * ```
     * @see IServiceConfig
     * @see IServiceMeta
    */
    apiServiceList(): Promise<{
        [key: string]: any;
    }>;
    /**
     * Start service command
     *
     * @param data.service service ID
    */
    apiServiceStart(data: {
        service: string;
    }): Promise<IServiceConfig>;
    /**
     * Stop service command
     *
     * @param data.service service ID
    */
    apiServiceStop(data: {
        service: string;
    }): Promise<"success" | IServiceConfig>;
    /***
     * Проверка сервиса
     *
     * Запускает контейнер процесса
     *
     *
     * В случае возникновения ошибки при проверке - ошибка попадет в список ошибок сервиса.
     * Событие контейнера генерироваться не будет.
     *
     * @param data.service serviceID
     * **/
    apiServiceCheck(data: {
        service: string;
    }): Promise<{}>;
    /**
     * Return a service errors list
     *
     * @param data.service service ID
    */
    apiServiceErrors(data: {
        service: string;
    }): Promise<any[]>;
    /**
     * Delete all service errors
     *
     * @param data.service service ID
    */
    apiServiceErrorsClear(data: {
        service: string;
    }): Promise<{}>;
    /**
     * Update service list
     *
     * return service list
     * @see apiServiceList
    */
    apiServiceListUpdate(): Promise<{
        [key: string]: any;
    }>;
    /******      INPUT HANDLERS      *******/
    /**
     * Processes messages from the master
     *
     * Attempts to execute a command within the specified service.
    */
    inputSubmaster(data: IGuardMessage): Promise<any>;
    /**
     * Monitors service files.
     * If changes are made to JS files, it generates new service files.
    */
    protected servicesWatch(): void;
    /**
     *  Regenerate new service file
     *
     * @see servicesWatch()
     */
    protected convert(dir: string, service: string, ext: string, filename: string): Promise<void>;
    /**
     * Starting services when vrack start
    */
    protected servicesStart(): Promise<void>;
    /**
     * Отправляет информацию об обновлении конкретных сервисов
    */
    protected broadcastUpdate(ids: Array<string>): void;
    /**
     * Формирует данные для воркера, такие как:
     *
     *  - Путь до файла процесса
     *  - Идентификатор контейнера
     *  - Определение класса MainProcess
     *
    */
    protected serviceWorkerData(conf: IServiceConfig, type: string): {
        processFile: string;
        confFile: string;
        contaierId: string;
        MainProcess: string;
    };
    /**
     * Return service information
     *
     * @param service Service ID
    */
    protected getService(service: string): IServiceConfig;
    /**
     * Return service metadata information
     *
     * @param service Service ID
    */
    protected getMeta(service: string): IServiceMeta;
    /**
     * Export service list with meta data
     *
     * @see apiServiceList
     * @see apiServiceListUpdate
    */
    protected exportServiceList(): {
        [key: string]: any;
    };
    /**
     * Export one service with metadata
     **/
    protected exportService(id: string): IServiceConfig;
    /**
     * Add error for service
     */
    protected addError(service: string, error: any): void;
    /**
     * Try read metadata file
     *
     * @param p Path to metadata file
    */
    protected readServiceMeta(p: string): any;
    /**
     * Searches all files and updates the list of available services in the directory
     *
     * @param dir Path to services dir
    */
    protected updateServicesDir(dir: string): void;
}

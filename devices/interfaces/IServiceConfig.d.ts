export default interface IServiceConfig {
    /** Service UID */
    id: string;
    /** Count of service errros */
    errors: number;
    /** Path to service file */
    filePath: string;
    /** Path to meta file */
    metaPath: string;
    /** Path to replace config file */
    configPath: string;
    /** Path to upper service file for replace original service file */
    processPath: string;
    /** Service started at */
    startedAt?: number;
    /** Runned  flag */
    run: boolean;
    /**
     * Флаг устанавливается в true только в случае возникновения ошибки внутри сервиса,
     * которая приводит к прекращению его работы.
     * Он означает, что пока сервис выключен, он должен быть перезапущен.
     * То есть он будет установлен только в случае если в метаданных сервиса
     * разрешен перезапуск сервиса.
     *
     * Что бы сбросить этот флаг и прекратить перезапуск сервиса, можно
     * вызвать apiServiceStop когда сервис выключен
     * */
    autoReload?: boolean;
    /** Deleted flag */
    deleted: boolean;
}

# Журнал изменений (Changelog)

Все значимые изменения VRack2 документируются в этом файле.
Формат основан на [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/), нумерация версий — [Semantic Versioning](https://semver.org/lang/ru/).

## [2.0.0] — 2026-11-12

Новая схема аутентификации и шифрования API: асимметричная (ECDH) авторизация,
аутентифицированное шифрование кадра (AES-256-GCM) и защита от повторных отправок.
**Несовместимые изменения клиентского протокола авторизации.**

Единый журнал уровня платформы: устройство `Journal` (замена `ServiceLogger`), сбор
событий/портов/метрик worker-контейнеров и ответы по любому сервису — запущенному или
остановленному. **Несовместимые изменения форматов `serviceList`/`serviceUpdateList` и
состава read-команд (метрики, каталог команд).**

### Добавлено
- **Асимметричная авторизация (ECDH, P-256).** Ключ создаётся как пара P-256: сервер хранит
  только публичный ключ клиента, ключ канала выводится через ECDH. Общий секрет не передаётся
  по сети и не хранится на сервере.
- **`apiKeyAdd` (cipher)** генерирует пару P-256: `public` сохраняется на сервере, `private` (PEM)
  выдаётся вызывающему один раз и не персистится.
- **Поле `public`** в записи ключа (`IApiKey`) — признак асимметричного ключа.
- **Защита от перебора** неудачных попыток авторизации по источнику (IP, fallback `provider:client`):
  окно 60 с, 20 попыток, далее ошибка `GUARD_RATE_LIMITED`.
- **`apiKeyAuth`** для асимметричных ключей возвращает `serverPub` — публичный ключ P-256 сервера.
- **Документация** `docs/Authentication.md` — полное описание нового протокола (типы ключей, кадр,
  AAD, handshake, ошибки, рекомендации).
- **Референтный клиент** `docs/vrack2-client.mjs` — полный handshake (plain и ECDH).
- **Устройство `Journal`** (замена `ServiceLogger`): worker-контейнеры батчами пишут
  события/порты/метрики в мастерский `Journal` через `WorkersManager.journal`; единое
  хранилище journal-db: `service_event` / `service_port` (TTL) и `service_metric`
  (уровни retention). `serviceLog`, `serviceLogStats`, `serviceDeviceMetric` отвечают
  для любого сервиса — запущенного или остановленного.
- **Команды**: `serviceLogSet` (переключатели сбора, сохранение в meta сервиса и
  live-применение через `serviceJournalSet`), `serviceLogStats`, `serviceDeviceMetric`
  — единое чтение метрик любого контейнера (`service=<svc>`, `worker::<svc>`,
  `vrack2`); submaster-команда `serviceStructure` (компактная/полная схема контейнера).
- **Ключи мета сервиса** `journalEvents` / `journalMetrics` / `journalPorts`
  (`IJournalToggles`): по умолчанию события и метрики — включены, порты — выкл
  (оптимизация явная); `serviceLogSet` с `null` сбрасывает к дефолтам и возвращает
  эффективную конфигурацию.
- **Проброс событий worker-контейнеров и жизненного цикла сервисов** в мастерский журнал.
- **Опция `WorkerProvider.ignoreSignals`** (по умолчанию `true`); транзитный воркер
  `device-info.json` ставит `false`, чтобы `WorkersManager.terminate()` завершал его
  по SIGTERM.

### Изменено
- **Шифрование канала:** `AES-256-CBC` (ключ = секрет, IV = id ключа) заменено на **AES-256-GCM**
  с уникальным на кадре nonce и auth-тегом. Ключ канала (`ek`) выводится через **HKDF-SHA256**;
  сырой секрет больше не используется как ключ шифрования.
- **`apiPrivateAuth`** принимает `frame` (GCM-доказательство) вместо зашифрованной строки `verify`.
- **Защита от replay:** AAD кадра привязывает `{clientId, seq, dir, session}` + монотонные счётчики
  `inSeq`/`outSeq`. Перехваченный кадр нельзя повторить в другой сессии.
- **`apiKeyList`** больше не раскрывает ключевой материал: возвращает только `id, name, key, level`
  (ранее — вся запись, включая `private`/`public`/`description`).
- **`serviceList` / `serviceUpdateList`** возвращают карту `{serviceId: {cfg, meta}}` вместо массива.
- **Доступ к каталогу команд**: `commandsList` (Master) и `serviceCommandsList` (Service) —
  уровень 3 вместо 1000 (ранее каталог был публичным).
- **Метрики**: единственное чтение метрик контейнеров — `Journal.serviceDeviceMetric`.
- **`Mcp` выведен из мастер-графа** `vrack2.json`: MCP подключается оверлеем
  `vrack2.conf.json` (там же `Master.commandPorts` 2 → 3).
- **Зависимость `vrack2-journal-db`** больше не декларируется напрямую — приходит через
  `vrack2-core`.
- **systemd-юнит** (`vrack2.service`): `node ./run/index`, `network-online.target`, тюнинг
  `Restart` / `TimeoutStopSec`, лимит памяти `--max-old-space-size=1024`.
- **Минимальная версия Node.js — 20.**

### Удалено
- Методы `decipherData` / `cipherData` (AES-256-CBC) в Guard — заменены кадрами `frameEncrypt` /
  `frameDecrypt` (AES-256-GCM).
- Формат `apiPrivateAuth` с параметром `verify` (заменён на `frame`).
- **Команды `serviceMetric`** (Service) и **`systemMetric`** (System), интерфейс
  `IDeviceMetricRequest`, bootstrap-классы `DeviceMetrics` / `JournalDbMetrics` — вместо них
  `Journal.serviceDeviceMetric`.
- **Устройство `ServiceLogger`** и команда `serviceLogCompact` — вместо них `Journal` и
  `serviceLogStats`.

### Исправлено
- **`Guard.client.unregister`**: инвертированное условие — событие `client.unregister` никогда
  не вызывалось, записи клиентов утекали.

### Безопасность
- Клиент с уровнем чтения (level 1) **не может** узнать секрет и публичный ключ других ключей через
  `apiKeyList` — наружу отдаются только метаданные.
- Приватный ключ клиента выдаётся один раз и не хранится на сервере; утечка **публичного** ключа
  канал не раскрывает.
- **Совместимость:** ключи со старым общим секретом (поле `private`) продолжают работать (вывод `ek`
  через HKDF), но клиентское ПО обязано использовать новый формат кадра (GCM) и `frame` в
  `apiPrivateAuth`. Клиенты на старом протоколе (AES-256-CBC + `verify`) несовместимы.

> Также в 2.0.0: миграция на VRack2-core v2 (см. коммит `VRack2-core v2 migration`).

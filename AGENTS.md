# VRack2 — заметки для ИИ-агента

VRack2 — рантайм событийно-ориентированных сервисов на Node.js. Сервис — это граф устройств, описанный в JSON, который мастер запускает как отдельный worker.

Эта директория (`devices/vrack2`) — собственный пакет устройств платформы (вендор `vrack2`): мастер, менеджер сервисов, WS-провайдер и т.д. (`devices/Master.js`, `devices/ServiceManager.js`, `devices/Service.js`...). Сервис-файл мастера — `vrack2.json`.

## Основные понятия

- **Устройство (device)** — класс с формальным контрактом:
  - `inputs()` — входные порты, обработчик `input<Port>`; вызываются пушем извне (порт/соединение/MCP)
  - `actions()` — экшены, обработчик `action<Name>`; вызов с гарантированным ответом
  - `checkOptions()` — настройки, валидируются через `Rule` при старте
  - `shares` — объект состояния устройства, читается извне (`serviceDeviceShares`); обновляется явным `this.render()`
  - `outputs()` — исходящие порты, `this.output.port(data)`
  - `onRegister()` — инициализация до портов/соединений (обработчики динамических портов)
  - `onStart()` — запуск (таймеры, подписки)
  - `onStartAsync()` — асинхронная инициализация (создание таблиц, подключение и т.п.), контейнер её ждет
- **Сервис** — JSON-файл в `services/<id>.json`: список устройств, их опции и connections (`"A.port -> B.port"`). Рядом `<id>.meta.json`: `autoStart`, `autoReload`, `isolated` и т.д.
- **Master** — запущенный платформенный сервис (`node ./run/index`), управляет другими сервисами: старт/стоп, статус, ошибки, действия устройств.
- **Bootstrap** — общие ресурсы сервиса, секция `bootstrap` в сервис-файле. Пример: БД. Устройство получает её через `this.getDB()`, не принимает коннект в конструкторе.
- **Границы**: устройство — единица переиспользования (вендор + имя, drop-in). Сервис — единица запуска, отказа и консистентности: один worker, общий доступ к ресурсам (например, одной БД), общая судьба при краше.

## Структура сервис-файла

```json
{
    "devices": [
        { "id": "Dev1", "type": "vendor.Device", "options": { }, "connections": [] }
    ],
    "connections": [],
    "bootstrap": {
        "DB": {
            "path": "vrack2-core.BootDatabaseSqlite",
            "options": { "file": "./data/<id>.sqlite", "wal": true, "readOnly": false }
        }
    }
}
```

- `type` — `вендор.Устройство`, резолвится через `list.json` вендора
- SQLite не создаёт родительские каталоги — каталог `file` должен существовать
- `wal: true` — режим WAL (по умолчанию): параллельные читатели, записи в `<file>-wal`
- Транзакция: `const db = this.getDB(); await db.transaction(async (t) => { ... })`

## Структура пакета устройств (вендора)

```
devices/<vendor>/
  list.json      — имя устройства → путь к файлу класса
  <Device>.js    — класс устройства (или src/ + build)
  vrack2.json    — (у платформенного вендора) сервис-файл самого мастера
  docs/          — документация
```

## Как запускать и тестировать

- Мастер: `node ./run/index` (из корня репозитория)
- Управление через MCP (если доступен) — **3 универсальных тула** (каталог команд открывается во время выполнения):
  - `commands_list` — таблица всех команд платформы (+ `serviceCommandsList` — список субмастер-команд сервиса)
  - `command_info {name}` — карточка команды: параметры (name/type/required/example) и форма return
  - `command_execute {name, data}` — прямое выполнение любой команды; команды с параметром `service` маршрутизируются в воркер запущенного сервиса
  - субмастер-команды сервиса (журнал, экшены устройств, метрики, shares) — сначала `command_execute {name: "serviceCommandsList", data: {service}}` для полного каталога с карточками, затем их `command_execute`
  - команды: `serviceStart/Stop`, `serviceUpdateList` (список), `service` (статус), `serviceErrors/Clear`, `serviceLog/Set/Stats/Clear`, `serviceDeviceAction/Push/Shares/Metric`, `deviceProcess/Stop/Status`, `vendorList/Devices/DeviceInfo`, `apiKeyList/Add/Delete` — имена из `commands_list`
- Проверка устройства без мастера: `require('vrack2-core')` → `new core.DeviceManager(...)` → `dm.get('vendor.Device')` в чистом процессе (см. `src/boot/DeviceManager.ts` в core).

## Практические замечания

- `node_modules/vrack2-core` может быть **копией** локального core, а не npm-пакетом: симлинк ломает `ImportManager.importClass('vrack2-core.*')`, т.к. резолв идёт по реальному пути. После изменений в core: пересобрать (`npm run build` в core) и перескопировать в `node_modules/vrack2-core`.
- Изменения в уже запущенном мастере не подхватываются (require-кеш) — рестарт мастера обязателен.
- Входной порт и экшен — разные механизмы: порт пушится (`serviceDevicePush`), экшен вызывается с ответом (`serviceDeviceAction`). Смешивать в документации не надо.
- Данные устройства в `this.storage` — волатильные; персистентность — только через bootstrap-ресурс (БД) или явное файловое хранилище.
- Документация по платформе: `docs/` (Introduction, ServiceFile, Devices, Service, Errors, SystemEvents, Api).

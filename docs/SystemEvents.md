# Системные события

Все устройства в VRack2 создаются внутри `vrack2-core.Container`. Сам же класс `Container` является наследником стандартного класса `EventEmitter`.

Что бы устройства могли реагировать на системные события внутри контейнера, им доступна подписка на события контейнера и они сами могут вызывать события для других устройств.

К примеру, если устройство хочет знать, что какой то сервис был выключен, оно может подписаться на событие `ServiceManager.service.stop`. И каждый раз при остановке любого сервиса получать информацию о сервисе который был остановлен.


## Проброс события сервиса

Обрабатывать все события на самом верхнем уровне - не удобно. Например вам нужно следить за каким то сервисом и оперативно реагировать на действия которые происходят с ним. 

Ваш сервис может подписаться на события верхнего уровня, которые будут пробрасываться непосредственно в ваш сервис.

Для этого в мета-данных сервиса необходимо указать какие каналы вас интересуют:

```json
{
    "name": "Unimax Watch",
    "group": "watchers",
    "autoStart": true,
    "autoReload": true,
    "isolated": false,
    "description": "Отслеживание сервиса для работы с вентиляцией Unimax",
    "parentChannels": ["ServiceManager.service.update"]
}
```

После запуска вашего сервиса, `ServiceManager` подпишеться на переданные в списке `parentChannels` каналы, и будет пробрасывать получаемые данные внутрь вашего сервиса.

Что бы получать все события, которые были указанны в метаданных - необходимо подписаться на событие `Service.parent.event` внутри вашего сервиса.

Лучше это делать на этапе `process()`

```js
    process(){
        this.Container.addListener('Service.parent.event', (data)=>{
            console.log(data)
        })
    }
```

В переменной data будут данные по типу:

```js
{
  channel: 'ServiceManager.service.update',
  data: {
    service: {
      id: 'v2m-http',
      errors: 0,
      run: true,
      deleted: false,
      filePath: 'services/v2m-http.json',
      metaPath: 'services/v2m-http.meta.json',
      configPath: 'services/v2m-http.conf.json',
      processPath: 'services/v2m-http.process.json',
      autoReload: false,
      startedAt: 1778521683660
    }
  }
}
```

Для каждого события - набор данный может быть индивидуален. Пожалуйста учитывайте что набор событий на данный момент не стандартизирован, он может сильно дополниться в будущем. 

## Список доступных событий 


#### ServiceManager

- `ServiceManager.service.start` - Запуск сервиса
- `ServiceManager.service.stop` - Остановка сервиса
- `ServiceManager.service.convert` - Перегенерация файла сервиса
- `ServiceManager.service.update` - Любые обновления данных сервиса 
- `ServiceManager.service.error` - Ошибки сервиса 
- `ServiceManager.service.exit` - Завершение работы сервиса

#### Broadcaster

- `Broadcaster.channel.join` - Подписка клиента на канал 
- `Broadcaster.channel.leave` - Отписка клиента от канала

#### Guard

- `Guard.client.register` - Регистрация клиента VRack2 
- `Guard.client.unregister` - Дерегистрация клиента 
- `Guard.client.autorize` - Успешная авторизация клиента
- `Guard.client.command` - Выполнение команды клиента
- `Guard.client.command.error` - Ошибка при выполнении команды
- `Guard.client.command.success` - Успешный результат выполнения

#### KeyManager

- `KeyManager.key.add` - Добавление нового ключа
- `KeyManager.key.update` - Обновление ключа
- `KeyManager.key.delete` - Удаление ключа

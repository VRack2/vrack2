- [Требования](#требования)
- [Установка](#установка)
  - [Ubuntu/Linux/Mac](#ubuntulinuxmac)
  - [Настройка автозапуска (Ubuntu/Systemd)](#настройка-автозапуска-ubuntusystemd)

## Требования

* nodejs версии 18 и выше. Желательно использовать nodejs новой версии. Проверить можно командой `node --version`.
* npm для установки зависимостей
  
## Установка

### Ubuntu/Linux/Mac

Выбираем место для установки, например **/opt** (рассматривается по умолчанию)

```bash
cd /opt/
```

Клонируем репозиторий VRack-Service для запуска сервисов на основе VRack2-Core, в том числе и сам VRack2
```bash
git clone https://github.com/VRack2/vrack2-service.git
cd ./vrack2-service
```

Устанавливаем зависимости через npm (на данный момент одна vrack2-core): 

```bash
npm install --production
```

Создаем необходимые директории
```bash
mkdir -p ./devices ./storage ./structure ./services
```

Теперь нам надо добавить устройства сервиса VRack2:

```bash
cd ./devices
git clone https://github.com/VRack2/vrack2.git
```
Теперь надо установить зависимости для свервиса VRack2 (она всего одна - ws):

```bash
cd ./vrack2
npm install --production
```

Базовая установка завершена, вы уже можете запустить VRack2:

```bash
cd /opt/vrack2-service/
npm run start 
```

Итоговая структура директорий должна выглядеть так:

```
/opt/vrack2/
  devices/        # Директория вендоров и устройсв
    vrack2/       # Компоненты (устройства) сервиса vrack2
  run/            # Директория файла запуска сервиса VRack2-Service
  node_modules/   # Директория зависимостей после установки через npm install
  services/       # Директория для сервис файлов
  storage/        # Директория где храняться индивидуальные данные устройств
  structure/      # Директория для хранения структур контейнеров сервиса
```

Используя [VRack2-Manager](https://github.com/VRack2/vrack2-manager) можно подключится и работающему инстансу VRack2.

### Настройка автозапуска (Ubuntu/Systemd)

Для автозапуска в ubuntu есть файл службы. Скопируйте его:

```bash
cp /opt/vrack2-service/devices/vrack2/vrack2.service /etc/systemd/system/
```

Обновление демона служб:
```bash
systemctl daemon-reload
systemctl enable vrack2
systemctl start vrack2
```
Проверяем статус:

```bash
service vrack2 status
```

**Теперь стоит переходить к написанию своего [первого сервиса](./FirstService.md)**

- [Еще примеры учебных сервисов](https://github.com/VRack2/vrack2-example)
- [README VRack2](../README.md)
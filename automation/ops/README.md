# Otomasyon yedekleme ve geri yükleme

Bu klasördeki script'ler otomasyonun Cloudflare R2 üzerinde Restic ile şifreli yedeğini alır. Yedek kapsamı bilinçli
olarak sınırlıdır:

- PostgreSQL'in özel biçimli (`pg_dump --format=custom`) veritabanı dökümü
- `n8n_data` volume'ü
- `worker_data` volume'ü; geçici `workspaces` klasörü hariç
- yerel staging alanında da AES-256 ile şifrelenen `automation/.env`

`codex_auth` yedeğe girmez. Codex oturumu yeni sunucuda cihaz doğrulamasıyla yeniden açılmalıdır. Directus bu Compose
projesinin dışında olduğu için bu paket Directus veritabanını veya dosyalarını yedeklemez; Directus için ayrıca yedekleme
politikası gerekir.

## R2 ve Restic hazırlığı

1. Cloudflare R2'de herkese kapalı bir bucket oluşturun.
2. Yalnız bu bucket için Object Read & Write yetkili bir R2 API token üretin.
3. Sunucuya `restic`, `openssl` ve Docker Compose kurun.
4. [`backup.env.example`](./backup.env.example) içindeki değerleri `automation/.env` sonuna ekleyip gerçek sırlarla
   değiştirin. `BACKUP_DIR` repo dışında, yalnız yönetici hesabının okuyabildiği mutlak bir dizin olmalıdır.
   `BACKUP_PROJECT_ID` aynı projenin bütün kurtarma sunucularında değişmeyen kimliğidir.
5. `.env` gerçek bir dosya olmalı, sembolik bağlantı olmamalı, script'i çalıştıran kullanıcıya ait olmalı ve izni
   yalnız `0400` veya `0600` olmalıdır: `chmod 600 automation/.env`.

`RESTIC_PASSWORD` hem R2 repository'sinin hem yerel `.env` kopyasının şifreleme sırrıdır. Sunucunun tamamen kaybolması
durumunda yedeğe erişebilmek için bu parola ile R2 erişim anahtarlarının çevrimdışı bir kurtarma kopyasını saklayın.

Script'leri çalıştırılabilir yapıp repository'yi yalnız bir kez başlatın:

```bash
chmod 700 automation/ops/*.sh
cd automation
./ops/init-restic.sh
```

## Yedek alma ve doğrulama

PostgreSQL çalışırken (n8n ve codex-worker açık veya kapalı olabilir):

```bash
cd automation
./ops/backup.sh
```

Script n8n ile codex-worker'ın başlangıçtaki çalışma durumunu kaydeder, tutarlı bir kesit alabilmek için iki servisi
kontrollü biçimde durdurur ve PostgreSQL açıkken dump ile volume arşivlerini üretir. Yerel dump/arşiv/hash doğrulaması
biter bitmez başlangıçta çalışan servisleri yeniden başlatır; başlangıçta kapalı olanları kapalı bırakır. Daha sonraki R2
yüklemesi veya doğrulaması başarısız olsa bile trap aynı servis durumunu korur. `OPS_STOP_TIMEOUT_SECONDS` kontrollü
durdurma için tanınan süreyi belirler.

Başarılı sayılmadan önce script şunları denetler:

- `pg_restore --list` ile veritabanı dökümünün okunabilirliği
- iki `tar.gz` arşivinin bütünlüğü
- tüm dosyaların SHA-256 manifest'i
- şifreli `.env` dosyasının açılıp özgün SHA-256 değeriyle eşleşmesi
- yükleme sonrasında Restic repository kontrolü

Başarılı doğrulamanın sonunda worker volume'üne `/data/operations/last-backup.json` atomik olarak yazılır. Operasyon
denetimi bu kaydı kullanır; Restic komutu tamamlanmadan dosya güncellenmez.

Restic politikası aynı sunucu ve etikete ait snapshot'ları, değişen staging dizini adlarından bağımsız gruplandırıp 7
günlük, 5 haftalık ve 12 aylık snapshot'ı tutar. Yerel `BACKUP_DIR/staging`
altında yalnız son üç **doğrulanmış** staging kopyası kalır. Varsayılan `RESTIC_CHECK_SUBSET=100%`, başarılı status kaydı
yazılmadan önce bütün şifreli repository verisini okur. Repository büyüdükçe bu denetimin süresi ve R2 okuma miktarı da
artar; daha düşük bir değer seçmek end-to-end doğrulama güvencesini bilinçli olarak azaltır.

Günde bir kez çalıştırmak için örnek cron girdisi:

```cron
15 3 * * * cd /srv/directus-blog/automation && ./ops/backup.sh >> /var/log/content-ops-backup.log 2>&1
```

n8n veya worker kapandığında n8n workflow'u kendi arızasını bildiremeyeceği için host watchdog'unu da kurun. Ana
`.env` dosyasındaki `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALERT_CHAT_ID`, yazılabilir `WATCHDOG_STATE_DIR` ve backup ile aynı
`MAINTENANCE_MARKER_FILE` değerlerini doldurduktan sonra:

```cron
*/10 * * * * cd /srv/directus-blog/automation && ./ops/watchdog.sh >> /var/log/content-ops-watchdog.log 2>&1
```

Bu cron girdilerini root olmayan otomasyon kullanıcısıyla çalıştırıyorsanız `/var/log` dosyalarını önceden o kullanıcıya
ait oluşturun veya çıktıyı kullanıcının yazabildiği başka bir dizine yönlendirin; aksi durumda shell script başlamadan
log yönlendirmesinde durur.

Watchdog kendi atomik lock'u sayesinde cron çakışmalarını atlar. Backup n8n ve worker'ı bilerek durdurduğu sırada ortak
bakım işareti sağlık uyarılarını geçici olarak bastırır. İşaret bozuksa veya `WATCHDOG_MAINTENANCE_MAX_SECONDS` süresini
aşmışsa bastırma kalkar ve Telegram'a bakım işareti uyarısı gönderilir. Bot token'ı `curl` komut satırına yazılmaz;
`/proc/*/cmdline` içinde görünmemesi için standart girdiden curl yapılandırması olarak aktarılır.

Backup ve onaylı restore aynı `MAINTENANCE_LOCK_DIR` dizinini kullanır; böylece iki yıkıcı operasyon aynı anda çalışmaz.
Kuru restore prova sırasında lock almaz ve çalışan servislere dokunmaz. Servislerin başlangıç durumuna geri getirilemediği
bir backup veya tamamlanamayan onaylı restore, yeni operasyon başlamasın diye lock'u özellikle korur. Önce logları,
`MAINTENANCE_MARKER_FILE` içindeki işlem/PID/zaman bilgisini ve servislerin gerçekten güvenli durumda olduğunu kontrol
edin. İlgili PID'nin çalışmadığından ve başka backup/restore olmadığından kesinlikle emin olduktan sonra eski marker ile
lock dizini elle kaldırılabilir:

```bash
rm -f /var/backups/content-ops/maintenance.state
rmdir /var/backups/content-ops/.maintenance.lock
```

## Önce kuru prova, sonra geri yükleme

Varsayılan komut yalnız R2'den en son snapshot'ı indirir, bütün hash/dump/arşiv kontrollerini çalıştırır ve hiçbir üretim
verisini değiştirmez:

```bash
cd automation
./ops/restore.sh
./ops/restore.sh --snapshot SNAPSHOT_ID
```

Snapshot kimliği `latest` ya da Restic'in 8-64 karakterlik onaltılık kimliği olabilir. Seçimden sonra payload içindeki
`source_host`, `backup_tag` ve `project_id` tekrar doğrulanır; yalnız snapshot ID'sine güvenilmez.

Başka sunucudaki en son snapshot için kaynak hostname ile çapraz sunucu niyetini birlikte ve açıkça belirtin. Önce kuru
prova çalıştırın:

```bash
./ops/restore.sh --source-host ESKI_SUNUCU --allow-cross-host
./ops/restore.sh --source-host ESKI_SUNUCU --allow-cross-host --confirm
```

Belirli bir çapraz-sunucu snapshot'ında da aynı iki bayrak zorunludur:

```bash
./ops/restore.sh --snapshot SNAPSHOT_ID --source-host ESKI_SUNUCU --allow-cross-host
```

`BACKUP_PROJECT_ID` eşleşmesi çapraz sunucu modunda bile gevşetilmez. Bu nedenle felaket kurtarma sunucusunun `.env`
dosyasında üretimdeki sabit proje kimliğini önceden tanımlayın.

Gerçek geri yükleme için PostgreSQL açık kalmalıdır. `--confirm` n8n ile worker'ı kendisi kontrollü biçimde durdurur:

```bash
docker compose up -d postgres
./ops/restore.sh --confirm
# .env ve servis durumunu kontrol ettikten sonra:
docker compose up -d n8n codex-worker
```

`--confirm` verilmeden servis durumu değiştirilmez. Onaylı akış uzak snapshot'ı doğruladıktan sonra n8n ve worker'ı
durdurur; her yıkıcı adımdan hemen önce ikisinin de kararlı biçimde kapalı, PostgreSQL'in ise açık olduğunu yeniden
denetler. PostgreSQL'e bakım veritabanı olan `postgres` üzerinden bağlanıp hedef veritabanındaki oturumları sonlandırır,
hedef veritabanını tamamen düşürür, yeniden oluşturur ve custom dump'ı temiz veritabanına yükler. Ardından sırasıyla
`n8n_data`, `worker_data` ve `.env` geri yüklenir. `POSTGRES_DB` bu nedenle `postgres`, `template0` veya `template1`
olamaz. Script servisleri otomatik başlatmaz: herhangi bir aşama başarısız olursa n8n ile worker kapalı, ortak bakım
lock'u da operatör incelemesi için yerinde kalır. Hatayı giderip lock'un eski olduğundan emin olduktan sonra temizleyin ve
doğrulanmış snapshot'tan işlemi yeniden çalıştırın. Başarılı restore lock'u kaldırır; servisleri siz başlatana kadar host
watchdog normal servis-kapalı uyarısı verebilir.

Geri yüklenen `.env` yedeğin alındığı zamandaki değerleri içerir. PostgreSQL rol parolası yedekten sonra elle değiştiyse
custom dump rol parolalarını taşımadığı için, servisleri başlatmadan önce `POSTGRES_PASSWORD` ile mevcut rol parolasının
eşleştiğini ayrıca doğrulayın. Restic ve R2 kurtarma sırlarını yeni `.env` ile değiştirmeden önce çevrimdışı kopyanızla
karşılaştırın.

# Telegram → Codex → Directus içerik otomasyonu

Bu otomasyon, telefondan Telegram'a gönderilen içerik talebini sunucudaki Codex CLI ile işler ve sonucu Directus'a
**taslak** olarak kaydeder. Yayınlama, iptal, tekrar, fikir seçimi ve editoryal hafıza değişiklikleri yalnız açık Telegram
komutlarıyla yapılır.

Bu dizin Next.js uygulamasından bağımsız ve varsayılan olarak kapalı bir companion'dır. Her fork kendi içerik davranışını
`worker/templates/profile.json` ile yanındaki prompt/schema dosyalarında tanımlar. Profil; yayın kimliği, dil, kalite
eşikleri, etiket taksonomisi, Directus koleksiyon/alan eşlemesi ve public/preview yollarını taşır. Varsayılan `article`
pipeline yalnız başlangıç örneğidir; farklı kaynak toplama veya kanıt sentezi gereken projeler kendi pipeline ve
connector'larını eklemelidir.

```text
Telegram → n8n → codex-worker → Codex CLI → doğrulama → Directus draft
                ↑                                      ↓
                └──────── Telegram önizleme linki ─────┘
```

## Güvenlik modeli

- `codex-worker` yalnız `127.0.0.1:8787` üzerinde host'a bağlanır; dış ağdan erişilemez. n8n ayrıca Docker ağı içinden
  erişir. Localhost portu bağımsız sağlık watchdog'u içindir.
- Telegram kullanıcı kimliği hem n8n'de hem worker'da doğrulanır.
- Kullanıcı metni shell komutuna çevrilmez. Codex, argüman dizisiyle ve `shell: false` kullanılarak başlatılır.
- Container başlangıcındaki root-owned entrypoint uygulama sırlarını `0400` izinli geçici dosyalara taşır. Worker bu
  dosyaları yalnız başlangıçta okuyup yapılandırmayı yükledikten sonra kalıcı olarak `1000:1000` kullanıcısına düşer;
  Codex alt süreçleri Directus, worker, önizleme veya callback token'larını ne environment'tan ne de bu dosyalardan
  okuyabilir.
- n8n Code node'larının process environment erişimi kapalıdır. Worker ve callback sırları n8n Variables'a değil,
  n8n'in şifreli credential deposuna yazılır.
- Codex yalnızca işe özel klasörde `read-only` sandbox'ıyla çalışır; gerekli girdilerin tamamı stdin üzerinden verilir.
- Editorial görev gerekli tüm girdiyi stdin üzerinden alır ve shell komutu gerektirmez. Container'ın varsayılan
  seccomp/AppArmor profilleri, read-only root filesystem, kapalı Linux capability'leri ve `no-new-privileges` koruması
  birlikte kalır.
- Directus token'ı yalnız profilde seçilen koleksiyonu okuma/oluşturma/güncelleme ve gerekiyorsa SEO ilişkisi oluşturma yetkisine sahip
  olmalıdır. `/edit` yalnız gerçek bir `draft` kaydının içeriğini günceller; `status=published` ve `published_at`
  değişiklikleri yalnız sahibin açık `/yayinla` komutundan sonra yapılır.
- İşler diskte kalıcı bir kuyrukta tutulur ve tek tek çalıştırılır.

Önizleme bağlantısında mevcut `DRAFT_PREVIEW_SECRET` yer alır. Bağlantıyı parola gibi koruyun. İleride süreli, imzalı
bağlantıya geçmek daha güvenlidir.

## Sunucu kurulumu

Sunucuda Docker Engine ve Compose eklentisi kurulu olmalıdır. Repo içinde:

```bash
cd automation
cp .env.example .env
chmod 600 .env
```

`.env` içindeki tüm `replace-with-...` değerlerini değiştirin. Güçlü anahtar üretmek için örneğin `openssl rand -hex 32`
kullanılabilir. `TELEGRAM_ALLOWED_USER_ID`, kullanıcı adı değil Telegram'ın sayısal kullanıcı kimliğidir.

Ardından imajları oluşturup servisleri başlatın:

```bash
docker compose build codex-worker
docker compose up -d postgres n8n codex-worker
docker compose ps
```

### Codex CLI oturumu

Codex API anahtarı kullanmaz; mevcut Codex hesabıyla cihaz doğrulaması yapar. Bir defa şu komutu çalıştırın:

```bash
docker compose run --rm codex-worker codex login --device-auth
```

Terminalde verilen adresi telefonda veya bilgisayarda açıp kodu onaylayın. Kimlik bilgisi `codex_auth` volume'ünde
saklanır. Bu volume'ü ve içindeki `auth.json` dosyasını parola gibi koruyun.

Oturumu kontrol etmek için:

```bash
docker compose run --rm codex-worker codex login status
```

## HTTPS ve n8n

n8n yalnızca `127.0.0.1:5678` üzerinde dinler. Mevcut Caddy veya Nginx ters proxy'niz `https://automation.example.com`
adresini buraya yönlendirmelidir. Telegram webhook'u için geçerli HTTPS gerekir.

Proxy adresiyle `.env` içindeki şu değerler aynı olmalıdır:

```dotenv
N8N_HOST=automation.example.com
N8N_PROTOCOL=https
N8N_WEBHOOK_URL=https://automation.example.com/
```

İlk girişte n8n sahibini oluşturun. Sonra `automation/n8n` altındaki üç JSON dosyasını **Import from File** ile içe
aktarın:

1. `telegram-submit.json`
2. `worker-result.json`
3. `operations-watchdog.json`

Telegram kullanıcı ve sohbet yetkilendirmesi worker'da `.env` içindeki `TELEGRAM_ALLOWED_USER_ID` ile
`TELEGRAM_ALLOWED_CHAT_ID` üzerinden fail-closed yapılır. n8n Community sürümünde ücretli olan Variables özelliği
gerekmez. Code node'ları yalnız mesajı normalize eder; gerçek kimlik kararı sırları ve yapılandırmayı taşıyan worker'dadır.

Ardından **Credentials** bölümünde iki adet **Header Auth** credential oluşturun:

| Credential adı | Header adı | Header değeri |
| --- | --- | --- |
| `Content Ops — Worker API Bearer` | `Authorization` | `Bearer <WORKER_API_TOKEN>` |
| `Content Ops — Callback Bearer` | `Authorization` | `Bearer <N8N_CALLBACK_TOKEN>` |

`WORKER_API_TOKEN` ve `N8N_CALLBACK_TOKEN` yerine `.env` dosyanızdaki gerçek değerleri yazın; `Bearer` ile token arasında
tek boşluk bırakın. Sonra `Content Ops — Telegram İçerik Talebi` workflow'undaki `Codex Worker'a Gönder` node'una Worker API
credential'ını, `Content Ops — Codex Sonucu` workflow'undaki `Codex Result Webhook` node'una Callback credential'ını seçin.
`Content Ops — Operasyon Uyarıları` workflow'undaki `Operasyonları Kontrol Et` ve `Uyarıyı Onayla` node'larına da aynı
Worker API credential'ını atayın. İçe aktarılan JSON credential adını taşısa da her sunucuda gerçek credential'ı
arayüzden bir kez seçip kaydetmek gerekir.

Workflow'lardaki Telegram düğümlerine aynı Telegram Bot credential'ını seçin. Credential içinde BotFather'dan aldığınız
bot token'ı bulunur. `N8N_BLOCK_ENV_ACCESS_IN_NODE=true` olduğu için Code node'ları container environment değerlerini
okuyamaz; bu kasıtlı bir güvenlik sınırıdır. Önce sonuç ve operasyon workflow'larını, son olarak Telegram talep
workflow'unu yayımlayın.

### BotFather komut menüsü

BotFather'da `/setcommands` seçip aşağıdaki listeyi yapıştırın. Bu liste yalnız Telegram menüsünü oluşturur; yetki
kontrolü yine worker'da yapılır.

```text
yazi - Belirttiğiniz konuda yeni bir yazı taslağı hazırlar.
fikir - Güncel kaynaklarla yazı fikirleri araştırır.
sec - Araştırmadaki bir fikri yazı işine dönüştürür.
durum - Bir işin güncel durumunu gösterir.
sonisler - Son işlerin kısa durum listesini gösterir.
edit - Bir taslağı verdiğiniz talimatla düzenler.
yayinla - Onayladığınız taslağı yayımlar.
tekrar - Başarısız veya iptal edilmiş bir işi yeniden dener.
iptal - Uygun aşamadaki bir işi güvenle iptal eder.
metrik - İşlerin model, süre ve token ölçümlerini gösterir.
hafiza - Onay bekleyen önerileri ve etkin kuralları gösterir.
hafiza_duzenle - Onay bekleyen bir hafıza önerisini düzenler.
hafiza_onayla - Bir hafıza önerisini etkinleştirir.
hafiza_reddet - Bir hafıza önerisini reddeder.
hafiza_kaldir - Etkin bir hafıza kuralını kaldırır.
yardim - Komutları ve kısa kullanım açıklamalarını gösterir.
start - Botu tanıtır ve komut yardımını gösterir.
```

## İlk deneme

Bota şu tarz bir mesaj gönderin:

```text
Yapay zekâ ajanlarında doğrulama döngülerini sıcak ve öğretici bir dille,
teorisi ve gerçek hayattan uygulamalarıyla derinlemesine anlatan bir yazı hazırla.
```

Önce güncel konu seçenekleri araştırmak için `/fikir` komutunu kullanın:

```text
/fikir yapay zekâ ajanları ve doğrulama sistemleri
```

Bu yol canlı web araştırmasını ve `xhigh` reasoning seviyesini kullanır, beş ila yedi seçenek döndürür ve Directus
taslağı oluşturmaz. Bir seçeneği araştırma iş numarasıyla başlatın:

```text
/sec 00000000-0000-4000-8000-000000000000 2
```

Worker yalnız seçilen seçeneğin, araştırma özetinin ve kaynakların sabitlenmiş kopyasını yeni yazı işine taşır; diğer
seçenekler yazı prompt'una girmez.

Taslağı önizleyip onayladıktan sonra Telegram'daki iş numarasıyla yayınlayın:

```text
/yayinla 00000000-0000-4000-8000-000000000000
```

Worker yalnızca aynı Telegram kullanıcısına ait, başarıyla tamamlanmış bir yazı işinin Directus kaydını yayınlar. Aynı
komutun tekrar gönderilmesi yeni kayıt oluşturmaz veya yayın tarihini değiştirmez.

Taslakta içerik veya ton revizyonu istemek için:

```text
/edit 00000000-0000-4000-8000-000000000000 Girişi daha güçlü yap ve teknik bölümlerde daha sıcak bir öğretmen tonu kullan.
```

Codex mevcut Directus taslağının tamamını revize eder ve aynı kaydı günceller; yeni bir post oluşturmaz. Revizyonlar
yalnızca aynı Telegram kullanıcısına ait yayımlanmamış taslaklarda çalışır. Sonuç yeni iş numarasıyla gelir; bu numara
üzerinden tekrar `/edit` veya `/yayinla` kullanılabilir.

Bir işin kuyruk sırasını, geçen süresini ve güncel çalışma aşamasını görmek için:

```text
/durum 00000000-0000-4000-8000-000000000000
```

Durum sorgusu kuyruğa yeni iş eklemez ve Codex çalıştırmaz; sonucu anında worker'daki kalıcı iş kaydından okur. Yalnızca
aynı Telegram kullanıcısı ve sohbetine ait işler görüntülenebilir. Uzun süren işlerde bot; editoryal bağlamın alınması,
Codex üretimi, doğrulanan taslağın Directus'a kaydedilmesi ve yayınlama gibi son anlamlı aşamayı gösterir.

Diğer iş komutları:

```text
/sonisler
/iptal <iş-no>
/tekrar <iş-no>
/metrik
/metrik <iş-no>
```

Kuyruktaki iş hemen iptal edilir. Çalışan Codex süreci önce `SIGTERM`, gerekirse `SIGKILL` ile durdurulur. Directus'a
taslak kaydetme veya yayınlama başladıktan sonra iptal ve otomatik tekrar reddedilir; önce dış sistem durumu elle
kontrol edilmelidir.

Önce sıraya alındı mesajı gelir. İş tamamlandığında bot başlık, kelime sayısından hesaplanan okuma süresi, kontrol
notları ve taslak önizleme bağlantısını yollar. Yazı Directus'ta `draft` durumunda kalır.

## Onaylı editoryal hafıza ve bağımsız kalite kapısı

`worker/templates/EDITORIAL_MEMORY.md`, değişmeyen temel kuralları taşır. Telegram'da onaylanan dinamik kurallar
`worker_data` içindeki `/data/editorial/state.json` ledger'ında atomik ve `0600` izinli tutulur. Yakın
tarihli Directus yazıları yalnız tekrar önleme verisidir; hafıza veya talimat sayılmaz. Her iş kaydında kullanılan
hafızanın kısa sürüm kimliği saklanır.

Başarılı bir yayından sonra izole `learning` rolü; açık `/edit` talimatlarını, kalite sorunlarını, son sürümü ve mevcut
hafızayı inceler. En fazla bir öneri oluşturabilir; öneri kendiliğinden etkinleşmez:

```text
/hafiza
/hafiza_duzenle hm_0123456789ab <yeni-kural>
/hafiza_onayla hm_0123456789ab
/hafiza_reddet hm_0123456789ab
/hafiza_kaldir hr_0123456789ab
```

Yalnız `/hafiza_onayla` ve `/hafiza_kaldir` etkin hafıza hash'ini değiştirir. Çalışan işler başlangıçta aldıkları
hafıza snapshot'ıyla tamamlanır. Ledger bozulursa sağlık kontrolü başarısız olur ve yeni içerik üretimi fail-closed
durur; dosya sessizce sıfırlanmaz.

Kalite kapısı kontrollü rollout için varsayılan olarak kapalıdır. En güvenli başlangıç, model rollerini boş bırakarak
giriş yapılmış Codex hesabının desteklediği varsayılanı kullanmaktır. `automation/.env` içine örneğin şunları ekleyin:

```dotenv
CODEX_QUALITY_REVIEW_ENABLED=true
CODEX_DRAFT_MODEL=
CODEX_IDEA_MODEL=
CODEX_IDEA_REASONING_EFFORT=xhigh
CODEX_REVIEW_MODEL=
CODEX_REVIEW_REASONING_EFFORT=medium
CODEX_REVISION_MODEL=
CODEX_REVISION_REASONING_EFFORT=medium
CODEX_LEARNING_MODEL=
CODEX_LEARNING_REASONING_EFFORT=medium
CODEX_REVIEW_TIMEOUT_MS=120000
CODEX_REVISION_TIMEOUT_MS=360000
CODEX_LEARNING_TIMEOUT_MS=120000
```

Boş bırakılan roller, giriş yapılmış Codex hesabının desteklediği varsayılan modeli kullanır. Bu, hesap veya CLI sürümü için
henüz açılmamış bir model adının bütün içerik akışını durdurmasını engeller. Bir rolü açıkça sabitlemek isterseniz yalnızca
o hesabın Codex model seçicisinde görünen bir model adını kullanın ve önce gerçek görevlerden oluşan küçük bir eval setinde
deneyin. Model boş olsa bile kalite denetçisi ayrı talimatlar, ayrı süreç ve izole ortamla çalışmaya devam eder.

Kalite akışı şöyledir:

```text
yazıcı → deterministik doğrulama → bağımsız editör
                                      ├─ pass   → Directus taslağı
                                      ├─ revise → tek otomatik düzeltme → yeniden denetim → pass → Directus
                                      └─ reject / ikinci başarısızlık / timeout → iş başarısız, Directus'a yazma yok
```

Reviewer web araması yapmaz, salt-okunur sandbox'ta çalışır ve Directus, önizleme, worker ya da callback anahtarlarını
görmez. Tam denetim raporları işe ait `workspace` içinde kalır; Telegram ve genel iş sonucuna yalnız sınırlı geçiş özeti
yazılır.

## Operasyon

Durumu ve logları görmek için:

```bash
docker compose ps
docker compose logs --tail=200 codex-worker
docker compose logs --tail=200 n8n
```

Worker sağlık kontrolü sunucunun localhost arayüzünden veya Docker ağı içinden test edilebilir:

```bash
curl --fail http://127.0.0.1:8787/health
```

İş kayıtları `worker_data` volume'ünde, Codex olay günlükleri ise işe özel workspace klasöründe tutulur. Aynı Telegram
mesajı tekrar işlenirse `tg:<chat>:<message>` idempotency anahtarı sayesinde ikinci taslak açılmaz.

Terminal workspace'leri varsayılan 14 gün, başarısız/iptal ve fikir iş kayıtları 90 gün, yayımlanmış zincirler 365 gün
tutulur. İş bağları ile aynı Directus post kimliği tek bir revizyon bileşeni sayılır: canlı veya yayımlanmamış bir bileşenin
hiçbir kaydı silinmez; yayımlanmış bileşenin başarısız revizyonları dahil bütün iş kayıtları 365 günlük süreyi birlikte
izler. Onay bekleyen hafıza önerilerinin kaynak bileşenleri de korunur. İş kaydı kalmamış UUID biçimli workspace'ler
14 günü geçtiğinde temizlenir; elle oluşturulmuş başka dizinlere dokunulmaz. Bekleyen hafıza önerileri 30 günde sona
erer; reddedilmiş/süresi dolmuş önerilerin metin gövdeleri 90 gün sonra temizlenirken audit kaydı korunur.

Disk kullanımı (%80/%90), 36 saati geçen yedek, saatlik iş/öğrenme hata eşikleri ve bozuk hafıza
`operations-watchdog.json` tarafından 10 dakikada bir denetlenir. Worker her bildirimi iki dakikalık teslim lease'iyle
verir; n8n ancak Telegram gönderimi başarılı olduktan sonra bildirimi ACK eder. ACK alınmazsa lease dolunca bildirim
yeniden sunulur, ACK alınmış aynı durum altı saat boyunca tekrarlanmaz ve koşul düzeldiğinde ayrıca düzelme mesajı
gönderilir. n8n'in kendisi kapalıyken de haber alabilmek için `.env` içinde `TELEGRAM_BOT_TOKEN` ile
`TELEGRAM_ALERT_CHAT_ID` değerlerini doldurup host watchdog'unu cron'a ekleyin:

```cron
*/10 * * * * cd /srv/directus-blog/automation && ./ops/watchdog.sh >> /var/log/content-ops-watchdog.log 2>&1
```

Cron'u root olmayan otomasyon kullanıcısıyla çalıştırıyorsanız `/var/log` dosyalarını önceden o kullanıcıya ait
oluşturun veya çıktıyı kullanıcının yazabildiği başka bir dizine yönlendirin.

## Directus yetkileri

Otomasyon için ayrı bir Directus service account önerilir. Minimum kapsam:

- Profildeki içerik koleksiyonu (varsayılan `posts`): `read`, `create`, `update` (`update`, gerçek `draft` içeriğini `/edit` ile düzenlemek ve açık
  `/yayinla <iş-no>` komutunda yayın alanlarını değiştirmek için kullanılır)
- Directus `update` item filtresi mevcut kaydın `status` alanını `draft` olmaya zorlamalıdır. Bu sunucu tarafı politika,
  worker'ın kontrol isteği ile güncelleme isteği arasındaki anda başka bir yönetici kaydı yayımlarsa ikinci isteği
  reddeden asıl eşzamanlılık sınırıdır.
- SEO alanı ayrı bir koleksiyon/ilişki ise yalnızca oluşturmak için gereken minimum izin
- `status` alanında yalnız `draft` ve `published`; diğer durumlara izin vermeyen rol politikası

Token'ı site yönetici token'ıyla paylaşmayın. Worker üretim/düzenleme akışında yalnız `draft` yazar; `published` ve
`published_at` değişikliği yalnız sahipli, tamamlanmış taslağa verilen açık `/yayinla` işi içinde yapılır.

## Güncelleme ve R2 yedekleme

Cloudflare R2 üzerinde Restic kurulumu, günlük yedek, doğrulama ve varsayılan dry-run geri yükleme akışı
[`ops/README.md`](./ops/README.md) içinde anlatılır. Paket PostgreSQL custom dump'ını, `n8n_data`, kalıcı `worker_data`
ve şifreli `.env` dosyasını kapsar; geçici workspaces ile `codex_auth` hariçtir. Backup ve onaylı restore ortak bakım
lock'u kullanır; host watchdog planlı servis duruşunu yalnız süreli ve geçerli bakım işareti varken bastırır. Çapraz
sunucu kurtarma açık `--source-host` ile `--allow-cross-host` onayı ve değişmeyen `BACKUP_PROJECT_ID` eşleşmesi ister.
Directus bu Compose dışında olduğu için ayrı yedeklenmelidir. Örnek yapılandırma doğrulanan `N8N_VERSION=2.30.8` ve
`CODEX_VERSION=0.144.6` sürümlerini sabitler; sürüm yükseltmelerini önce test edip `.env` içinde bilinçli olarak yapın.

```bash
docker compose pull postgres n8n
docker compose build --pull codex-worker
docker compose up -d
```

Telegram workflow JSON'u değiştiğinde güncel dosyayı n8n container'ına kopyalayıp içe aktarın:

```bash
docker compose cp n8n/telegram-submit.json n8n:/tmp/telegram-submit.json
docker compose exec n8n n8n import:workflow --input=/tmp/telegram-submit.json
docker compose cp n8n/worker-result.json n8n:/tmp/worker-result.json
docker compose exec n8n n8n import:workflow --input=/tmp/worker-result.json
docker compose cp n8n/operations-watchdog.json n8n:/tmp/operations-watchdog.json
docker compose exec n8n n8n import:workflow --input=/tmp/operations-watchdog.json
```

Ardından n8n arayüzünde üç workflow'un Telegram credential'larını ve ilgili Header Auth credential atamalarını kontrol
edip güncel sürümleri yeniden yayımlayın.

## Bilinen MVP sınırları

- Callback geçici olarak başarısız olursa worker bildirimi kalıcı outbox'ta tutar ve artan aralıklarla yeniden dener.
  At-least-once teslim nedeniyle aynı callback yeniden gelebilir; sonuç workflow'u başarılı Telegram gönderiminden sonra
  iş kimliği ve durumuyla tekrarı engeller.
- Directus yayını tamamlandıktan hemen sonra worker kapanırsa CMS kaydı yayımlanmış, yerel iş ise belirsiz dış yazma
  hatası olarak görünebilir. Worker bu aşamayı otomatik tekrar etmez; Telegram mesajındaki yönlendirmeyle Directus durumu
  kontrol edilmelidir. Bu fail-closed davranış yanlışlıkla ikinci dış yazma yapmaktan kaçınır.
- Revizyonlar aynı Directus taslağını günceller fakat aynı Codex thread'ini sürdürmez.
- Kuyruk tek worker ve düşük kişisel trafik için tasarlanmıştır.
- Normal yazı üretiminde canlı web araştırması varsayılan olarak kapalıdır. `/fikir` akışı güncel seçenek üretebilmek için
  canlı aramayı ve `CODEX_IDEA_REASONING_EFFORT=xhigh` ayarını her zaman kullanır; kaynak denetimi yine taslak
  incelemesinin parçasıdır.

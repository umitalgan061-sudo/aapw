/**
 * Authored playable settlement episode content.
 *
 * This module is content-only. It references the existing SettlementCampaign
 * quest-chain definitions and delegates every state mutation to the existing
 * runtime/owner handlers. It does not create a second quest, inventory,
 * economy, crafting, travel or persistence framework.
 */
import {
  getSettlementQuestChain,
  getSettlementQuestChainStep,
  getSettlementQuestChainReward,
  listSettlementQuestChains,
} from './settlementCampaignQuestChains.js';
import {
  getSettlementService,
  getSettlementQuestObjective,
  getSettlementDialogueCondition,
  getSettlementRecipe,
  getSettlementRoute,
  getSettlementItem,
} from './settlementCampaignContent.js';

export const SETTLEMENT_EPISODE_CONTENT_VERSION = 1;
export const SETTLEMENT_EPISODE_LIMITS = Object.freeze({
  episodes: 6,
  beatsPerEpisode: 8,
  hintsPerBeat: 3,
  tagsPerBeat: 6,
  text: 180,
  maxHistory: 96,
});

const BEAT_LIBRARY = Object.freeze({
  iron_and_oath: Object.freeze([
    Object.freeze({
      stepId: 'iron-01',
      title: "Demirhaneye giriş",
      service: 'blacksmith',
      action: 'talk',
      prompt: "Ustaya yaklaş ve yerleşimin demir stoklarının neden tükendiğini öğren.",
      tags: Object.freeze(['settlement', 'iron_and_oath', 'talk', 'blacksmith']),
      hints: Object.freeze([
        'Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.',
        'Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.',
        'Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.',
      ]),
      ux: Object.freeze({
        successTone: 'positive',
        blockedTone: 'warning',
        failureTone: 'danger',
        showObjective: true,
        showService: true,
        showHistory: true,
      }),
    }),
    Object.freeze({
      stepId: 'iron-02',
      title: "Ustanın güveni",
      service: 'blacksmith',
      action: 'talk',
      prompt: "Ustanın güvenini kazanacak kadar itibar göster ve sonraki teslimi aç.",
      tags: Object.freeze(['settlement', 'iron_and_oath', 'talk', 'blacksmith']),
      hints: Object.freeze([
        'Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.',
        'Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.',
        'Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.',
      ]),
      ux: Object.freeze({
        successTone: 'positive',
        blockedTone: 'warning',
        failureTone: 'danger',
        showObjective: true,
        showService: true,
        showHistory: true,
      }),
    }),
    Object.freeze({
      stepId: 'iron-03',
      title: "Cevher toplama",
      service: 'blacksmith',
      action: 'collect',
      prompt: "Dört demir cevherini hazırla; sonraki ocak işlemi ancak gerçek envanter hazır olduğunda kullanılabilir.",
      tags: Object.freeze(['settlement', 'iron_and_oath', 'collect', 'blacksmith']),
      hints: Object.freeze([
        'Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.',
        'Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.',
        'Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.',
      ]),
      ux: Object.freeze({
        successTone: 'positive',
        blockedTone: 'warning',
        failureTone: 'danger',
        showObjective: true,
        showService: true,
        showHistory: true,
      }),
    }),
    Object.freeze({
      stepId: 'iron-04',
      title: "Kömür stoğu",
      service: 'blacksmith',
      action: 'collect',
      prompt: "İki kömürü tamamla ve ocağın üretim için hazır olduğunu doğrula.",
      tags: Object.freeze(['settlement', 'iron_and_oath', 'collect', 'blacksmith']),
      hints: Object.freeze([
        'Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.',
        'Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.',
        'Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.',
      ]),
      ux: Object.freeze({
        successTone: 'positive',
        blockedTone: 'warning',
        failureTone: 'danger',
        showObjective: true,
        showService: true,
        showHistory: true,
      }),
    }),
    Object.freeze({
      stepId: 'iron-05',
      title: "Kılıcı döv",
      service: 'blacksmith',
      action: 'craft',
      prompt: "Mevcut blacksmith tarifini kullanarak demir kılıcı üret.",
      tags: Object.freeze(['settlement', 'iron_and_oath', 'craft', 'blacksmith']),
      hints: Object.freeze([
        'Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.',
        'Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.',
        'Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.',
      ]),
      ux: Object.freeze({
        successTone: 'positive',
        blockedTone: 'warning',
        failureTone: 'danger',
        showObjective: true,
        showService: true,
        showHistory: true,
      }),
    }),
    Object.freeze({
      stepId: 'iron-06',
      title: "Kılıcı kuşan",
      service: 'blacksmith',
      action: 'equip',
      prompt: "Üretilen kılıcı mevcut equipment otoritesine ver ve kuşanma sonucunu göster.",
      tags: Object.freeze(['settlement', 'iron_and_oath', 'equip', 'blacksmith']),
      hints: Object.freeze([
        'Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.',
        'Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.',
        'Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.',
      ]),
      ux: Object.freeze({
        successTone: 'positive',
        blockedTone: 'warning',
        failureTone: 'danger',
        showObjective: true,
        showService: true,
        showHistory: true,
      }),
    }),
    Object.freeze({
      stepId: 'iron-07',
      title: "Ocağın başında dinlen",
      service: 'blacksmith',
      action: 'rest',
      prompt: "Üretim sonrası yorgunluğu mevcut dinlenme mekanizmasıyla toparla.",
      tags: Object.freeze(['settlement', 'iron_and_oath', 'rest', 'blacksmith']),
      hints: Object.freeze([
        'Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.',
        'Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.',
        'Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.',
      ]),
      ux: Object.freeze({
        successTone: 'positive',
        blockedTone: 'warning',
        failureTone: 'danger',
        showObjective: true,
        showService: true,
        showHistory: true,
      }),
    }),
    Object.freeze({
      stepId: 'iron-08',
      title: "Yemin",
      service: 'blacksmith',
      action: 'talk',
      prompt: "Ustaya dön, tamamlanan adımları konuştur ve zincirin ödülünü hazırla.",
      tags: Object.freeze(['settlement', 'iron_and_oath', 'talk', 'blacksmith']),
      hints: Object.freeze([
        'Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.',
        'Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.',
        'Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.',
      ]),
      ux: Object.freeze({
        successTone: 'positive',
        blockedTone: 'warning',
        failureTone: 'danger',
        showObjective: true,
        showService: true,
        showHistory: true,
      }),
    }),
  ]),
  market_routes: Object.freeze([
    Object.freeze({ stepId:'market-01', title:'Pazarın hesabı', service:'market', action:'talk', prompt:'Pazar görevlisinden mevcut fiyatları ve kervan açığını öğren.', tags:Object.freeze(['settlement','market_routes','talk','market']), hints:Object.freeze(['Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.','Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.','Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.']), ux:Object.freeze({successTone:'positive',blockedTone:'warning',failureTone:'danger',showObjective:true,showService:true,showHistory:true}) }),
    Object.freeze({ stepId:'market-02', title:'Erzak al', service:'market', action:'buy', prompt:'Üç ekmek satın al ve stok maliyetini gerçek ekonomi otoritesinden geçir.', tags:Object.freeze(['settlement','market_routes','buy','market']), hints:Object.freeze(['Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.','Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.','Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.']), ux:Object.freeze({successTone:'positive',blockedTone:'warning',failureTone:'danger',showObjective:true,showService:true,showHistory:true}) }),
    Object.freeze({ stepId:'market-03', title:'Cevheri sat', service:'market', action:'sell', prompt:'İki demir cevherini gerçek vendor fiyatıyla sat ve satış kaydını koru.', tags:Object.freeze(['settlement','market_routes','sell','market']), hints:Object.freeze(['Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.','Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.','Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.']), ux:Object.freeze({successTone:'positive',blockedTone:'warning',failureTone:'danger',showObjective:true,showService:true,showHistory:true}) }),
    Object.freeze({ stepId:'market-04', title:'Azık değişimi', service:'market', action:'trade', prompt:'İki yol azığını mevcut trade quote üzerinden edin.', tags:Object.freeze(['settlement','market_routes','trade','market']), hints:Object.freeze(['Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.','Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.','Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.']), ux:Object.freeze({successTone:'positive',blockedTone:'warning',failureTone:'danger',showObjective:true,showService:true,showHistory:true}) }),
    Object.freeze({ stepId:'market-05', title:'Kervan bağlantısı', service:'market', action:'talk', prompt:'Pazar görevlisinin güvenini bir sonraki yol adımına taşı.', tags:Object.freeze(['settlement','market_routes','talk','market']), hints:Object.freeze(['Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.','Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.','Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.']), ux:Object.freeze({successTone:'positive',blockedTone:'warning',failureTone:'danger',showObjective:true,showService:true,showHistory:true}) }),
    Object.freeze({ stepId:'market-06', title:'Nehir pazarına git', service:'gate', action:'travel', prompt:'river_market rotasını gerçek seyahat maliyetiyle başlat.', tags:Object.freeze(['settlement','market_routes','travel','gate']), hints:Object.freeze(['Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.','Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.','Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.']), ux:Object.freeze({successTone:'positive',blockedTone:'warning',failureTone:'danger',showObjective:true,showService:true,showHistory:true}) }),
    Object.freeze({ stepId:'market-07', title:'Deri fazlasını sat', service:'market', action:'sell', prompt:'İki deriyi sat ve kervan hesabının son açığını kapat.', tags:Object.freeze(['settlement','market_routes','sell','market']), hints:Object.freeze(['Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.','Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.','Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.']), ux:Object.freeze({successTone:'positive',blockedTone:'warning',failureTone:'danger',showObjective:true,showService:true,showHistory:true}) }),
    Object.freeze({ stepId:'market-08', title:'Pazar zinciri sonu', service:'market', action:'talk', prompt:'Kervan bağlantısını onaylat ve bölüm ödülünü hazırla.', tags:Object.freeze(['settlement','market_routes','talk','market']), hints:Object.freeze(['Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.','Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.','Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.']), ux:Object.freeze({successTone:'positive',blockedTone:'warning',failureTone:'danger',showObjective:true,showService:true,showHistory:true}) }),
  ]),
  road_watch: Object.freeze([
    Object.freeze({ stepId:'watch-01', title:'Nöbet emri', service:'barracks', action:'talk', prompt:'Kışla kumandanından yol güvenliği emrini al.', tags:Object.freeze(['settlement','road_watch','talk','barracks']), hints:Object.freeze(['Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.','Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.','Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.']), ux:Object.freeze({successTone:'positive',blockedTone:'warning',failureTone:'danger',showObjective:true,showService:true,showHistory:true}) }),
    Object.freeze({ stepId:'watch-02', title:'Nöbet talimi', service:'barracks', action:'train', prompt:'Mevcut training handler ile kısa savunma talimini tamamla.', tags:Object.freeze(['settlement','road_watch','train','barracks']), hints:Object.freeze(['Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.','Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.','Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.']), ux:Object.freeze({successTone:'positive',blockedTone:'warning',failureTone:'danger',showObjective:true,showService:true,showHistory:true}) }),
    Object.freeze({ stepId:'watch-03', title:'Nöbet ekipmanı', service:'barracks', action:'equip', prompt:'Demir kılıcı mevcut equipment otoritesine bağla.', tags:Object.freeze(['settlement','road_watch','equip','barracks']), hints:Object.freeze(['Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.','Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.','Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.']), ux:Object.freeze({successTone:'positive',blockedTone:'warning',failureTone:'danger',showObjective:true,showService:true,showHistory:true}) }),
    Object.freeze({ stepId:'watch-04', title:'Kapı emri', service:'barracks', action:'talk', prompt:'Kuzey kapısı emrini NPC diyaloğu üzerinden teyit et.', tags:Object.freeze(['settlement','road_watch','talk','barracks']), hints:Object.freeze(['Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.','Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.','Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.']), ux:Object.freeze({successTone:'positive',blockedTone:'warning',failureTone:'danger',showObjective:true,showService:true,showHistory:true}) }),
    Object.freeze({ stepId:'watch-05', title:'Tepe karakolu', service:'gate', action:'travel', prompt:'hill_fort rotasını gerçek seyahat otoritesinden başlat.', tags:Object.freeze(['settlement','road_watch','travel','gate']), hints:Object.freeze(['Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.','Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.','Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.']), ux:Object.freeze({successTone:'positive',blockedTone:'warning',failureTone:'danger',showObjective:true,showService:true,showHistory:true}) }),
    Object.freeze({ stepId:'watch-06', title:'Kuzey geçidi', service:'gate', action:'travel', prompt:'north_gate rotasına dön ve ikinci kontrol noktasını tamamla.', tags:Object.freeze(['settlement','road_watch','travel','gate']), hints:Object.freeze(['Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.','Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.','Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.']), ux:Object.freeze({successTone:'positive',blockedTone:'warning',failureTone:'danger',showObjective:true,showService:true,showHistory:true}) }),
    Object.freeze({ stepId:'watch-07', title:'Nöbet raporu', service:'barracks', action:'talk', prompt:'Kışlaya dönüp güvenli yol raporunu teslim et.', tags:Object.freeze(['settlement','road_watch','talk','barracks']), hints:Object.freeze(['Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.','Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.','Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.']), ux:Object.freeze({successTone:'positive',blockedTone:'warning',failureTone:'danger',showObjective:true,showService:true,showHistory:true}) }),
    Object.freeze({ stepId:'watch-08', title:'Son devriye', service:'gate', action:'travel', prompt:'north_gate rotasını son kez çalıştır ve bölüm sonucunu üret.', tags:Object.freeze(['settlement','road_watch','travel','gate']), hints:Object.freeze(['Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.','Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.','Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.']), ux:Object.freeze({successTone:'positive',blockedTone:'warning',failureTone:'danger',showObjective:true,showService:true,showHistory:true}) }),
  ]),
  hearth_and_home: Object.freeze([
    Object.freeze({ stepId:'home-01', title:'İlk gece', service:'house', action:'rest', prompt:'Evde ilk güvenli dinlenmeyi gerçekleştir.', tags:Object.freeze(['settlement','hearth_and_home','rest','house']), hints:Object.freeze(['Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.','Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.','Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.']), ux:Object.freeze({successTone:'positive',blockedTone:'warning',failureTone:'danger',showObjective:true,showService:true,showHistory:true}) }),
    Object.freeze({ stepId:'home-02', title:'İlk kayıt', service:'house', action:'save', prompt:'Mevcut persistence handler üzerinden güvenli kayıt noktası üret.', tags:Object.freeze(['settlement','hearth_and_home','save','house']), hints:Object.freeze(['Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.','Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.','Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.']), ux:Object.freeze({successTone:'positive',blockedTone:'warning',failureTone:'danger',showObjective:true,showService:true,showHistory:true}) }),
    Object.freeze({ stepId:'home-03', title:'Sandık', service:'house', action:'interact', prompt:'Ev içindeki etkileşimi mevcut interaction handler üzerinden tamamla.', tags:Object.freeze(['settlement','hearth_and_home','interact','house']), hints:Object.freeze(['Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.','Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.','Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.']), ux:Object.freeze({successTone:'positive',blockedTone:'warning',failureTone:'danger',showObjective:true,showService:true,showHistory:true}) }),
    Object.freeze({ stepId:'home-04', title:'Komşunun sözü', service:'house', action:'talk', prompt:'Ev sahibi NPC ile konuş ve sonraki kayıt adımını hazırla.', tags:Object.freeze(['settlement','hearth_and_home','talk','house']), hints:Object.freeze(['Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.','Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.','Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.']), ux:Object.freeze({successTone:'positive',blockedTone:'warning',failureTone:'danger',showObjective:true,showService:true,showHistory:true}) }),
    Object.freeze({ stepId:'home-05', title:'İkinci dinlenme', service:'house', action:'rest', prompt:'Dinlenme sonrası yorgunluk değişimini UX katmanında göster.', tags:Object.freeze(['settlement','hearth_and_home','rest','house']), hints:Object.freeze(['Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.','Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.','Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.']), ux:Object.freeze({successTone:'positive',blockedTone:'warning',failureTone:'danger',showObjective:true,showService:true,showHistory:true}) }),
    Object.freeze({ stepId:'home-06', title:'İkinci kayıt', service:'house', action:'save', prompt:'Quest ilerlemesini kaydet ve tekrar yüklenebilir durum üret.', tags:Object.freeze(['settlement','hearth_and_home','save','house']), hints:Object.freeze(['Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.','Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.','Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.']), ux:Object.freeze({successTone:'positive',blockedTone:'warning',failureTone:'danger',showObjective:true,showService:true,showHistory:true}) }),
    Object.freeze({ stepId:'home-07', title:'Hatıra', service:'house', action:'interact', prompt:'Envanterdeki ilgili eşya ile ev içi etkileşimi tamamla.', tags:Object.freeze(['settlement','hearth_and_home','interact','house']), hints:Object.freeze(['Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.','Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.','Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.']), ux:Object.freeze({successTone:'positive',blockedTone:'warning',failureTone:'danger',showObjective:true,showService:true,showHistory:true}) }),
    Object.freeze({ stepId:'home-08', title:'Ocak kapanışı', service:'house', action:'talk', prompt:'Ev zincirini tamamla ve kalıcı ilerleme ödülünü hazırla.', tags:Object.freeze(['settlement','hearth_and_home','talk','house']), hints:Object.freeze(['Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.','Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.','Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.']), ux:Object.freeze({successTone:'positive',blockedTone:'warning',failureTone:'danger',showObjective:true,showService:true,showHistory:true}) }),
  ]),
  winter_supply: Object.freeze([
    Object.freeze({ stepId:'winter-01', title:'Çiftlik planı', service:'farm', action:'talk', prompt:'Çiftlik sahibinden kış hazırlığı görevini öğren.', tags:Object.freeze(['settlement','winter_supply','talk','farm']), hints:Object.freeze(['Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.','Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.','Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.']), ux:Object.freeze({successTone:'positive',blockedTone:'warning',failureTone:'danger',showObjective:true,showService:true,showHistory:true}) }),
    Object.freeze({ stepId:'winter-02', title:'Otları topla', service:'farm', action:'collect', prompt:'İki şifalı otu gerçek inventory verisi üzerinden hazırla.', tags:Object.freeze(['settlement','winter_supply','collect','farm']), hints:Object.freeze(['Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.','Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.','Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.']), ux:Object.freeze({successTone:'positive',blockedTone:'warning',failureTone:'danger',showObjective:true,showService:true,showHistory:true}) }),
    Object.freeze({ stepId:'winter-03', title:'Ekmeği topla', service:'farm', action:'collect', prompt:'Dört ekmekle mutfak stoğunu gerçek inventory semantiğiyle tamamla.', tags:Object.freeze(['settlement','winter_supply','collect','farm']), hints:Object.freeze(['Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.','Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.','Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.']), ux:Object.freeze({successTone:'positive',blockedTone:'warning',failureTone:'danger',showObjective:true,showService:true,showHistory:true}) }),
    Object.freeze({ stepId:'winter-04', title:'Yol azığı hazırla', service:'farm', action:'craft', prompt:'travel_rations tarifini mevcut crafting otoritesine teslim et.', tags:Object.freeze(['settlement','winter_supply','craft','farm']), hints:Object.freeze(['Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.','Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.','Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.']), ux:Object.freeze({successTone:'positive',blockedTone:'warning',failureTone:'danger',showObjective:true,showService:true,showHistory:true}) }),
    Object.freeze({ stepId:'winter-05', title:'At yemi', service:'farm', action:'trade', prompt:'Bir at yemini mevcut trade handlera bağla.', tags:Object.freeze(['settlement','winter_supply','trade','farm']), hints:Object.freeze(['Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.','Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.','Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.']), ux:Object.freeze({successTone:'positive',blockedTone:'warning',failureTone:'danger',showObjective:true,showService:true,showHistory:true}) }),
    Object.freeze({ stepId:'winter-06', title:'Kış dinlenmesi', service:'farm', action:'rest', prompt:'Dinlenme sonucunu survival ve settlement feedback ile göster.', tags:Object.freeze(['settlement','winter_supply','rest','farm']), hints:Object.freeze(['Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.','Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.','Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.']), ux:Object.freeze({successTone:'positive',blockedTone:'warning',failureTone:'danger',showObjective:true,showService:true,showHistory:true}) }),
    Object.freeze({ stepId:'winter-07', title:'Kış geçidi', service:'gate', action:'travel', prompt:'winter_pass rotasını maliyet ve yorgunluk doğrulamasıyla başlat.', tags:Object.freeze(['settlement','winter_supply','travel','gate']), hints:Object.freeze(['Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.','Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.','Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.']), ux:Object.freeze({successTone:'positive',blockedTone:'warning',failureTone:'danger',showObjective:true,showService:true,showHistory:true}) }),
    Object.freeze({ stepId:'winter-08', title:'Kış raporu', service:'farm', action:'talk', prompt:'Çiftliğe dön ve ikmal zincirinin sonucunu teslim et.', tags:Object.freeze(['settlement','winter_supply','talk','farm']), hints:Object.freeze(['Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.','Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.','Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.']), ux:Object.freeze({successTone:'positive',blockedTone:'warning',failureTone:'danger',showObjective:true,showService:true,showHistory:true}) }),
  ]),
  stable_master: Object.freeze([
    Object.freeze({ stepId:'stable-01', title:'Ahır görevi', service:'stable', action:'talk', prompt:'Ahır ustasından binek hazırlığını öğren.', tags:Object.freeze(['settlement','stable_master','talk','stable']), hints:Object.freeze(['Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.','Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.','Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.']), ux:Object.freeze({successTone:'positive',blockedTone:'warning',failureTone:'danger',showObjective:true,showService:true,showHistory:true}) }),
    Object.freeze({ stepId:'stable-02', title:'Yem pazarlığı', service:'stable', action:'trade', prompt:'İki at yemini gerçek ekonomi hesabından geçir.', tags:Object.freeze(['settlement','stable_master','trade','stable']), hints:Object.freeze(['Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.','Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.','Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.']), ux:Object.freeze({successTone:'positive',blockedTone:'warning',failureTone:'danger',showObjective:true,showService:true,showHistory:true}) }),
    Object.freeze({ stepId:'stable-03', title:'Bineği dinlendir', service:'stable', action:'rest', prompt:'Mevcut rest handler ile yol öncesi toparlanmayı tamamla.', tags:Object.freeze(['settlement','stable_master','rest','stable']), hints:Object.freeze(['Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.','Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.','Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.']), ux:Object.freeze({successTone:'positive',blockedTone:'warning',failureTone:'danger',showObjective:true,showService:true,showHistory:true}) }),
    Object.freeze({ stepId:'stable-04', title:'Binek planı', service:'stable', action:'talk', prompt:'Ustadan rota seçimi için gerekli konuşmayı al.', tags:Object.freeze(['settlement','stable_master','talk','stable']), hints:Object.freeze(['Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.','Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.','Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.']), ux:Object.freeze({successTone:'positive',blockedTone:'warning',failureTone:'danger',showObjective:true,showService:true,showHistory:true}) }),
    Object.freeze({ stepId:'stable-05', title:'Eski değirmen', service:'gate', action:'travel', prompt:'old_mill rotasını gerçek travel otoritesine gönder.', tags:Object.freeze(['settlement','stable_master','travel','gate']), hints:Object.freeze(['Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.','Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.','Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.']), ux:Object.freeze({successTone:'positive',blockedTone:'warning',failureTone:'danger',showObjective:true,showService:true,showHistory:true}) }),
    Object.freeze({ stepId:'stable-06', title:'Nehir pazarı', service:'gate', action:'travel', prompt:'river_market rotasında yolculuğu tekrar çalıştır.', tags:Object.freeze(['settlement','stable_master','travel','gate']), hints:Object.freeze(['Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.','Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.','Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.']), ux:Object.freeze({successTone:'positive',blockedTone:'warning',failureTone:'danger',showObjective:true,showService:true,showHistory:true}) }),
    Object.freeze({ stepId:'stable-07', title:'Ahır raporu', service:'stable', action:'talk', prompt:'Yol sonuçlarını ustaya aktar.', tags:Object.freeze(['settlement','stable_master','talk','stable']), hints:Object.freeze(['Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.','Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.','Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.']), ux:Object.freeze({successTone:'positive',blockedTone:'warning',failureTone:'danger',showObjective:true,showService:true,showHistory:true}) }),
    Object.freeze({ stepId:'stable-08', title:'Doğu yolu', service:'gate', action:'travel', prompt:'east_road rotasıyla bölümü tamamla ve stable_hand etkisini göster.', tags:Object.freeze(['settlement','stable_master','travel','gate']), hints:Object.freeze(['Önce mevcut hizmet kartını aç ve işlemin gerçekten kullanılabilir olduğunu doğrula.','Koşul veya kaynak eksikse sahibinin gerçek blocked/feedback mesajını göster.','Başarılı sonuçtan sonra bir sonraki adım için tekrar runtime görünümünü oku.']), ux:Object.freeze({successTone:'positive',blockedTone:'warning',failureTone:'danger',showObjective:true,showService:true,showHistory:true}) }),
  ]),
});

const META = Object.freeze({
  iron_and_oath: Object.freeze({ id:'iron_and_oath', title:'Demir ve Yemin', chainId:'iron_and_oath', service:'blacksmith', summary:'Demirci stoklarını toparlayan, üretim ve kuşanma akışını tamamlayan bölüm.' }),
  market_routes: Object.freeze({ id:'market_routes', title:'Pazar ve Yollar', chainId:'market_routes', service:'market', summary:'Alışveriş, satış ve nehir pazarına seyahat akışını tamamlayan bölüm.' }),
  road_watch: Object.freeze({ id:'road_watch', title:'Yol Nöbeti', chainId:'road_watch', service:'barracks', summary:'Talimi, ekipmanı ve iki yol kontrolünü tek görev deneyiminde birleştiren bölüm.' }),
  hearth_and_home: Object.freeze({ id:'hearth_and_home', title:'Ocak ve Ev', chainId:'hearth_and_home', service:'house', summary:'Dinlenme, ev içi etkileşim ve güvenli kayıt akışını tamamlayan bölüm.' }),
  winter_supply: Object.freeze({ id:'winter_supply', title:'Kış İkmalı', chainId:'winter_supply', service:'farm', summary:'İkmal toplama, yol azığı üretimi ve riskli kış geçidine hazırlık bölümü.' }),
  stable_master: Object.freeze({ id:'stable_master', title:'Ahır Ustası', chainId:'stable_master', service:'stable', summary:'Binek yönetimi, yem tedariki ve orta mesafeli seyahat akışını tamamlayan bölüm.' }),
});

const EPISODES = Object.freeze(Object.fromEntries(
  Object.entries(META).map(([id, meta]) => [id, Object.freeze({
    ...meta,
    chapter:'Yerleşim Hikâyeleri',
    entry:Object.freeze({ type:'settlement', requires:Object.freeze(['settlement-present','runtime-ready']), placementContract:'shared-material-placement-v1' }),
    beats:BEAT_LIBRARY[id],
    completion:Object.freeze({ rewardSource:'settlementCampaignQuestChains', summary:'Ödül mevcut quest-chain runtime sonucu başarıya ulaştığında gösterilir.' }),
  })]),
));

const text = (value, fallback='') => { const normalized=String(value ?? '').trim(); return normalized ? normalized.slice(0, SETTLEMENT_EPISODE_LIMITS.text) : fallback; };
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const freeze = (value) => { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const nested of Object.values(value)) freeze(nested); return value; };

const LEGACY_SKILLS = Object.freeze({
  talk:'dialogue', collect:'survival', deliver:'commerce', craft:'smithing',
  travel:'travel', trade:'commerce', buy:'commerce', sell:'commerce',
  equip:'smithing', rest:'survival', train:'travel', save:'persistence', interact:'survival',
});
const resolveLegacyCondition = (conditionId, step) => {
  const match=String(conditionId ?? '').match(/^(flag|reputation|quest|item|skill)_\d+$/);
  if (!match) return null;
  const type=match[1];
  const threshold=type==='reputation' ? 0 : type==='item' ? Math.max(1,Number(step.quantity)||1) : type==='skill' ? Math.max(1,step.action==='travel'?2:1) : 1;
  const target=type==='item' ? step.target || '' : type==='quest' ? step.quest || '' : type==='skill' ? (LEGACY_SKILLS[step.action] || 'survival') : type==='reputation' ? 'local-faction' : 'settlement.flag.0';
  return Object.freeze({id:conditionId,type,threshold,target,success:'Koşul sağlandı.',failure:'Bu bölüm adımı için koşul henüz sağlanmıyor.',legacy:true});
};
export function resolveSettlementEpisodeCondition(conditionId, step) {
  return getSettlementDialogueCondition(conditionId) ?? resolveLegacyCondition(conditionId,step);
}

export function listSettlementEpisodes() { return Object.keys(EPISODES); }
export function getSettlementEpisode(episodeId) { const episode=EPISODES[episodeId]; return episode ? clone(episode) : null; }
export function getSettlementEpisodeBeat(episodeId,stepId) { const episode=EPISODES[episodeId]; const beat=episode?.beats.find((entry)=>entry.stepId===stepId); return beat ? clone({...beat,episodeId}) : null; }
export function getSettlementEpisodeForChain(chainId) { const episode=EPISODES[chainId]; return episode ? clone(episode) : null; }

export function validateSettlementEpisodeContent() {
  const errors=[]; const warnings=[];
  for (const episodeId of listSettlementEpisodes()) {
    const episode=EPISODES[episodeId];
    if (!listSettlementQuestChains().includes(episode.chainId)) { errors.push(`chain:${episodeId}:${episode.chainId}`); continue; }
    const chain=getSettlementQuestChain(episode.chainId);
    if (!chain) { errors.push(`missing-chain:${episodeId}`); continue; }
    if (episode.beats.length!==SETTLEMENT_EPISODE_LIMITS.beatsPerEpisode) errors.push(`beat-count:${episodeId}`);
    if (!getSettlementService(episode.service)) errors.push(`service:${episodeId}:${episode.service}`);
    const seen=new Set();
    for (const beat of episode.beats) {
      if (seen.has(beat.stepId)) errors.push(`duplicate-step:${episodeId}:${beat.stepId}`);
      seen.add(beat.stepId);
      const step=chain.steps.find((entry)=>entry.id===beat.stepId);
      if (!step) { errors.push(`step:${episodeId}:${beat.stepId}`); continue; }
      if (beat.action!==step.action) errors.push(`action:${beat.stepId}:${beat.action}:${step.action}`);
      if (beat.service!==episode.service && beat.service!=='gate') warnings.push(`service-drift:${beat.stepId}:${beat.service}`);
      if (!getSettlementQuestObjective(step.objective)) errors.push(`objective:${beat.stepId}:${step.objective}`);
      for (const conditionId of step.conditions ?? []) if (!resolveSettlementEpisodeCondition(conditionId,step)) warnings.push(`legacy-condition-unresolved:${beat.stepId}:${conditionId}`);
      if (step.recipe && !getSettlementRecipe(step.recipe)) errors.push(`recipe:${beat.stepId}:${step.recipe}`);
      if (step.route && !getSettlementRoute(step.route)) errors.push(`route:${beat.stepId}:${step.route}`);
      if (step.target && !getSettlementItem(step.target) && !getSettlementRecipe(step.target) && !getSettlementRoute(step.target) && /^(item_|recipe_|route_)/.test(step.target)) errors.push(`target:${beat.stepId}:${step.target}`);
      if (beat.hints.length>SETTLEMENT_EPISODE_LIMITS.hintsPerBeat) warnings.push(`hint-limit:${beat.stepId}`);
      if (beat.tags.length>SETTLEMENT_EPISODE_LIMITS.tagsPerBeat) warnings.push(`tag-limit:${beat.stepId}`);
    }
    if (!getSettlementQuestChainReward(episode.chainId)) errors.push(`reward:${episodeId}`);
  }
  return {ok:errors.length===0,errors,warnings};
}

export function buildSettlementEpisodeManifest() {
  const validation=validateSettlementEpisodeContent();
  return freeze({version:SETTLEMENT_EPISODE_CONTENT_VERSION,contract:'shared-material-placement-v1',episodes:listSettlementEpisodes().map((id)=>({...clone(EPISODES[id]),chain:getSettlementQuestChain(id),reward:getSettlementQuestChainReward(id)})),validation});
}

export function buildSettlementEpisodeBeatView(episodeId,stepId) {
  const beat=getSettlementEpisodeBeat(episodeId,stepId);
  if(!beat) return {ok:false,reason:'unknown-beat'};
  const chain=getSettlementQuestChain(episodeId);
  const step=getSettlementQuestChainStep(episodeId,stepId);
  if(!chain||!step) return {ok:false,reason:'missing-chain-step'};
  return freeze({ok:true,episodeId,stepId,beat,quest:clone(step),service:getSettlementService(beat.service),objective:getSettlementQuestObjective(step.objective),conditions:(step.conditions??[]).map((conditionId)=>resolveSettlementEpisodeCondition(conditionId,step)).filter(Boolean),recipe:step.recipe?getSettlementRecipe(step.recipe):null,route:step.route?getSettlementRoute(step.route):null,reward:getSettlementQuestChainReward(episodeId)});
}

export function createSettlementEpisodeContentResolver() {
  const validation=validateSettlementEpisodeContent();
  const resolve=(episodeId,stepId)=>buildSettlementEpisodeBeatView(episodeId,stepId);
  return Object.freeze({version:SETTLEMENT_EPISODE_CONTENT_VERSION,valid:validation.ok,validation:clone(validation),list:listSettlementEpisodes,get:getSettlementEpisode,getBeat:getSettlementEpisodeBeat,resolve,resolveCondition:resolveSettlementEpisodeCondition,manifest:buildSettlementEpisodeManifest});
}

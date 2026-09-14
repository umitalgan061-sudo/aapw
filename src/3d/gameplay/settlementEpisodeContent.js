/**
 * Günbatımı Ustası — authored playable settlement episodes.
 * Content-only; the existing SettlementCampaign runtime remains authoritative.
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
  episodes: 6, beatsPerEpisode: 8, hintsPerBeat: 3, text: 180, tagsPerBeat: 6,
});

const makeBeat = (stepId, title, service, action, prompt, tone = 'positive') => Object.freeze({
  stepId, title, service, action, prompt,
  hints: Object.freeze([
    'Önce mevcut hizmet kartını aç ve kullanılabilirliğini doğrula.',
    'Koşul veya kaynak eksikse mevcut runtime feedback bilgisini göster.',
    'Başarıdan sonra yeniden runtime görünümünü okuyup sonraki adıma geç.',
  ]),
  tags: Object.freeze(['settlement', action, service]),
  ux: Object.freeze({
    successTone: tone, blockedTone: 'warning', failureTone: 'danger',
    showObjective: true, showService: true, showHistory: true,
  }),
});

const BEAT_LIBRARY = Object.freeze({
  iron_and_oath: Object.freeze([
    makeBeat('iron-01','Demirhaneye giriş','blacksmith','talk','Ustaya yaklaş ve demir stoklarının neden tükendiğini öğren.'),
    makeBeat('iron-02','Ustanın güveni','blacksmith','talk','Ustanın güvenini kazanacak konuşmayı mevcut diyalog otoritesine ver.'),
    makeBeat('iron-03','Cevher toplama','blacksmith','collect','Dört demir cevherini gerçek envanterden hazırla.'),
    makeBeat('iron-04','Kömür stoğu','blacksmith','collect','İki kömürü tamamla ve ocağın üretim için hazır olduğunu göster.'),
    makeBeat('iron-05','Kılıcı döv','blacksmith','craft','Mevcut blacksmith tarifini kullanarak demir kılıcı üret.'),
    makeBeat('iron-06','Kılıcı kuşan','blacksmith','equip','Üretilen kılıcı mevcut equipment otoritesine ver ve kuşanma sonucunu göster.'),
    makeBeat('iron-07','Ocağın başında dinlen','blacksmith','rest','Üretim sonrası yorgunluğu mevcut dinlenme mekanizmasıyla toparla.'),
    makeBeat('iron-08','Yemin','blacksmith','talk','Ustaya dön, tamamlanan adımları konuştur ve zincirin ödülünü hazırla.'),
  ]),
  market_routes: Object.freeze([
    makeBeat('market-01','Pazarın hesabı','market','talk','Pazar görevlisinden fiyatları ve kervan açığını öğren.'),
    makeBeat('market-02','Erzak al','market','buy','Üç ekmek satın al ve gerçek ekonomi otoritesinden fiyatı geçir.'),
    makeBeat('market-03','Cevheri sat','market','sell','İki demir cevherini gerçek vendor fiyatıyla sat.'),
    makeBeat('market-04','Azık değişimi','market','trade','İki yol azığını mevcut trade quote üzerinden edin.'),
    makeBeat('market-05','Kervan bağlantısı','market','talk','Pazar görevlisinin güvenini bir sonraki yol adımına taşı.'),
    makeBeat('market-06','Nehir pazarına git','gate','travel','river_market rotasını gerçek travel maliyetiyle başlat.'),
    makeBeat('market-07','Deri fazlasını sat','market','sell','İki deriyi sat ve kervan hesabının son açığını kapat.'),
    makeBeat('market-08','Pazar zinciri sonu','market','talk','Kervan bağlantısını onaylat ve bölüm ödülünü hazırla.'),
  ]),
  road_watch: Object.freeze([
    makeBeat('watch-01','Nöbet emri','barracks','talk','Kışla kumandanından yol güvenliği emrini al.'),
    makeBeat('watch-02','Nöbet talimi','barracks','train','Mevcut training handler ile kısa savunma talimini tamamla.'),
    makeBeat('watch-03','Nöbet ekipmanı','barracks','equip','Demir kılıcı mevcut equipment otoritesine bağla.'),
    makeBeat('watch-04','Kapı emri','barracks','talk','Kuzey kapısı emrini NPC diyaloğu üzerinden teyit et.'),
    makeBeat('watch-05','Tepe karakolu','gate','travel','hill_fort rotasını gerçek seyahat otoritesinden başlat.'),
    makeBeat('watch-06','Kuzey geçidi','gate','travel','north_gate rotasına dön ve ikinci kontrol noktasını tamamla.'),
    makeBeat('watch-07','Nöbet raporu','barracks','talk','Kışlaya dönüp güvenli yol raporunu teslim et.'),
    makeBeat('watch-08','Son devriye','gate','travel','north_gate rotasını son kez çalıştır ve bölüm sonucunu üret.'),
  ]),
  hearth_and_home: Object.freeze([
    makeBeat('home-01','İlk gece','house','rest','Evde ilk güvenli dinlenmeyi gerçekleştir.'),
    makeBeat('home-02','İlk kayıt','house','save','Mevcut persistence handler üzerinden güvenli kayıt noktası üret.'),
    makeBeat('home-03','Sandık','house','interact','Ev içindeki etkileşimi mevcut interaction handler üzerinden tamamla.'),
    makeBeat('home-04','Komşunun sözü','house','talk','Ev sahibi NPC ile konuş ve sonraki kayıt adımını hazırla.'),
    makeBeat('home-05','İkinci dinlenme','house','rest','Dinlenme sonrası yorgunluk değişimini UX katmanında göster.'),
    makeBeat('home-06','İkinci kayıt','house','save','Quest ilerlemesini kaydet ve tekrar yüklenebilir durum üret.'),
    makeBeat('home-07','Hatıra','house','interact','Envanterdeki ilgili eşya ile ev içi etkileşimi tamamla.'),
    makeBeat('home-08','Ocak kapanışı','house','talk','Ev zincirini tamamla ve kalıcı ilerleme ödülünü hazırla.'),
  ]),
  winter_supply: Object.freeze([
    makeBeat('winter-01','Çiftlik planı','farm','talk','Çiftlik sahibinden kış hazırlığı görevini öğren.'),
    makeBeat('winter-02','Otları topla','farm','collect','İki şifalı otu gerçek inventory verisi üzerinden hazırla.'),
    makeBeat('winter-03','Ekmeği topla','farm','collect','Dört ekmekle mutfak stoğunu gerçek inventory semantiğiyle tamamla.'),
    makeBeat('winter-04','Yol azığı hazırla','farm','craft','travel_rations tarifini mevcut crafting otoritesine teslim et.'),
    makeBeat('winter-05','At yemi','farm','trade','Bir at yemini mevcut trade handlera bağla.'),
    makeBeat('winter-06','Kış dinlenmesi','farm','rest','Dinlenme sonucunu survival ve settlement feedback ile göster.'),
    makeBeat('winter-07','Kış geçidi','gate','travel','winter_pass rotasını maliyet ve yorgunluk doğrulamasıyla başlat.'),
    makeBeat('winter-08','Kış raporu','farm','talk','Çiftliğe dön ve ikmal zincirinin sonucunu teslim et.'),
  ]),
  stable_master: Object.freeze([
    makeBeat('stable-01','Ahır görevi','stable','talk','Ahır ustasından binek hazırlığını öğren.'),
    makeBeat('stable-02','Yem pazarlığı','stable','trade','İki at yemini gerçek ekonomi hesabından geçir.'),
    makeBeat('stable-03','Bineği dinlendir','stable','rest','Mevcut rest handler ile yol öncesi toparlanmayı tamamla.'),
    makeBeat('stable-04','Binek planı','stable','talk','Ustadan rota seçimi için gerekli konuşmayı al.'),
    makeBeat('stable-05','Eski değirmen','gate','travel','old_mill rotasını gerçek travel otoritesine gönder.'),
    makeBeat('stable-06','Nehir pazarı','gate','travel','river_market rotasında yolculuğu tekrar çalıştır.'),
    makeBeat('stable-07','Ahır raporu','stable','talk','Yol sonuçlarını ustaya aktar.'),
    makeBeat('stable-08','Doğu yolu','gate','travel','east_road rotasıyla bölümü tamamla ve stable_hand etkisini göster.'),
  ]),
});

const META = Object.freeze({
  iron_and_oath: Object.freeze({
    id:'iron_and_oath', title:'Demir ve Yemin', chainId:'iron_and_oath', service:'blacksmith',
    summary:'Demirci stoklarını toparlayan, üretim ve kuşanma akışını tamamlayan bölüm.',
  }),
  market_routes: Object.freeze({
    id:'market_routes', title:'Pazar ve Yollar', chainId:'market_routes', service:'market',
    summary:'Alışveriş, satış ve nehir pazarına seyahat akışını tamamlayan bölüm.',
  }),
  road_watch: Object.freeze({
    id:'road_watch', title:'Yol Nöbeti', chainId:'road_watch', service:'barracks',
    summary:'Talimi, ekipmanı ve iki yol kontrolünü tek görev deneyiminde birleştiren bölüm.',
  }),
  hearth_and_home: Object.freeze({
    id:'hearth_and_home', title:'Ocak ve Ev', chainId:'hearth_and_home', service:'house',
    summary:'Dinlenme, ev içi etkileşim ve güvenli kayıt akışını tamamlayan bölüm.',
  }),
  winter_supply: Object.freeze({
    id:'winter_supply', title:'Kış İkmalı', chainId:'winter_supply', service:'farm',
    summary:'İkmal toplama, yol azığı üretimi ve riskli kış geçidine hazırlık bölümü.',
  }),
  stable_master: Object.freeze({
    id:'stable_master', title:'Ahır Ustası', chainId:'stable_master', service:'stable',
    summary:'Binek yönetimi, yem tedariki ve orta mesafeli seyahat akışını tamamlayan bölüm.',
  }),
});

const EPISODES = Object.freeze(Object.fromEntries(
  Object.entries(META).map(([id, meta]) => [id, Object.freeze({
    ...meta,
    chapter:'Yerleşim Hikâyeleri',
    entry:Object.freeze({
      type:'settlement',
      requires:Object.freeze(['settlement-present','runtime-ready']),
      placementContract:'shared-material-placement-v1',
    }),
    beats:BEAT_LIBRARY[id],
    completion:Object.freeze({
      rewardSource:'settlementCampaignQuestChains',
      summary:'Ödül mevcut quest-chain runtime sonucu başarıya ulaştığında gösterilir.',
    }),
  })]),
));

const text = (value, fallback='') => {
  const normalized=String(value ?? '').trim();
  return normalized ? normalized.slice(0, SETTLEMENT_EPISODE_LIMITS.text) : fallback;
};
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) freeze(nested);
  return value;
};

export function listSettlementEpisodes() { return Object.keys(EPISODES); }

export function getSettlementEpisode(episodeId) {
  const episode=EPISODES[episodeId];
  return episode ? clone(episode) : null;
}

export function getSettlementEpisodeBeat(episodeId, stepId) {
  const episode=EPISODES[episodeId];
  const beat=episode?.beats.find((entry)=>entry.stepId===stepId);
  return beat ? clone({...beat,episodeId}) : null;
}

export function getSettlementEpisodeForChain(chainId) {
  return getSettlementEpisode(chainId);
}

export function validateSettlementEpisodeContent() {
  const errors=[]; const warnings=[];
  for (const episodeId of listSettlementEpisodes()) {
    const episode=EPISODES[episodeId];
    if (!listSettlementQuestChains().includes(episode.chainId)) {
      errors.push(`chain:${episodeId}:${episode.chainId}`); continue;
    }
    const chain=getSettlementQuestChain(episode.chainId);
    if (!chain) { errors.push(`missing-chain:${episodeId}`); continue; }
    if (episode.beats.length !== SETTLEMENT_EPISODE_LIMITS.beatsPerEpisode) {
      errors.push(`beat-count:${episodeId}`);
    }
    if (!getSettlementService(episode.service)) errors.push(`service:${episodeId}:${episode.service}`);
    const seen=new Set();
    for (const beat of episode.beats) {
      if (seen.has(beat.stepId)) errors.push(`duplicate:${episodeId}:${beat.stepId}`);
      seen.add(beat.stepId);
      const step=getSettlementQuestChainStep(episodeId,beat.stepId);
      if (!step) { errors.push(`step:${episodeId}:${beat.stepId}`); continue; }
      if (step.action!==beat.action) errors.push(`action:${beat.stepId}:${beat.action}:${step.action}`);
      if (!getSettlementQuestObjective(step.objective)) errors.push(`objective:${beat.stepId}:${step.objective}`);
      for (const conditionId of step.conditions ?? []) {
        if (!getSettlementDialogueCondition(conditionId)) errors.push(`condition:${beat.stepId}:${conditionId}`);
      }
      if (step.recipe && !getSettlementRecipe(step.recipe)) errors.push(`recipe:${beat.stepId}:${step.recipe}`);
      if (step.route && !getSettlementRoute(step.route)) errors.push(`route:${beat.stepId}:${step.route}`);
      if (step.target && /^(item_|recipe_|route_)/.test(step.target) && !(
        getSettlementItem(step.target) || getSettlementRecipe(step.target) || getSettlementRoute(step.target)
      )) errors.push(`target:${beat.stepId}:${step.target}`);
      if (beat.hints.length > SETTLEMENT_EPISODE_LIMITS.hintsPerBeat) warnings.push(`hints:${beat.stepId}`);
      if (beat.tags.length > SETTLEMENT_EPISODE_LIMITS.tagsPerBeat) warnings.push(`tags:${beat.stepId}`);
      if (text(beat.prompt).length===0) errors.push(`prompt:${beat.stepId}`);
    }
    if (!getSettlementQuestChainReward(episode.chainId)) errors.push(`reward:${episodeId}`);
  }
  return {ok:errors.length===0,errors,warnings};
}

export function buildSettlementEpisodeManifest() {
  const manifest={
    version:SETTLEMENT_EPISODE_CONTENT_VERSION,
    contract:'shared-material-placement-v1',
    episodes:listSettlementEpisodes().map((id)=>({
      ...clone(EPISODES[id]),
      chain:getSettlementQuestChain(id),
      reward:getSettlementQuestChainReward(id),
    })),
    validation:validateSettlementEpisodeContent(),
  };
  return freeze(manifest);
}

export function buildSettlementEpisodeBeatView(episodeId,stepId) {
  const beat=getSettlementEpisodeBeat(episodeId,stepId);
  if (!beat) return {ok:false,reason:'unknown-beat'};
  const step=getSettlementQuestChainStep(episodeId,stepId);
  if (!step) return {ok:false,reason:'missing-quest-step'};
  return freeze({
    ok:true,episodeId,stepId,beat,quest:clone(step),
    service:getSettlementService(beat.service),
    objective:getSettlementQuestObjective(step.objective),
    conditions:(step.conditions ?? []).map(getSettlementDialogueCondition).filter(Boolean),
    recipe:step.recipe ? getSettlementRecipe(step.recipe) : null,
    route:step.route ? getSettlementRoute(step.route) : null,
    reward:getSettlementQuestChainReward(episodeId),
  });
}

export function createSettlementEpisodeContentResolver() {
  const validation=validateSettlementEpisodeContent();
  return Object.freeze({
    version:SETTLEMENT_EPISODE_CONTENT_VERSION,
    valid:validation.ok,
    validation:clone(validation),
    list:listSettlementEpisodes,
    get:getSettlementEpisode,
    getBeat:getSettlementEpisodeBeat,
    resolve:buildSettlementEpisodeBeatView,
    manifest:buildSettlementEpisodeManifest,
  });
}

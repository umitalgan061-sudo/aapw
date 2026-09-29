export interface DialogueChoice {
  readonly label: string;
  readonly response: string;
}
export type DialogueChoicesByNpcId = Readonly<Record<string, readonly DialogueChoice[]>>;

export const CHOICES_BY_NPC_ID: DialogueChoicesByNpcId = Object.freeze({
	'umit-guard-1': Object.freeze([
		Object.freeze({
			label: 'Ejderhalar hâlâ var mı?',
			response: '{name}: Yıllardır kimse görmedi, ama Targeryan kanı bu surlarda hâlâ akıyor. Umutlanmak günah değil.',
		}),
		Object.freeze({
			label: 'Ümit Targeryan nerede?',
			response: '{name}: Lordumuz surların içinde, danışmanlarıyla meşgul. Onu rahatsız etmeni tavsiye etmem.',
		}),
		Object.freeze({
			label: 'Burada nöbet tutmak seni hiç korkutuyor mu?',
			response: '{name}: Korku, gafil avlanmayanı ısırmaz, yabancı. Ben gözümü dört açarım, korkuya vaktim olmaz.',
		}),
	]),
	'berkalp-guard-1': Object.freeze([
		Object.freeze({
			label: 'Kışın geldiğini nereden biliyorsun?',
			response: '{name}: Stark\'ın sözü boşuna değildir. Rüzgar kuzeyden esmeye başladı mı, biz hazır demektir.',
		}),
		Object.freeze({
			label: 'Kurtlar neden bu kadar yakın dolaşıyor?',
			response: '{name}: Direwolf bizim kanımızdandır. Onlar buradaysa, biz de güvende demektir.',
		}),
		Object.freeze({
			label: 'Bu kadar uzun süren nöbetler seni hiç yorar mı?',
			response: '{name}: Stark\'a hizmet yorgunluk tanımaz, yabancı. Kış geldiğinde dinlenecek vakit olmayacak, o yüzden şimdiden alışıyorum.',
		}),
	]),
	'doran-guard-1': Object.freeze([
		Object.freeze({
			label: 'Diğer krallıklarla aranız neden bu kadar gergin?',
			response: '{name}: Dorne kimseye boyun eğmedi, kimseye de borçlu değil. Gerginlik değil, bağımsızlıktır bu.',
		}),
		Object.freeze({
			label: 'Dorne\'un gizli bahçeleri var mı?',
			response: '{name}: Bahçelerimizde ne yetiştiğini yalnızca Dorne halkı bilir, yabancı. Sen bilmesen daha iyi.',
		}),
		Object.freeze({
			label: 'Bu kadar bağımsız kalmanın hiç bir bedeli oldu mu?',
			response: '{name}: Oldu elbette, yabancı. Yalnız yürüyen zor günde müttefik bulamaz. Ama biz bunu göze aldık, boyun eğmektense.',
		}),
	]),
	'xaro-guard-1': Object.freeze([
		Object.freeze({
			label: 'Diğer on iki kapının ardında ne var?',
			response: '{name}: Tüccarlar, sırlar, bazen de hiçbir şey. Qarth kapılarını meraklılara açık tutmaz.',
		}),
		Object.freeze({
			label: 'Qarth\'a nasıl güven kazanılır?',
			response: '{name}: Altınla, ya da sabırla. İkisi de yoksa, on üçüncü kapı seni hiç görmeyecek.',
		}),
		Object.freeze({
			label: 'Hiç kendi kapından çıkıp gitmeyi düşündün mü?',
			response: '{name}: Elbette düşündüm, yabancı. On üç kapıdan hangisinin ardında benim için bir hayat olduğunu hâlâ merak ederim. Ama nöbetim burada, hayalim değil.',
		}),
	]),
	'cersei-guard-1': Object.freeze([
		Object.freeze({
			label: 'Lannister\'lar neden bu kadar zengin?',
			response: '{name}: Casterly Rock\'ın madenleri hiç tükenmez derler. İster inan, ister inanma, altın konuşur.',
		}),
		Object.freeze({
			label: 'Cersei Lannister nasıl bir kraliçedir?',
			response: '{name}: Sorgulanacak biri değildir. Sözü kanundur, burada da öyledir.',
		}),
		Object.freeze({
			label: 'Cersei\'ye karşı gelmek ne olur dersin?',
			response: '{name}: Karşı gelen fazla yaşamaz, yabancı. Ben emirlere uyarım, sorgulamam — hayatta kalmanın tek yolu bu.',
		}),
	]),
	'stannis-guard-1': Object.freeze([
		Object.freeze({
			label: 'Stannis\'in adaleti tam olarak nedir?',
			response: '{name}: Kanun herkese eşit uygulanır, lorda da köylüye de. Kral Stannis kayırma tanımaz.',
		}),
		Object.freeze({
			label: 'Neden başka bir kral değil de Stannis?',
			response: '{name}: Hak onundur, yabancı. O, görevden kaçmaz — bu yeterli bir cevaptır.',
		}),
		Object.freeze({
			label: 'Stannis\'in davasına hiç şüphe duydun mu?',
			response: '{name}: Şüphe zayıflıktır, yabancı. Ben hakka hizmet ederim, sonucuna değil — Kral\'ın davası benim davamdır, sorgulamadan.',
		}),
	]),
	'stannis-guard-2': Object.freeze([
		Object.freeze({
			label: 'Tepede tam olarak ne arıyorsun?',
			response: '{name}: Düşman ateşi, yabancı bayrağı, her ne gelirse. İlk gören ben olurum, ilk uyaran da.',
		}),
		Object.freeze({
			label: 'Birinci nöbetçiyle aranız nasıl?',
			response: '{name}: O kapıyı tutar, ben tepeyi. İkimiz de aynı krala hizmet ederiz, sorun çıkmaz.',
		}),
		Object.freeze({
			label: 'Burada tek başına nöbet tutmak seni hiç yalnızlaştırıyor mu?',
			response: '{name}: Yalnızlaştırıyor elbette, yabancı. Ama tepeden bakınca kaleyi de, aşağıdakileri de görürüm — hiç yalnız değilmişim gibi hissettiren de bu.',
		}),
	]),
	'balon-guard-1': Object.freeze([
		Object.freeze({
			label: 'Tohum ekmemek ne demek?',
			response: '{name}: Toprağa güvenmeyiz, denize güveniriz. İhtiyacımız olanı alırız, beklemeyiz.',
		}),
		Object.freeze({
			label: 'Demir Adalar\'a nasıl saygı gösterilir?',
			response: '{name}: Güçle, yabancı. Zayıflık burada saygı görmez, ne sözle ne de altınla.',
		}),
		Object.freeze({
			label: 'Eski Yol hiç istediğinden fazlasına mal oldu mu?',
			response: '{name}: Oldu, yabancı, birden fazla kez. Denizin aldığını geri vermez o — ama teslim olmak daha ağır bir bedel, biz öyle biliriz.',
		}),
	]),
	'robin-guard-1': Object.freeze([
		Object.freeze({
			label: 'Neden bu kadar yükseğe yerleştiniz?',
			response: '{name}: Eyrie\'ye kimse merdivensiz çıkamaz, yabancı. Yükseklik en iyi kaledir, kılıçtan önce gelir.',
		}),
		Object.freeze({
			label: 'Kartallarınız gerçekten her şeyi mi görür?',
			response: '{name}: Vadi\'nin her karışını görürler. Sana da bir göz atıyorlardır şu an, merak etme.',
		}),
		Object.freeze({
			label: 'Bu kadar yükseklikte nöbet tutmak seni hiç ürkütmüyor mu?',
			response: '{name}: Ürkütmüyor değil, yabancı. Ay Kapısı\'nın altında neyin beklediğini herkes bilir burada — ama benim asıl korkum düşmek değil, bir gün aşağıyı özlemek.',
		}),
	]),
	'ziya-guard-1': Object.freeze([
		Object.freeze({
			label: 'Ziya Hanım\'ın bahçeleri neyle ünlü?',
			response: '{name}: Reach\'in en bereketli toprakları burada, yabancı. Kışın bile açlık bilmeyiz.',
		}),
		Object.freeze({
			label: 'Büyüyen güç derken neyi kastediyorsun?',
			response: '{name}: Ordular kılıçla büyür, biz tahılla. Sonunda ikisi de aynı kapıya çıkar.',
		}),
		Object.freeze({
			label: 'Bu kadar bereketli olmak hiç sizi hedef hâline getirmiyor mu?',
			response: '{name}: Getiriyor, yabancı, hem de sık sık. Aç kalan komşu dolu ambara göz diker. Reach\'in gerçek savunması surlar değil, kimin bize borçlu olduğudur.',
		}),
	]),
	'berk-guard-1': Object.freeze([
		Object.freeze({
			label: 'Topraklarınız neden bu kadar verimli?',
			response: '{name}: Reach\'in toprağı cömerttir, yabancı. Ekersin, biçersin, hiç boş dönmezsin.',
		}),
		Object.freeze({
			label: 'Misafirperverliğinizin sınırı tam olarak ne?',
			response: '{name}: Sofra herkese açıktır, ama kapı herkese değil. Niyetini belli et, gerisi kolay.',
		}),
		Object.freeze({
			label: 'Yanlış birini içeri aldığın oldu mu hiç?',
			response: '{name}: Oldu, yabancı, bir kez. O günden beri her yüze bakışım değişti — bu kapı artık taştan değil, benim vicdanımdan yapılma.',
		}),
	]),
	'olena-guard-1': Object.freeze([
		Object.freeze({
			label: 'Olena Hanım\'ın diline neden bu kadar dikkat etmeli?',
			response: '{name}: Kılıçtan çok kelimeyle kesilen görmüştür bu saray, yabancı. Sözü boşa gitmez.',
		}),
		Object.freeze({
			label: 'Keskin sözleri kimseyi kırmıyor mu hiç?',
			response: '{name}: Kırar elbette, ama doğru söylenmiş bir söz her zaman bir yalandan iyidir.',
		}),
		Object.freeze({
			label: 'Keskin dilin hiç başını belaya soktu mu?',
			response: '{name}: Soktu elbette, yabancı. Ama sustuğum günler, konuştuğum günlerden daha pişman ettiği için artık susmuyorum.',
		}),
	]),
	'twin-guard-1': Object.freeze([
		Object.freeze({
			label: 'Köprüden geçmenin bir bedeli var mı?',
			response: '{name}: Her geçiş bir borçtur, yabancı. İkiz Kuleler unutmaz, kim geçti kim geçmedi.',
		}),
		Object.freeze({
			label: 'Neden her adımı bu kadar yakından izliyorsunuz?',
			response: '{name}: Nehrin iki yakası da bizimdir. Kimse habersiz geçemez, gece de olsa gündüz de.',
		}),
		Object.freeze({
			label: 'Hiç fark edilmeden geçen biri oldu mu?',
			response: '{name}: Bir kere oldu, bir daha olmadı, yabancı. O geceden sonra nöbeti hiç gevşetmedik.',
		}),
	]),
});

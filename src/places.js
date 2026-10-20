// Gazetteer of Dhaka areas and landmarks. The route network only has stops (hubs), so every place here is
// matched to the nearest hub. Coordinates are approximate area centres: good enough to find the nearest stop,
// not for navigation. Each row: [name, lat, lng, 'alias|alias', 'বাংলা|বাংলা'].
const { km } = require('./geo');

const ROWS = [
  // north-east: Gulshan, Banani side
  ['Gulshan', 23.7880, 90.4155, 'gulshan|gulshan avenue|gulshan model town|gulshan thana', 'গুলশান'],
  ['Gulshan 1', 23.7807, 90.4167, 'gulshan 1|gulshan1|gulshan one|gulshan circle 1', 'গুলশান 1|গুলশান-১'],
  ['Gulshan 2', 23.7948, 90.4143, 'gulshan 2|gulshan2|gulshan two|gulshan circle 2', 'গুলশান 2|গুলশান-২'],
  ['Baridhara', 23.7995, 90.4210, 'baridhara|baridhara diplomatic zone|diplomatic zone|baridhara dohs', 'বারিধারা'],
  ['Niketan', 23.7727, 90.4095, 'niketan', 'নিকেতন'],
  ['Mohakhali DOHS', 23.7790, 90.3942, 'mohakhali dohs|dohs mohakhali', 'মহাখালী ডিওএইচএস'],
  ['Bashundhara R/A', 23.8190, 90.4510, 'bashundhara|basundhara|bashundhara ra|bashundhara residential area', 'বসুন্ধরা'],
  ['Notun Bazar', 23.7977, 90.4237, 'notun bazar|natun bazar|nadda|vatara|vatara thana', 'নতুন বাজার|নদ্দা|ভাটারা'],
  ['Merul Badda', 23.7763, 90.4275, 'merul badda|merul', 'মেরুল বাড্ডা'],
  ['Uttar Badda', 23.7855, 90.4260, 'uttar badda', 'উত্তর বাড্ডা'],
  ['Satarkul', 23.7915, 90.4310, 'satarkul', 'সাতারকুল'],
  ['Aftabnagar', 23.7650, 90.4440, 'aftabnagar|aftab nagar', 'আফতাবনগর'],
  ['Jamuna Future Park', 23.8135, 90.4240, 'jamuna future park|future park|jfp', 'যমুনা ফিউচার পার্ক'],
  ['Nikunja', 23.8300, 90.4130, 'nikunja|nikunja 2', 'নিকুঞ্জ'],
  // north: airport, Uttara side
  ['Airport', 23.8433, 90.3978, 'airport|hazrat shahjalal|shahjalal airport|hazrat shahjalal international airport|dhaka airport|biman bandar|bimanbondor', 'বিমানবন্দর|এয়ারপোর্ট|বিমান বন্দর'],
  ['Abdullahpur', 23.8800, 90.4005, 'abdullahpur', 'আব্দুল্লাহপুর'],
  ['Dakshinkhan', 23.8500, 90.4220, 'dakshinkhan|dakkhinkhan|dokkhinkhan', 'দক্ষিণখান'],
  ['Tongi', 23.8918, 90.4046, 'tongi|tongi station|tongi bazar', 'টঙ্গী'],
  ['Cantonment', 23.8210, 90.4010, 'cantonment|dhaka cantonment', 'ক্যান্টনমেন্ট'],
  // Mirpur and west
  ['Mirpur 2', 23.8084, 90.3639, 'mirpur 2|mirpur2', 'মিরপুর 2|মিরপুর-২'],
  ['Mirpur 6', 23.8157, 90.3588, 'mirpur 6|mirpur6', 'মিরপুর 6|মিরপুর-৬'],
  ['Mirpur 13', 23.8070, 90.3800, 'mirpur 13|mirpur13', 'মিরপুর 13'],
  ['Mirpur 14', 23.8000, 90.3880, 'mirpur 14|mirpur14', 'মিরপুর 14'],
  ['Mirpur DOHS', 23.8355, 90.3680, 'mirpur dohs|dohs mirpur', 'মিরপুর ডিওএইচএস'],
  ['Kafrul', 23.7958, 90.3822, 'kafrul', 'কাফরুল'],
  ['Kochukhet', 23.8025, 90.3866, 'kochukhet|kachukhet', 'কচুক্ষেত'],
  ['Bhashantek', 23.8000, 90.3923, 'bhashantek|bhasantek', 'ভাষানটেক'],
  ['Gabtoli', 23.7782, 90.3441, 'gabtoli|gabtali|gabtoli bus terminal', 'গাবতলী|গাবতলি'],
  ['Technical', 23.7829, 90.3489, 'technical mor|technical more', 'টেকনিক্যাল'],
  ['Dhaka Zoo', 23.8140, 90.3440, 'dhaka zoo|mirpur zoo|national zoo|botanical garden', 'চিড়িয়াখানা'],
  // Mohammadpur, Dhanmondi
  ['Adabor', 23.7714, 90.3594, 'adabor', 'আদাবর'],
  ['Shekhertek', 23.7677, 90.3596, 'shekhertek|shekher tek', 'শেখেরটেক'],
  ['Lalmatia', 23.7580, 90.3689, 'lalmatia', 'লালমাটিয়া'],
  ['Satmasjid Road', 23.7480, 90.3720, 'satmasjid road|sat masjid road|satmasjid', 'সাতমসজিদ রোড'],
  ['Jigatola', 23.7395, 90.3730, 'jigatola|zigatola|jhigatola', 'জিগাতলা'],
  // centre: Tejgaon, Panthapath, Shahbagh side
  ['Tejgaon', 23.7640, 90.3990, 'tejgaon|tejgaon industrial area|tejgaon link road|tejgaon college|tejgoan', 'তেজগাঁও|তেজগাও'],
  ['Tejkunipara', 23.7590, 90.3950, 'tejkunipara|tejkuni para', 'তেজকুনিপাড়া'],
  ['Panthapath', 23.7516, 90.3851, 'panthapath|panthopath', 'পান্থপথ'],
  ['Green Road', 23.7536, 90.3873, 'green road', 'গ্রিন রোড|গ্রীন রোড'],
  ['Bashundhara City', 23.7512, 90.3911, 'bashundhara city|bashundhara city mall|bashundhara shopping complex', 'বসুন্ধরা সিটি'],
  ['Square Hospital', 23.7528, 90.3817, 'square hospital', 'স্কয়ার হাসপাতাল'],
  ['Elephant Road', 23.7385, 90.3895, 'elephant road|elephant rd', 'এলিফ্যান্ট রোড'],
  ['Hatirpool', 23.7410, 90.3880, 'hatirpool|hatirpul|hatirpol', 'হাতিরপুল'],
  ['Nilkhet', 23.7336, 90.3866, 'nilkhet|neelkhet', 'নীলক্ষেত'],
  ['Dhaka College', 23.7370, 90.3841, 'dhaka college', 'ঢাকা কলেজ'],
  ['BUET', 23.7265, 90.3926, 'buet', 'বুয়েট'],
  ['Dhaka Medical College', 23.7260, 90.3978, 'dmc|dhaka medical|dhaka medical college', 'ঢাকা মেডিকেল'],
  ['BSMMU', 23.7388, 90.3951, 'bsmmu|pg hospital', 'বিএসএমএমইউ|পিজি হাসপাতাল'],
  ['National Museum', 23.7384, 90.3946, 'national museum', 'জাতীয় জাদুঘর'],
  ['Suhrawardy Udyan', 23.7355, 90.3987, 'suhrawardy udyan|suhrawardy uddyan|race course', 'সোহরাওয়ার্দী উদ্যান'],
  ['Ramna', 23.7366, 90.3999, 'ramna|ramna park', 'রমনা'],
  ['Jatiya Sangsad', 23.7625, 90.3790, 'sangsad bhaban|parliament|jatiya sangsad|national parliament', 'সংসদ ভবন'],
  // Moghbazar, Malibagh, Rampura, Khilgaon
  ['Eskaton', 23.7467, 90.4012, 'eskaton|eskaton garden', 'ইস্কাটন'],
  ['Moghbazar', 23.7487, 90.4040, 'moghbazar|mogbazar|magbazar|maghbazar', 'মগবাজার'],
  ['Mouchak', 23.7458, 90.4098, 'mouchak|moucak', 'মৌচাক'],
  ['Siddheswari', 23.7426, 90.4089, 'siddheswari|siddeshwari|shiddheshwari', 'সিদ্ধেশ্বরী'],
  ['Shantinagar', 23.7370, 90.4137, 'shantinagar|shanti nagar', 'শান্তিনগর'],
  ['Hatirjheel', 23.7510, 90.4140, 'hatirjheel|hatirjhil', 'হাতিরঝিল'],
  ['Rampura', 23.7620, 90.4240, 'rampura|rampura bridge|rampura tv center', 'রামপুরা'],
  ['Khilgaon', 23.7500, 90.4285, 'khilgaon|khilgaon railgate|khilgaon chowdhury para', 'খিলগাঁও'],
  ['Basabo', 23.7412, 90.4318, 'basabo|bashabo', 'বাসাবো'],
  ['Mugda', 23.7312, 90.4320, 'mugda|mugdapara|mugda para', 'মুগদা'],
  ['Maniknagar', 23.7295, 90.4250, 'maniknagar|manik nagar', 'মানিকনগর'],
  ['East West University', 23.7638, 90.4290, 'ewu|east west university', 'ইস্ট ওয়েস্ট ইউনিভার্সিটি'],
  ['North South University', 23.8152, 90.4257, 'nsu|north south university|north south', 'নর্থ সাউথ ইউনিভার্সিটি'],
  ['BRAC University', 23.7806, 90.4066, 'brac university|bracu|brac uni', 'ব্র্যাক ইউনিভার্সিটি'],
  ['Independent University', 23.8139, 90.4321, 'iub|independent university', 'আইইউবি'],
  ['AIUB', 23.8184, 90.4210, 'aiub', 'এআইইউবি'],
  // Motijheel, Paltan, old Dhaka
  ['Kamalapur', 23.7326, 90.4262, 'kamalapur|kamalapur station|kamlapur|kamalapur railway station', 'কমলাপুর'],
  ['Sayedabad', 23.7128, 90.4235, 'sayedabad|saidabad|sayedabad bus terminal', 'সায়েদাবাদ'],
  ['Gulistan', 23.7222, 90.4123, 'gulistan|gulistan overbridge', 'গুলিস্তান'],
  ['Paltan', 23.7345, 90.4120, 'paltan|purana paltan|paltan thana', 'পল্টন'],
  ['Arambagh', 23.7336, 90.4177, 'arambagh|arambag', 'আরামবাগ'],
  ['Dilkusha', 23.7300, 90.4180, 'dilkusha', 'দিলকুশা'],
  ['Bijoynagar', 23.7371, 90.4073, 'bijoynagar|bijoy nagar', 'বিজয়নগর'],
  ['Baitul Mukarram', 23.7314, 90.4116, 'baitul mukarram|baitul mukarram mosque', 'বায়তুল মোকাররম'],
  ['National Stadium', 23.7285, 90.4140, 'national stadium|bangabandhu stadium', 'জাতীয় স্টেডিয়াম'],
  ['Wari', 23.7182, 90.4145, 'wari|wari thana', 'ওয়ারী'],
  ['Sutrapur', 23.7120, 90.4170, 'sutrapur', 'সূত্রাপুর'],
  ['Gendaria', 23.7027, 90.4231, 'gendaria', 'গেন্ডারিয়া'],
  ['Sadarghat', 23.7080, 90.4090, 'sadarghat|sadar ghat|sadarghat launch terminal|launch terminal', 'সদরঘাট'],
  ['Old Dhaka', 23.7140, 90.4070, 'old dhaka|puran dhaka|purana dhaka|purano dhaka', 'পুরান ঢাকা|পুরানো ঢাকা'],
  ['Ahsan Manzil', 23.7085, 90.4067, 'ahsan manzil|pink palace', 'আহসান মঞ্জিল'],
  ['Chawkbazar', 23.7152, 90.4003, 'chawkbazar|chawk bazar|chowkbazar', 'চকবাজার'],
  ['Lalbagh', 23.7188, 90.3881, 'lalbagh|lalbagh fort|lalbag', 'লালবাগ'],
  ['Azimpur', 23.7266, 90.3877, 'azimpur|azimpur colony', 'আজিমপুর'],
  // south and east
  ['Demra', 23.7170, 90.4568, 'demra', 'ডেমরা'],
  ['Dania', 23.6970, 90.4420, 'dania', 'ডানিয়া'],
  ['Konapara', 23.7006, 90.4440, 'konapara', 'কোনাপাড়া'],
  ['Shyampur', 23.6990, 90.4300, 'shyampur', 'শ্যামপুর'],
  // outside the city: recognised so the assistant can say so honestly
  ['Keraniganj', 23.6914, 90.3777, 'keraniganj|keranigonj', 'কেরানীগঞ্জ'],
  ['Narayanganj', 23.6238, 90.5000, 'narayanganj|narayangonj', 'নারায়ণগঞ্জ'],
  ['Savar', 23.8583, 90.2667, 'savar', 'সাভার'],
  ['Ashulia', 23.8860, 90.2870, 'ashulia', 'আশুলিয়া'],
  ['Gazipur', 23.9999, 90.4203, 'gazipur|joydebpur', 'গাজীপুর'],
];

const PLACES = ROWS.map(([name, lat, lng, aliases, bn]) => ({
  id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
  name, lat, lng,
  aliases: [name.toLowerCase(), ...aliases.split('|'), ...(bn ? bn.split('|') : [])],
}));

const MAX_NEAR_KM = 6; // beyond this a place is outside what the network can reach

// Nearest stop to a point. A major hub wins over a minor bus stop if it is almost as close, because more lines serve it.
function nearestHub(hubs, lat, lng, within) {
  const p = { lat, lng };
  const ranked = hubs.map(h => ({ hub: h, km: km(p, h) })).sort((a, b) => a.km - b.km);
  const best = ranked[0];
  if (!best) return null;
  const major = ranked.find(r => r.hub.major !== false);
  const pick = major && major.km <= best.km + 0.7 ? major : best;
  const out = { hub: pick.hub.id, name: pick.hub.name, km: Math.round(pick.km * 10) / 10 };
  return within && out.km > within ? { ...out, outside: true } : out;
}

// All places resolved against the current hubs, cached per hub list.
const cache = new WeakMap();
function index(hubs) {
  const key = hubs.length;
  const hit = cache.get(hubs);
  if (hit && hit.key === key) return hit.list;
  const list = PLACES.map(p => ({ ...p, near: nearestHub(hubs, p.lat, p.lng, MAX_NEAR_KM) }));
  cache.set(hubs, { key, list });
  return list;
}

const byId = (hubs, id) => index(hubs).find(p => p.id === id) || null;

module.exports = { PLACES, MAX_NEAR_KM, nearestHub, index, byId };

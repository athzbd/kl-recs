/* Turning a Malaysian formatted address into a neighbourhood name.
 * Shared by resolve-place-ids.mjs and check-branches.mjs so the two can never
 * disagree about what counts as "Bangsar". */

/* Google writes the same street as "Jalan Alor", "Jln Alor" or "Jln. Alor",
   so every street name is matched through this. Missing it silently cost
   thirteen entries their area. */
const JL = 'j(?:ala|l)?n\\.?\\s+';
const st = (name) => new RegExp(JL + name, 'i');

/* Address substring -> canonical area name. Most specific first: the first
   match wins, so "Bukit Damansara" must be tested before "Damansara". */
export const AREA_PATTERNS = [
  [/taman tun dr(?:\.)? ismail|\bTTDI\b/i, 'TTDI'],
  [/bukit damansara|damansara heights|pusat bandar damansara/i, 'Damansara Heights'],
  // Publika before Mont Kiara: Solaris Dutamas is its own destination locally,
  // and "Solaris Mont Kiara" is a different place that must not be caught here.
  [/solaris dutamas|publika/i, 'Publika'],
  [st('dutamas'), 'Publika'],
  [/mont'? kiara|solaris/i, 'Mont Kiara'],
  [/sri hartamas|desa hartamas|hartamas/i, 'Sri Hartamas'],
  [/rawang/i, 'Rawang'],
  [/tasik perdana|perdana botanical|lake gardens/i, 'Lake Gardens'],
  [st('lembah'), 'Lake Gardens'],
  [st('cenderasari'), 'Lake Gardens'],
  [st('tuanku abdul halim'), 'Lake Gardens'],
  [/taman desa/i, 'Taman Desa'],
  [/bukit bintang|changkat|\bimbi\b|bukit ceylon/i, 'Bukit Bintang'],
  [st('alor'), 'Bukit Bintang'],
  [st('raja chulan'), 'Bukit Bintang'],
  [/kampung baru|kampung bharu/i, 'Kampung Baru'],
  [/petaling street|chinatown|city centre.*50000/i, 'Chinatown'],
  [st('sultan(?!\\s+azlan)'), 'Chinatown'],
  [st('petaling'), 'Chinatown'],
  [st('panggong'), 'Chinatown'],
  [st('balai polis'), 'Chinatown'],
  [/bangsar/i, 'Bangsar'],
  [/brickfields|\bKL Sentral\b|kuala lumpur sentral/i, 'Brickfields'],
  [/\bpudu\b/i, 'Pudu'],
  [/sentul|chow kit|titiwangsa/i, 'Sentul'],
  [st('yap ah shak'), 'Sentul'],
  [st('sultan azlan'), 'Sentul'],
  [/cheras|maluri|taman connaught/i, 'Cheras'],
  [/ampang|keramat/i, 'Ampang'],
  [/mid valley|bangsar south|kerinchi/i, 'Mid Valley'],
  [/\bss\s?\d|petaling jaya|\bPJ\b|damansara utama|uptown|taman sea|sea park|paramount/i, 'Petaling Jaya'],
  [/subang/i, 'Subang'],
  [/shah alam/i, 'Shah Alam'],
  [/batu caves|selayang/i, 'Batu Caves'],
  [/bukit jalil|sri petaling/i, 'Bukit Jalil'],
  [/setapak|wangsa maju|danau kota/i, 'Setapak'],
  [/kepong|menjalara/i, 'Kepong'],
  [/damansara/i, 'Damansara'],
  [/klcc|kuala lumpur city centre|tun razak exchange/i, 'KLCC'],
  [st('p\\.? ?ramlee'), 'KLCC'],
  [st('binjai'), 'KLCC'],
  [st('kia peng'), 'KLCC'],
  [st('conlay'), 'KLCC'],
  [st('tun razak'), 'KLCC'],
  [/city centre/i, 'KLCC'],
];

export function areaFromAddress(address) {
  if (!address) return null;
  for (const [pattern, name] of AREA_PATTERNS) {
    if (pattern.test(address)) return name;
  }
  return null;
}

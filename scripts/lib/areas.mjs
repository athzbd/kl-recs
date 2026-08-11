/* Turning a Malaysian formatted address into a neighbourhood name.
 * Shared by resolve-place-ids.mjs and check-branches.mjs so the two can never
 * disagree about what counts as "Bangsar". */

/* Address substring -> canonical area name. Most specific first: the first
   match wins, so "Bukit Damansara" must be tested before "Damansara". */
export const AREA_PATTERNS = [
  [/taman tun dr(?:\.)? ismail|\bTTDI\b/i, 'TTDI'],
  [/bukit damansara|damansara heights|pusat bandar damansara/i, 'Damansara Heights'],
  // Publika before Mont Kiara: Solaris Dutamas is its own destination locally,
  // and "Solaris Mont Kiara" is a different place that must not be caught here.
  [/solaris dutamas|publika|j(?:ala)?ln? dutamas/i, 'Publika'],
  [/mont'? kiara|solaris/i, 'Mont Kiara'],
  [/rawang/i, 'Rawang'],
  [/sri hartamas|desa hartamas|hartamas/i, 'Sri Hartamas'],
  [/bukit bintang|changkat|jalan alor|\bimbi\b/i, 'Bukit Bintang'],
  [/kampung baru|kampung bharu/i, 'Kampung Baru'],
  [/petaling street|jalan sultan|jalan petaling|chinatown|jalan panggong|jalan balai polis/i, 'Chinatown'],
  [/bangsar/i, 'Bangsar'],
  [/brickfields|\bKL Sentral\b|kuala lumpur sentral/i, 'Brickfields'],
  [/\bpudu\b/i, 'Pudu'],
  [/sentul|chow kit|jalan yap ah shak/i, 'Sentul'],
  [/cheras|maluri|taman connaught/i, 'Cheras'],
  [/ampang|keramat/i, 'Ampang'],
  [/mid valley|bangsar south|kerinchi/i, 'Mid Valley'],
  [/\bss\s?\d|petaling jaya|\bPJ\b|damansara utama|uptown|taman sea|sea park|paramount/i, 'Petaling Jaya'],
  [/subang/i, 'Subang'],
  [/shah alam/i, 'Shah Alam'],
  [/batu caves|selayang/i, 'Batu Caves'],
  [/bukit jalil|sri petaling/i, 'Bukit Jalil'],
  [/setapak|wangsa maju|danau kota|titiwangsa/i, 'Setapak'],
  [/kepong|menjalara/i, 'Kepong'],
  [/damansara/i, 'Damansara'],
  [/klcc|jalan p ramlee|jalan binjai|city centre|kuala lumpur city centre|jalan tun razak|tun razak exchange/i, 'KLCC'],
];

export function areaFromAddress(address) {
  if (!address) return null;
  for (const [pattern, name] of AREA_PATTERNS) {
    if (pattern.test(address)) return name;
  }
  return null;
}

/**
 * ISO 3166-1 alpha-3 country codes → English names. Google Search Console
 * returns country as a lowercase alpha-3 code (e.g. "ind", "usa"); this maps
 * them to readable names for the Countries breakdown.
 */
const COUNTRY_NAMES: Record<string, string> = {
  afg: "Afghanistan", ala: "Åland Islands", alb: "Albania", dza: "Algeria", asm: "American Samoa",
  and: "Andorra", ago: "Angola", aia: "Anguilla", ata: "Antarctica", atg: "Antigua & Barbuda",
  arg: "Argentina", arm: "Armenia", abw: "Aruba", aus: "Australia", aut: "Austria",
  aze: "Azerbaijan", bhs: "Bahamas", bhr: "Bahrain", bgd: "Bangladesh", brb: "Barbados",
  blr: "Belarus", bel: "Belgium", blz: "Belize", ben: "Benin", bmu: "Bermuda",
  btn: "Bhutan", bol: "Bolivia", bes: "Caribbean Netherlands", bih: "Bosnia & Herzegovina", bwa: "Botswana",
  bvt: "Bouvet Island", bra: "Brazil", iot: "British Indian Ocean Territory", brn: "Brunei", bgr: "Bulgaria",
  bfa: "Burkina Faso", bdi: "Burundi", cpv: "Cape Verde", khm: "Cambodia", cmr: "Cameroon",
  can: "Canada", cym: "Cayman Islands", caf: "Central African Republic", tcd: "Chad", chl: "Chile",
  chn: "China", cxr: "Christmas Island", cck: "Cocos (Keeling) Islands", col: "Colombia", com: "Comoros",
  cog: "Congo - Brazzaville", cod: "Congo - Kinshasa", cok: "Cook Islands", cri: "Costa Rica", civ: "Côte d'Ivoire",
  hrv: "Croatia", cub: "Cuba", cuw: "Curaçao", cyp: "Cyprus", cze: "Czechia",
  dnk: "Denmark", dji: "Djibouti", dma: "Dominica", dom: "Dominican Republic", ecu: "Ecuador",
  egy: "Egypt", slv: "El Salvador", gnq: "Equatorial Guinea", eri: "Eritrea", est: "Estonia",
  swz: "Eswatini", eth: "Ethiopia", flk: "Falkland Islands", fro: "Faroe Islands", fji: "Fiji",
  fin: "Finland", fra: "France", guf: "French Guiana", pyf: "French Polynesia", atf: "French Southern Territories",
  gab: "Gabon", gmb: "Gambia", geo: "Georgia", deu: "Germany", gha: "Ghana",
  gib: "Gibraltar", grc: "Greece", grl: "Greenland", grd: "Grenada", glp: "Guadeloupe",
  gum: "Guam", gtm: "Guatemala", ggy: "Guernsey", gin: "Guinea", gnb: "Guinea-Bissau",
  guy: "Guyana", hti: "Haiti", hmd: "Heard & McDonald Islands", vat: "Vatican City", hnd: "Honduras",
  hkg: "Hong Kong", hun: "Hungary", isl: "Iceland", ind: "India", idn: "Indonesia",
  irn: "Iran", irq: "Iraq", irl: "Ireland", imn: "Isle of Man", isr: "Israel",
  ita: "Italy", jam: "Jamaica", jpn: "Japan", jey: "Jersey", jor: "Jordan",
  kaz: "Kazakhstan", ken: "Kenya", kir: "Kiribati", prk: "North Korea", kor: "South Korea",
  kwt: "Kuwait", kgz: "Kyrgyzstan", lao: "Laos", lva: "Latvia", lbn: "Lebanon",
  lso: "Lesotho", lbr: "Liberia", lby: "Libya", lie: "Liechtenstein", ltu: "Lithuania",
  lux: "Luxembourg", mac: "Macao", mdg: "Madagascar", mwi: "Malawi", mys: "Malaysia",
  mdv: "Maldives", mli: "Mali", mlt: "Malta", mhl: "Marshall Islands", mtq: "Martinique",
  mrt: "Mauritania", mus: "Mauritius", myt: "Mayotte", mex: "Mexico", fsm: "Micronesia",
  mda: "Moldova", mco: "Monaco", mng: "Mongolia", mne: "Montenegro", msr: "Montserrat",
  mar: "Morocco", moz: "Mozambique", mmr: "Myanmar (Burma)", nam: "Namibia", nru: "Nauru",
  npl: "Nepal", nld: "Netherlands", ncl: "New Caledonia", nzl: "New Zealand", nic: "Nicaragua",
  ner: "Niger", nga: "Nigeria", niu: "Niue", nfk: "Norfolk Island", mkd: "North Macedonia",
  mnp: "Northern Mariana Islands", nor: "Norway", omn: "Oman", pak: "Pakistan", plw: "Palau",
  pse: "Palestine", pan: "Panama", png: "Papua New Guinea", pry: "Paraguay", per: "Peru",
  phl: "Philippines", pcn: "Pitcairn Islands", pol: "Poland", prt: "Portugal", pri: "Puerto Rico",
  qat: "Qatar", reu: "Réunion", rou: "Romania", rus: "Russia", rwa: "Rwanda",
  blm: "St. Barthélemy", shn: "St. Helena", kna: "St. Kitts & Nevis", lca: "St. Lucia", maf: "St. Martin",
  spm: "St. Pierre & Miquelon", vct: "St. Vincent & Grenadines", wsm: "Samoa", smr: "San Marino", stp: "São Tomé & Príncipe",
  sau: "Saudi Arabia", sen: "Senegal", srb: "Serbia", syc: "Seychelles", sle: "Sierra Leone",
  sgp: "Singapore", sxm: "Sint Maarten", svk: "Slovakia", svn: "Slovenia", slb: "Solomon Islands",
  som: "Somalia", zaf: "South Africa", sgs: "South Georgia & South Sandwich Islands", ssd: "South Sudan", esp: "Spain",
  lka: "Sri Lanka", sdn: "Sudan", sur: "Suriname", sjm: "Svalbard & Jan Mayen", swe: "Sweden",
  che: "Switzerland", syr: "Syria", twn: "Taiwan", tjk: "Tajikistan", tza: "Tanzania",
  tha: "Thailand", tls: "Timor-Leste", tgo: "Togo", tkl: "Tokelau", ton: "Tonga",
  tto: "Trinidad & Tobago", tun: "Tunisia", tur: "Turkey", tkm: "Turkmenistan", tca: "Turks & Caicos Islands",
  tuv: "Tuvalu", uga: "Uganda", ukr: "Ukraine", are: "United Arab Emirates", gbr: "United Kingdom",
  usa: "United States", umi: "U.S. Outlying Islands", ury: "Uruguay", uzb: "Uzbekistan", vut: "Vanuatu",
  ven: "Venezuela", vnm: "Vietnam", vgb: "British Virgin Islands", vir: "U.S. Virgin Islands", wlf: "Wallis & Futuna",
  esh: "Western Sahara", yem: "Yemen", zmb: "Zambia", zwe: "Zimbabwe", xkx: "Kosovo",
  zzz: "Unknown region",
};

/** Full country name for a GSC alpha-3 code; falls back to the uppercased code. */
export function countryName(code?: string | null): string {
  if (!code) return "(not set)";
  return COUNTRY_NAMES[code.toLowerCase()] ?? code.toUpperCase();
}

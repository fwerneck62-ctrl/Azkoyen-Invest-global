export interface LocalValidationResult {
  valid: boolean;
  countryCode: string;
  documentType: string;
  normalized: string;
  formatted: string;
  reason?: string;
}

const onlyDigits = (s: string) => s.replace(/\D/g, '');
const cleanAlnum = (s: string) => s.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

function luhnCheck(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function validateBrazilCPF(raw: string): LocalValidationResult {
  const d = onlyDigits(raw);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) {
    return {
      valid: false,
      countryCode: 'BR',
      documentType: 'CPF',
      normalized: d,
      formatted: d,
      reason: 'CPF inválido (deve conter 11 dígitos válidos e não repetidos).',
    };
  }
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(d[i]) * (10 - i);
  let d1 = 11 - (sum % 11);
  if (d1 >= 10) d1 = 0;
  if (d1 !== Number(d[9])) {
    return { valid: false, countryCode: 'BR', documentType: 'CPF', normalized: d, formatted: d, reason: 'Dígito verificador do CPF inválido.' };
  }
  sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(d[i]) * (11 - i);
  let d2 = 11 - (sum % 11);
  if (d2 >= 10) d2 = 0;
  if (d2 !== Number(d[10])) {
    return { valid: false, countryCode: 'BR', documentType: 'CPF', normalized: d, formatted: d, reason: 'Dígito verificador do CPF inválido.' };
  }
  const formatted = `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9, 11)}`;
  return { valid: true, countryCode: 'BR', documentType: 'CPF', normalized: d, formatted };
}

export function validateBrazilCNPJ(raw: string): LocalValidationResult {
  const d = onlyDigits(raw);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) {
    return { valid: false, countryCode: 'BR', documentType: 'CNPJ', normalized: d, formatted: d, reason: 'CNPJ inválido (14 dígitos obrigatórios).' };
  }
  const calcDigit = (base: string, weights: number[]) => {
    let sum = 0;
    for (let i = 0; i < weights.length; i++) sum += Number(base[i]) * weights[i];
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };
  const d1 = calcDigit(d.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calcDigit(d.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (d1 !== Number(d[12]) || d2 !== Number(d[13])) {
    return { valid: false, countryCode: 'BR', documentType: 'CNPJ', normalized: d, formatted: d, reason: 'Dígito verificador do CNPJ inválido.' };
  }
  const formatted = `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12, 14)}`;
  return { valid: true, countryCode: 'BR', documentType: 'CNPJ', normalized: d, formatted };
}

export function validatePortugalNIF(raw: string, docType = 'NIF'): LocalValidationResult {
  const d = onlyDigits(raw);
  if (d.length !== 9) {
    return { valid: false, countryCode: 'PT', documentType: docType, normalized: d, formatted: d, reason: 'NIF/NIPC português deve conter 9 dígitos.' };
  }
  const validStarts = ['1', '2', '3', '5', '6', '8'];
  const validTwo = ['45', '70', '71', '72', '74', '75', '77', '78', '79', '90', '91', '98', '99'];
  if (!validStarts.includes(d[0]) && !validTwo.includes(d.slice(0, 2))) {
    return { valid: false, countryCode: 'PT', documentType: docType, normalized: d, formatted: d, reason: 'Prefixo de NIF/NIPC inválido.' };
  }
  let total = 0;
  for (let i = 0; i < 8; i++) total += Number(d[i]) * (9 - i);
  const mod = total % 11;
  const check = mod < 2 ? 0 : 11 - mod;
  if (check !== Number(d[8])) {
    return { valid: false, countryCode: 'PT', documentType: docType, normalized: d, formatted: d, reason: 'Dígito de controlo do NIF inválido.' };
  }
  return { valid: true, countryCode: 'PT', documentType: docType, normalized: d, formatted: `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 9)}` };
}

export function validateSpainDoc(raw: string, docType = 'DNI'): LocalValidationResult {
  const s = cleanAlnum(raw);
  const letters = 'TRWAGMYFPDXBNJZSQVHLCKE';
  if (docType === 'DNI' || /^\d{8}[A-Z]$/.test(s)) {
    if (!/^\d{8}[A-Z]$/.test(s)) {
      return { valid: false, countryCode: 'ES', documentType: 'DNI', normalized: s, formatted: s, reason: 'Formato DNI inválido (8 dígitos + letra).' };
    }
    const expected = letters[Number(s.slice(0, 8)) % 23];
    if (expected !== s[8]) {
      return { valid: false, countryCode: 'ES', documentType: 'DNI', normalized: s, formatted: s, reason: 'Letra de control del DNI incorrecta.' };
    }
    return { valid: true, countryCode: 'ES', documentType: 'DNI', normalized: s, formatted: s };
  }
  if (docType === 'NIE' || /^[XYZ]\d{7}[A-Z]$/.test(s)) {
    if (!/^[XYZ]\d{7}[A-Z]$/.test(s)) {
      return { valid: false, countryCode: 'ES', documentType: 'NIE', normalized: s, formatted: s, reason: 'Formato NIE inválido (X/Y/Z + 7 dígitos + letra).' };
    }
    const prefixMap: Record<string, string> = { X: '0', Y: '1', Z: '2' };
    const num = Number(prefixMap[s[0]] + s.slice(1, 8));
    if (letters[num % 23] !== s[8]) {
      return { valid: false, countryCode: 'ES', documentType: 'NIE', normalized: s, formatted: s, reason: 'Letra de control del NIE incorrecta.' };
    }
    return { valid: true, countryCode: 'ES', documentType: 'NIE', normalized: s, formatted: s };
  }
  // CIF
  if (!/^[ABCDEFGHJKLMNPQRSUVW]\d{7}[0-9A-J]$/.test(s)) {
    return { valid: false, countryCode: 'ES', documentType: 'CIF', normalized: s, formatted: s, reason: 'Formato CIF inválido.' };
  }
  let evenSum = 0;
  let oddSum = 0;
  for (let i = 1; i <= 7; i++) {
    const n = Number(s[i]);
    if (i % 2 === 0) {
      evenSum += n;
    } else {
      const dbl = n * 2;
      oddSum += Math.floor(dbl / 10) + (dbl % 10);
    }
  }
  const total = evenSum + oddSum;
  const ctrlNum = (10 - (total % 10)) % 10;
  const ctrlLetters = 'JABCDEFGHI';
  const expectedCtrl = /[ABEH]/.test(s[0]) ? String(ctrlNum) : /[KPQRSW]/.test(s[0]) ? ctrlLetters[ctrlNum] : `${ctrlNum}${ctrlLetters[ctrlNum]}`;
  if (!expectedCtrl.includes(s[8])) {
    return { valid: false, countryCode: 'ES', documentType: 'CIF', normalized: s, formatted: s, reason: 'Dígito de control del CIF incorrecto.' };
  }
  return { valid: true, countryCode: 'ES', documentType: 'CIF', normalized: s, formatted: s };
}

export function validateMexicoDoc(raw: string, docType = 'RFC'): LocalValidationResult {
  const s = cleanAlnum(raw);
  if (docType === 'CURP') {
    if (!/^[A-Z][AEIOUX][A-Z]{2}\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[HM](AS|BC|BS|CC|CL|CM|CS|CH|DF|DG|GT|GR|HG|JC|MC|MN|MS|NT|NL|OC|PL|QT|QR|SP|SL|SR|TC|TS|TL|VZ|YN|ZS|NE)[B-DF-HJ-NP-TV-Z]{3}[0-9A-Z]\d$/.test(s)) {
      return { valid: false, countryCode: 'MX', documentType: 'CURP', normalized: s, formatted: s, reason: 'CURP inválido según estructura RENAPO.' };
    }
    const dict = '0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ';
    let sum = 0;
    for (let i = 0; i < 17; i++) sum += dict.indexOf(s[i]) * (18 - i);
    const check = (10 - (sum % 10)) % 10;
    if (check !== Number(s[17])) {
      return { valid: false, countryCode: 'MX', documentType: 'CURP', normalized: s, formatted: s, reason: 'Dígito verificador CURP incorrecto.' };
    }
    return { valid: true, countryCode: 'MX', documentType: 'CURP', normalized: s, formatted: s };
  }
  if (!/^([A-ZÑ&]{3,4})\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[A-Z\d]{2}[0-9A]$/.test(s)) {
    return { valid: false, countryCode: 'MX', documentType: 'RFC', normalized: s, formatted: s, reason: 'RFC inválido según estructura SAT.' };
  }
  return { valid: true, countryCode: 'MX', documentType: 'RFC', normalized: s, formatted: s };
}

export function validateArgentinaCUIT(raw: string, docType = 'CUIT'): LocalValidationResult {
  const d = onlyDigits(raw);
  if (d.length !== 11) {
    return { valid: false, countryCode: 'AR', documentType: docType, normalized: d, formatted: d, reason: 'CUIT/CUIL debe tener 11 dígitos.' };
  }
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(d[i]) * weights[i];
  let check = 11 - (sum % 11);
  if (check === 11) check = 0;
  if (check === 10) check = 9;
  if (check !== Number(d[10])) {
    return { valid: false, countryCode: 'AR', documentType: docType, normalized: d, formatted: d, reason: 'Dígito verificador de CUIT/CUIL inválido.' };
  }
  return { valid: true, countryCode: 'AR', documentType: docType, normalized: d, formatted: `${d.slice(0, 2)}-${d.slice(2, 10)}-${d[10]}` };
}

export function validateUSDoc(raw: string, docType = 'SSN'): LocalValidationResult {
  const d = onlyDigits(raw);
  if (d.length !== 9) {
    return { valid: false, countryCode: 'US', documentType: docType, normalized: d, formatted: d, reason: `${docType} must contain exactly 9 digits.` };
  }
  if (docType === 'EIN') {
    const prefix = Number(d.slice(0, 2));
    if (prefix === 0 || [7, 8, 9, 17, 18, 19, 28, 29, 49, 69, 70, 78, 79, 89, 96, 97].includes(prefix)) {
      return { valid: false, countryCode: 'US', documentType: 'EIN', normalized: d, formatted: d, reason: 'Invalid IRS EIN prefix.' };
    }
    return { valid: true, countryCode: 'US', documentType: 'EIN', normalized: d, formatted: `${d.slice(0, 2)}-${d.slice(2)}` };
  }
  const area = Number(d.slice(0, 3));
  const group = Number(d.slice(3, 5));
  const serial = Number(d.slice(5, 9));
  if (area === 0 || area === 666 || area >= 900 || group === 0 || serial === 0 || /^(\d)\1{8}$/.test(d)) {
    return { valid: false, countryCode: 'US', documentType: docType, normalized: d, formatted: d, reason: 'Invalid SSN / ITIN area, group, or serial number.' };
  }
  if (docType === 'ITIN' && d[0] !== '9') {
    return { valid: false, countryCode: 'US', documentType: 'ITIN', normalized: d, formatted: d, reason: 'ITIN must begin with digit 9.' };
  }
  return { valid: true, countryCode: 'US', documentType: docType, normalized: d, formatted: `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` };
}

export function validateUKDoc(raw: string, docType = 'NINO'): LocalValidationResult {
  const s = cleanAlnum(raw);
  if (docType === 'UTR') {
    const d = onlyDigits(raw);
    if (d.length !== 10) {
      return { valid: false, countryCode: 'GB', documentType: 'UTR', normalized: d, formatted: d, reason: 'UK UTR must be 10 digits.' };
    }
    const w = [6, 7, 8, 9, 10, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += Number(d[i + 1]) * w[i];
    const checkList = [2, 1, 9, 8, 7, 6, 5, 4, 3, 2, 1];
    if (checkList[sum % 11] !== Number(d[0])) {
      return { valid: false, countryCode: 'GB', documentType: 'UTR', normalized: d, formatted: d, reason: 'Invalid HMRC UTR check digit.' };
    }
    return { valid: true, countryCode: 'GB', documentType: 'UTR', normalized: d, formatted: d };
  }
  if (!/^(?!BG|GB|NK|KN|TN|NT|ZZ)[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z]\d{6}[A-D]$/.test(s)) {
    return { valid: false, countryCode: 'GB', documentType: 'NINO', normalized: s, formatted: s, reason: 'Invalid UK National Insurance Number format or HMRC prefix.' };
  }
  return { valid: true, countryCode: 'GB', documentType: 'NINO', normalized: s, formatted: `${s.slice(0, 2)} ${s.slice(2, 4)} ${s.slice(4, 6)} ${s.slice(6, 8)} ${s[8]}` };
}

export function validateGermanyDoc(raw: string, docType = 'STEUERID'): LocalValidationResult {
  const s = cleanAlnum(raw);
  if (docType === 'USTID') {
    if (!/^DE\d{9}$/.test(s)) {
      return { valid: false, countryCode: 'DE', documentType: 'USTID', normalized: s, formatted: s, reason: 'USt-IdNr muss mit DE + 9 Ziffern beginnen.' };
    }
    return { valid: true, countryCode: 'DE', documentType: 'USTID', normalized: s, formatted: s };
  }
  const d = onlyDigits(raw);
  if (d.length !== 11 || d[0] === '0') {
    return { valid: false, countryCode: 'DE', documentType: 'STEUERID', normalized: d, formatted: d, reason: 'Steuer-ID muss aus 11 Ziffern bestehen.' };
  }
  // ISO/IEC 7064 Mod 11,10 check digit on 11th digit
  let prod = 10;
  for (let i = 0; i < 10; i++) {
    let sum = (Number(d[i]) + prod) % 10;
    if (sum === 0) sum = 10;
    prod = (2 * sum) % 11;
  }
  let check = 11 - prod;
  if (check === 10) check = 0;
  if (check !== Number(d[10])) {
    return { valid: false, countryCode: 'DE', documentType: 'STEUERID', normalized: d, formatted: d, reason: 'Prüfziffer der Steuer-ID ungültig.' };
  }
  return { valid: true, countryCode: 'DE', documentType: 'STEUERID', normalized: d, formatted: d };
}

export function validateFranceDoc(raw: string, docType = 'NIR'): LocalValidationResult {
  const s = cleanAlnum(raw);
  if (docType === 'SIREN') {
    const d = onlyDigits(raw);
    if (d.length !== 9 || !luhnCheck(d)) {
      return { valid: false, countryCode: 'FR', documentType: 'SIREN', normalized: d, formatted: d, reason: 'Numéro SIREN invalide (9 chiffres, contrôle Luhn).' };
    }
    return { valid: true, countryCode: 'FR', documentType: 'SIREN', normalized: d, formatted: d };
  }
  if (!/^[12]\d{12}\d{2}$/.test(s)) {
    return { valid: false, countryCode: 'FR', documentType: 'NIR', normalized: s, formatted: s, reason: 'Numéro NIR invalide (15 chiffres attendus).' };
  }
  const base = BigInt(s.slice(0, 13));
  const key = Number(s.slice(13, 15));
  if (Number(97n - (base % 97n)) !== key) {
    return { valid: false, countryCode: 'FR', documentType: 'NIR', normalized: s, formatted: s, reason: 'Clé de contrôle du NIR incorrecte.' };
  }
  return { valid: true, countryCode: 'FR', documentType: 'NIR', normalized: s, formatted: s };
}

export function validateItalyDoc(raw: string, docType = 'CF'): LocalValidationResult {
  const s = cleanAlnum(raw);
  if (docType === 'PIVA') {
    const d = onlyDigits(raw);
    if (d.length !== 11 || !luhnCheck(d)) {
      return { valid: false, countryCode: 'IT', documentType: 'PIVA', normalized: d, formatted: d, reason: 'Partita IVA non valida (11 cifre).' };
    }
    return { valid: true, countryCode: 'IT', documentType: 'PIVA', normalized: d, formatted: d };
  }
  if (!/^[A-Z]{6}\d{2}[A-EHLMPRST]\d{2}[A-Z\d]{4}[A-Z]$/.test(s)) {
    return { valid: false, countryCode: 'IT', documentType: 'CF', normalized: s, formatted: s, reason: 'Formato Codice Fiscale non valido (16 caratteri).' };
  }
  const oddMap: Record<string, number> = {
    '0': 1, '1': 0, '2': 5, '3': 7, '4': 9, '5': 13, '6': 15, '7': 17, '8': 19, '9': 21,
    A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18,
    N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
  };
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    const ch = s[i];
    if ((i + 1) % 2 === 1) {
      sum += oddMap[ch] ?? 0;
    } else {
      sum += /\d/.test(ch) ? Number(ch) : ch.charCodeAt(0) - 65;
    }
  }
  const expected = String.fromCharCode(65 + (sum % 26));
  if (expected !== s[15]) {
    return { valid: false, countryCode: 'IT', documentType: 'CF', normalized: s, formatted: s, reason: 'Carattere di controllo Codice Fiscale errato.' };
  }
  return { valid: true, countryCode: 'IT', documentType: 'CF', normalized: s, formatted: s };
}

export function validateCanadaSIN(raw: string): LocalValidationResult {
  const d = onlyDigits(raw);
  if (d.length !== 9 || d[0] === '0' || d[0] === '8' || !luhnCheck(d)) {
    return { valid: false, countryCode: 'CA', documentType: 'SIN', normalized: d, formatted: d, reason: 'Invalid Canadian SIN (9 digits, Luhn verification failed).' };
  }
  return { valid: true, countryCode: 'CA', documentType: 'SIN', normalized: d, formatted: `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6, 9)}` };
}

export function validateAustraliaDoc(raw: string, docType = 'TFN'): LocalValidationResult {
  const d = onlyDigits(raw);
  if (docType === 'ABN') {
    if (d.length !== 11) {
      return { valid: false, countryCode: 'AU', documentType: 'ABN', normalized: d, formatted: d, reason: 'ABN must have 11 digits.' };
    }
    const w = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
    let sum = (Number(d[0]) - 1) * w[0];
    for (let i = 1; i < 11; i++) sum += Number(d[i]) * w[i];
    if (sum % 89 !== 0) {
      return { valid: false, countryCode: 'AU', documentType: 'ABN', normalized: d, formatted: d, reason: 'Invalid ABN checksum (ATO Mod 89).' };
    }
    return { valid: true, countryCode: 'AU', documentType: 'ABN', normalized: d, formatted: `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8, 11)}` };
  }
  if (![8, 9].includes(d.length)) {
    return { valid: false, countryCode: 'AU', documentType: 'TFN', normalized: d, formatted: d, reason: 'TFN must be 8 or 9 digits.' };
  }
  const weights = d.length === 9 ? [1, 4, 3, 7, 5, 8, 6, 9, 10] : [10, 7, 8, 4, 6, 3, 5, 1];
  let sum = 0;
  for (let i = 0; i < d.length; i++) sum += Number(d[i]) * weights[i];
  if (sum % 11 !== 0) {
    return { valid: false, countryCode: 'AU', documentType: 'TFN', normalized: d, formatted: d, reason: 'Invalid TFN checksum (ATO Mod 11).' };
  }
  return { valid: true, countryCode: 'AU', documentType: 'TFN', normalized: d, formatted: d };
}

export function validateSwitzerlandAHV(raw: string): LocalValidationResult {
  const d = onlyDigits(raw);
  if (d.length !== 13 || !d.startsWith('756')) {
    return { valid: false, countryCode: 'CH', documentType: 'AHV', normalized: d, formatted: d, reason: 'AHV-Nr muss 13 Ziffern haben und mit 756 beginnen.' };
  }
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(d[i]) * (i % 2 === 0 ? 1 : 3);
  const check = (10 - (sum % 10)) % 10;
  if (check !== Number(d[12])) {
    return { valid: false, countryCode: 'CH', documentType: 'AHV', normalized: d, formatted: d, reason: 'Ungültige EAN-13 Prüfziffer der AHV-Nr.' };
  }
  return { valid: true, countryCode: 'CH', documentType: 'AHV', normalized: d, formatted: `${d.slice(0, 3)}.${d.slice(3, 7)}.${d.slice(7, 11)}.${d.slice(11, 13)}` };
}

export function validateUAEEmiratesId(raw: string): LocalValidationResult {
  const d = onlyDigits(raw);
  if (d.length !== 15 || !d.startsWith('784') || !luhnCheck(d)) {
    return { valid: false, countryCode: 'AE', documentType: 'EMIRATES_ID', normalized: d, formatted: d, reason: 'Invalid Emirates ID (15 digits starting with 784, Luhn verified).' };
  }
  return { valid: true, countryCode: 'AE', documentType: 'EMIRATES_ID', normalized: d, formatted: `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7, 14)}-${d[14]}` };
}

export function validateJapanMyNumber(raw: string): LocalValidationResult {
  const d = onlyDigits(raw);
  if (d.length !== 12) {
    return { valid: false, countryCode: 'JP', documentType: 'MYNUMBER', normalized: d, formatted: d, reason: 'マイナンバーは12桁の数字である必要があります。' };
  }
  let sum = 0;
  for (let n = 1; n <= 11; n++) {
    const p = Number(d[11 - n]);
    const q = n <= 6 ? n + 1 : n - 5;
    sum += p * q;
  }
  const rem = sum % 11;
  const check = rem <= 1 ? 0 : 11 - rem;
  if (check !== Number(d[11])) {
    return { valid: false, countryCode: 'JP', documentType: 'MYNUMBER', normalized: d, formatted: d, reason: 'マイナンバーの検査数字が無効です。' };
  }
  return { valid: true, countryCode: 'JP', documentType: 'MYNUMBER', normalized: d, formatted: d };
}

export function validateDocumentForCountry(
  countryCode: string,
  documentType: string,
  rawValue: string
): LocalValidationResult {
  const cc = (countryCode || 'BR').toUpperCase();
  const doc = (documentType || '').toUpperCase();
  const val = (rawValue || '').trim();

  if (!val) {
    return { valid: false, countryCode: cc, documentType: doc, normalized: '', formatted: '', reason: 'Documento obrigatório para validação.' };
  }

  switch (cc) {
    case 'BR':
      if (doc === 'CNPJ' || onlyDigits(val).length === 14) return validateBrazilCNPJ(val);
      return validateBrazilCPF(val);
    case 'US':
      return validateUSDoc(val, doc || 'SSN');
    case 'PT':
      return validatePortugalNIF(val, doc || 'NIF');
    case 'ES':
      return validateSpainDoc(val, doc || 'DNI');
    case 'MX':
      return validateMexicoDoc(val, doc || 'RFC');
    case 'AR':
      return validateArgentinaCUIT(val, doc || 'CUIT');
    case 'GB':
      return validateUKDoc(val, doc || 'NINO');
    case 'DE':
      return validateGermanyDoc(val, doc || 'STEUERID');
    case 'FR':
      return validateFranceDoc(val, doc || 'NIR');
    case 'IT':
      return validateItalyDoc(val, doc || 'CF');
    case 'CA':
      return validateCanadaSIN(val);
    case 'AU':
      return validateAustraliaDoc(val, doc || 'TFN');
    case 'CH':
      return validateSwitzerlandAHV(val);
    case 'AE':
      return validateUAEEmiratesId(val);
    case 'JP':
      return validateJapanMyNumber(val);
    default: {
      const cleaned = cleanAlnum(val);
      if (cleaned.length < 5 || cleaned.length > 24 || /^(.)\1+$/.test(cleaned)) {
        return { valid: false, countryCode: cc, documentType: doc || 'PASSPORT_TAX', normalized: cleaned, formatted: cleaned, reason: 'Invalid Passport or National Tax ID format.' };
      }
      return { valid: true, countryCode: cc, documentType: doc || 'PASSPORT_TAX', normalized: cleaned, formatted: cleaned };
    }
  }
}

export function validatePostalCodeForCountry(countryCode: string, rawPostal: string): boolean {
  const cc = (countryCode || 'BR').toUpperCase();
  const v = (rawPostal || '').trim().toUpperCase();
  if (!v) return true; // optional unless supplied
  const rules: Record<string, RegExp> = {
    BR: /^\d{5}-?\d{3}$/,
    US: /^\d{5}(-\d{4})?$/,
    PT: /^\d{4}-\d{3}$/,
    ES: /^\d{5}$/,
    MX: /^\d{5}$/,
    AR: /^[A-Z]?\d{4}[A-Z]{0,3}$/,
    GB: /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/,
    DE: /^\d{5}$/,
    FR: /^\d{5}$/,
    IT: /^\d{5}$/,
    CA: /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\s?\d[ABCEGHJ-NPRSTV-Z]\d$/,
    AU: /^\d{4}$/,
    CH: /^\d{4}$/,
    JP: /^\d{3}-?\d{4}$/,
  };
  return rules[cc] ? rules[cc].test(v) : v.length >= 3 && v.length <= 16;
}

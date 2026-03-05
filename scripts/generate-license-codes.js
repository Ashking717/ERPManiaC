const { createHash } = require('crypto');

const LICENSE_MAX_KEYS = 36;
const LICENSE_SECRET = 'ERPMANIA-LICENSE-2026';

function luhnIsValid(value) {
  if (!/^\d+$/.test(value)) {
    return false;
  }

  let sum = 0;
  let shouldDouble = false;

  for (let i = value.length - 1; i >= 0; i -= 1) {
    let digit = Number(value[i]);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
}

function luhnCheckDigit(base) {
  for (let digit = 0; digit <= 9; digit += 1) {
    if (luhnIsValid(`${base}${digit}`)) {
      return String(digit);
    }
  }

  return '0';
}

function generateLicenseCode(index) {
  const slot = String(index).padStart(2, '0');
  const hash = createHash('sha256')
    .update(`${LICENSE_SECRET}:${slot}:ERP-GROCERY-OFFLINE`)
    .digest('hex');

  const numericBody = (BigInt(`0x${hash.slice(0, 15)}`) % 1000000000n).toString().padStart(9, '0');
  const base11 = `${slot}${numericBody}`;
  const checksum = luhnCheckDigit(base11);
  return `${base11}${checksum}`;
}

for (let index = 1; index <= LICENSE_MAX_KEYS; index += 1) {
  const code = generateLicenseCode(index);
  console.log(`${String(index).padStart(2, '0')}: ${code}`);
}

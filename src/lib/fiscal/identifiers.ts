// Validação estrutural e de dígitos verificadores. Não consulta cadastro ou situação fiscal.
// CNPJ: RFB, manual-dv-cnpj.pdf (ASCII - 48, módulo 11).
export const normalizeDocument = (value: string) =>
  value.replace(/[.\-/\s]/g, "").toUpperCase();

export function isValidCnpj(value: string): boolean {
  if (/[^A-Za-z0-9.\-/\s]/.test(value)) return false;
  const text = normalizeDocument(value);
  if (!/^[A-Z0-9]{12}\d{2}$/.test(text) || /^(.)\1{13}$/.test(text))
    return false;
  const calculate = (base: string) => {
    let weight = base.length - 7;
    const sum = [...base].reduce((total, char) => {
      const result = total + (char.charCodeAt(0) - 48) * weight;
      weight = weight === 2 ? 9 : weight - 1;
      return result;
    }, 0);
    const remainder = sum % 11;
    return String(remainder < 2 ? 0 : 11 - remainder);
  };
  const base = text.slice(0, 12);
  const first = calculate(base);
  return text === base + first + calculate(base + first);
}

export function isValidCpf(value: string): boolean {
  if (/[^\d.\-\s]/.test(value)) return false;
  const text = normalizeDocument(value);
  if (!/^\d{11}$/.test(text) || /^(.)\1{10}$/.test(text)) return false;
  const digit = (base: string) => {
    const sum = [...base].reduce(
      (total, char, index) => total + Number(char) * (base.length + 1 - index),
      0,
    );
    const remainder = (sum * 10) % 11;
    return String(remainder === 10 ? 0 : remainder);
  };
  const first = digit(text.slice(0, 9));
  return text === text.slice(0, 9) + first + digit(text.slice(0, 9) + first);
}

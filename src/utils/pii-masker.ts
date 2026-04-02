const patterns: Array<{ regex: RegExp; replacement: string }> = [
  // Email addresses (must be before IP to avoid partial matches)
  {
    regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    replacement: "[EMAIL]",
  },
  // IP addresses (must be before phone to avoid 192.168.1.1 matching as phone)
  { regex: /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g, replacement: "[IP]" },
  // Japanese phone numbers: 03-1234-5678, 090-1234-5678, 0120-123-456
  { regex: /0\d{1,4}-\d{1,4}-\d{3,4}/g, replacement: "[PHONE]" },
  // International phone: +81-3-1234-5678 (require + prefix to avoid false positives)
  {
    regex: /\+\d{1,3}[-.\s]\d{1,4}[-.\s]\d{1,4}[-.\s]?\d{0,4}/g,
    replacement: "[PHONE]",
  },
  // Katakana full names (two or more katakana words separated by space)
  { regex: /[\u30A0-\u30FF]{2,}[\s\u3000][\u30A0-\u30FF]{2,}/g, replacement: "[NAME]" },
];

export function maskPii(text: string): { masked: string; maskedFields: string[] } {
  const maskedFields: string[] = [];
  let result = text;

  for (const { regex, replacement } of patterns) {
    // Reset regex lastIndex for global patterns
    regex.lastIndex = 0;
    if (regex.test(result)) {
      maskedFields.push(replacement.replace(/[[\]]/g, ""));
      regex.lastIndex = 0;
      result = result.replace(regex, replacement);
    }
  }

  return { masked: result, maskedFields };
}

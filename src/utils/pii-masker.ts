const COMMON_SURNAMES = "佐藤|田中|鈴木|高橋|渡辺|伊藤|山本|中村|小林|加藤|吉田|山田|松本|井上|木村|林|清水|山口|阿部|池田|橋本|山下|石川|中島|前田|藤田|小川|岡田|村上|長谷川|近藤|石井|斎藤|坂本|遠藤|藤井|青木|福田|三浦|西村|太田|原|松田|中野|千葉|岩崎|河野|小野|田村|竹内";

const patterns: Array<{ regex: RegExp; replacement: string }> = [
  // Japanese kanji names with honorific suffix (さん, 様, 氏)
  {
    regex: /[\u4E00-\u9FFF]{2,4}(?:さん|さま|様|氏)/g,
    replacement: "[NAME]",
  },
  // Japanese full name with space: 漢字surname + space + 漢字given name
  {
    regex: /[\u4E00-\u9FFF]{2,3}[\s\u3000][\u4E00-\u9FFF]{1,3}/g,
    replacement: "[NAME]",
  },
  // Common Japanese surnames followed by optional given name characters
  {
    regex: new RegExp(`(?:${COMMON_SURNAMES})[\u4E00-\u9FFF]{1,3}`, "g"),
    replacement: "[NAME]",
  },
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

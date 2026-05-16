function parseJsonSafe(str) {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

function detectLanguage(text) {
  if (!text || typeof text !== "string") return "english";
  if ([...text].some((ch) => {
    const code = ch.codePointAt(0);
    return code >= 0x0600 && code <= 0x06FF;
  })) return "arabic";

  const francoNumbers = /\b\w*[32785640]\w*\b/.test(text);
  const francoWords = /\b(shu|yalla|kif|kifak|kifek|marhaba|ahla|ahlan|salam|3andi|3andak|baddak|bade|badi|hala2|halla2|hl2|kteer|kter|ktir|ma3|m3|la2|laa|fi|men|min|mn|3al|3l|lal|bl|bel|bil|byeji|bes|bas|shi|hek|inno|enno|yane|ya3ne|iza|lamma|kaman|kmn|3am|mshe|raye7|jaye|nhar|kel|eno|ana|inta|hiye|huwwe|howwe|mish|msh|ta2|2abel|sa7|ma7al|saret|7elo|7elwe|3anjad|tfaddal|yislam|zo2|wlek|wle|ya|habibi|habibte|ma32oul|2akid|akid|mbala|tfe|yiii|awww|heik)\b/i.test(text);
  if (francoNumbers || francoWords) return "franco";
  return "english";
}

function sanitizeText(value) {
  if (typeof value !== "string") return value;
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .trim();
}

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = {
  parseJsonSafe,
  detectLanguage,
  sanitizeText,
  asyncHandler,
};

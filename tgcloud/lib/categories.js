// NewsStudio 2026 — Category Definitions & Helpers
// Category classification and source routing

export const VALID_CATEGORIES = [
  'tech',
  'economy',
  'sport',
  'world',
  'social',
  'culture',
  'science',
  'other',
];

export const CATEGORY_LABELS = {
  tech: '💻 فناوری',
  economy: '📈 اقتصاد و بازار',
  sport: '⚽ ورزش',
  world: '🌍 بین‌الملل',
  social: '👥 جامعه',
  culture: '🎨 فرهنگ و هنر',
  science: '🔬 علم و دانش',
  other: '📌 سایر',
};

/**
 * Safely parses the categories column of a source.
 * If null, empty, or corrupt, defaults to all VALID_CATEGORIES enabled.
 * @param {string|string[]} raw
 * @returns {string[]} array of valid category keys
 */
export function parseSourceCategories(raw) {
  if (!raw) return [...VALID_CATEGORIES];
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(arr) && arr.length > 0) {
      const filtered = arr.filter((c) => VALID_CATEGORIES.includes(c));
      return filtered.length > 0 ? filtered : [...VALID_CATEGORIES];
    }
  } catch {}
  return [...VALID_CATEGORIES];
}

/**
 * Toggles a category in a source's category list.
 * If category is present, removes it (minimum 1 category retained).
 * If category is absent, adds it.
 * @param {string[]} currentList
 * @param {string} categoryKey
 * @returns {string[]} updated array
 */
export function toggleCategoryInList(currentList, categoryKey) {
  const list = parseSourceCategories(currentList);
  if (!VALID_CATEGORIES.includes(categoryKey)) return list;

  if (list.includes(categoryKey)) {
    if (list.length <= 1) {
      // Keep at least one category enabled
      return list;
    }
    return list.filter((c) => c !== categoryKey);
  } else {
    return [...list, categoryKey];
  }
}

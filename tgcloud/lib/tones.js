/**
 * Channel Tone Profiles (Channel Personality Engine)
 * Defines built-in writing styles and instructions appended to AI prompts.
 */

export const TONE_PROFILES = {
  standard: {
    id: 'standard',
    name: 'خبری روان',
    icon: '📰',
    desc: 'سبک روزنامه‌نگاری حرفه‌ای، روان، شیوا و خوانا برای عموم مخاطبان.',
    promptInstruction: 'Write in a fluent, journalistic, and clear Persian tone. Balance neutrality with engaging narrative flow. Avoid overly dense academic phrasing.',
  },
  formal: {
    id: 'formal',
    name: 'رسمی و تحلیلی',
    icon: '🏛️',
    desc: 'سبک رسمی، دقیق و تحلیل‌محور با واژگان دقیق و موقر.',
    promptInstruction: 'Write in a formal, highly authoritative, and analytical Persian tone. Use dignified and precise vocabulary suitable for technical and economic analysis.',
  },
  energetic: {
    id: 'energetic',
    name: 'پرانرژی و جذاب',
    icon: '⚡',
    desc: 'سبک هیجان‌انگیز، جذاب و پرانرژی با تیترهای داغ و تعاملی.',
    promptInstruction: 'Write in an energetic, exciting, and highly engaging Persian tone. Use dynamic verbs, strong narrative hooks, and captivating modern phrasing.',
  },
  concise: {
    id: 'concise',
    name: 'فشرده و تیترمحور',
    icon: '🎯',
    desc: 'سبک بسیار کوتاه، سریع و تیترمحور مناسب مطالعه در ۳۰ ثانیه.',
    promptInstruction: 'Write in an ultra-concise, rapid-fire bullet-point Persian tone. Strip away all fluff. Deliver the core facts and numbers immediately.',
  },
  custom: {
    id: 'custom',
    name: 'شخصی‌سازی‌شده (دلخواه)',
    icon: '✏️',
    desc: 'دستور اختصاصی تعریف‌شده توسط کاربر (تا ۳۰۰ کاراکتر).',
    promptInstruction: null,
  },
};

export function getToneSystemPrompt(user) {
  const profileKey = user?.toneProfile || 'standard';
  const profile = TONE_PROFILES[profileKey] || TONE_PROFILES.standard;

  if (profileKey === 'custom' && user?.toneCustom && user.toneCustom.trim().length > 0) {
    const safeCustom = user.toneCustom.trim().slice(0, 300);
    return `\n\nStyle and Tone Directive: ${safeCustom}`;
  }

  if (profile.promptInstruction) {
    return `\n\nStyle and Tone Directive: ${profile.promptInstruction}`;
  }

  return `\n\nStyle and Tone Directive: ${TONE_PROFILES.standard.promptInstruction}`;
}

/**
 * Robust JSON & Legacy parser for AI rewritten news.
 * Extracts JSON blocks, cleans Markdown fences, and supports legacy fallback.
 */
export function parseAiNewsJson(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return { success: false, title: '', summary: '', details: '', importance: null, mode: 'empty' };
  }

  // 1. Clean thinking tags if model outputs <thought>...</thought>
  const clean = rawText.replace(/<thought>[\s\S]*?<\/thought>/gi, '').trim();

  // 2. Try extracting JSON block {...}
  let jsonStr = null;
  const fencedMatch = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch) {
    const candidate = fencedMatch[1].trim();
    const braceMatch = candidate.match(/\{[\s\S]*\}/);
    jsonStr = braceMatch ? braceMatch[0] : candidate;
  } else {
    const braceMatch = clean.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      jsonStr = braceMatch[0];
    }
  }

  if (jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed && typeof parsed === 'object') {
        const title = (parsed.title || '').trim();
        const summary = (parsed.summary || '').trim();

        if (title || summary) {
          let detailsText = '';
          if (Array.isArray(parsed.details)) {
            detailsText = parsed.details
              .map((d) => String(d).replace(/^[•\-\*]\s*/, '').trim())
              .filter(Boolean)
              .map((d) => `• ${d}`)
              .join('\n');
          } else if (parsed.details) {
            detailsText = String(parsed.details).trim();
          }

          let importance = null;
          if (parsed.importance !== undefined && parsed.importance !== null) {
            const num = parseInt(parsed.importance, 10);
            if (!isNaN(num)) {
              importance = Math.max(1, Math.min(5, num));
            }
          }

          let category = null;
          if (parsed.category && typeof parsed.category === 'string') {
            const cleanCat = parsed.category.toLowerCase().trim();
            const valid = ['tech', 'economy', 'sport', 'world', 'social', 'culture', 'science', 'other'];
            if (valid.includes(cleanCat)) {
              category = cleanCat;
            }
          }

          return {
            success: true,
            title,
            summary,
            details: detailsText,
            importance,
            category,
            mode: 'json',
          };
        }
      }
    } catch (e) {
      // JSON parse failed, proceed to legacy regex
    }
  }

  // 3. Legacy Regex Fallback: [TITLE]: / [SUMMARY]: / [DETAILS]:
  const tMatch = clean.match(/\[TITLE\]:?\s*([^\n]+)/i);
  const sMatch = clean.match(/\[SUMMARY\]:?\s*([\s\S]*?)(?=\[DETAILS\]|$)/i);
  const dMatch = clean.match(/\[DETAILS\]:?\s*([\s\S]*?)$/i);

  if (tMatch) {
    const title = tMatch[1].trim();
    const summary = sMatch ? sMatch[1].trim() : clean.slice(0, 180);
    const details = dMatch ? dMatch[1].trim() : '';

    return {
      success: true,
      title,
      summary,
      details,
      importance: null,
      category: null,
      mode: 'legacy',
    };
  }

  // 4. Raw text fallback
  const firstLine = clean.split('\n')[0].replace(/^[#*>\-\s]+/, '').trim();
  return {
    success: false,
    title: firstLine.length > 5 ? firstLine.slice(0, 80) : clean.slice(0, 80),
    summary: clean.slice(0, 200),
    details: '',
    importance: null,
    category: null,
    mode: 'raw',
  };
}

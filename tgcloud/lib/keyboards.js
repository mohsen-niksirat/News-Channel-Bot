/**
 * Interactive Keyboards for NewsStudio Bot
 */

import { ROUTING_POLICIES } from 'lib/ai_router';

export function mainMenuKeyboard(user) {
  const autoPubStatus = user.autoPublish ? 'روشن 🚀' : 'دستی 📑';
  const miniAppUrl = 'https://app9260009899.tgcloud.ai/?uid=' + (user?.tgId || '');
  return {
    inline_keyboard: [
      [
        { text: '📱 مینی‌اپ داشبورد پیشرفته (Mini App)', web_app: { url: miniAppUrl } },
      ],
      [
        { text: '🔍 اسکن فوری منابع', callback_data: 'act:scan' },
        { text: '📑 صف بررسی پیش‌نویس‌ها', callback_data: 'm:review:0' },
      ],
      [
        { text: '📡 مدیریت منابع خبری', callback_data: 'm:sources' },
        { text: '🤖 کلیدها و روتر هوش مصنوعی', callback_data: 'm:ai' },
      ],
      [
        { text: `📢 تنظیمات کانال (${autoPubStatus})`, callback_data: 'm:channel' },
        { text: '🗞️ روزنامه امروز', callback_data: 'act:digest' },
      ],
      [
        { text: '📊 آمار مصرف توکن‌ها', callback_data: 'm:token_stats' },
        { text: '📢 کانال رسمی @MyLeitner', url: 'https://t.me/MyLeitner' },
      ],
    ],
  };
}

export function mainReplyKeyboard(userId = null) {
  const miniAppUrl = 'https://app9260009899.tgcloud.ai/' + (userId ? `?uid=${userId}` : '');
  return {
    keyboard: [
      [
        { text: '📱 باز کردن مینی‌اپ داشبورد', web_app: { url: miniAppUrl } },
      ],
      [
        { text: '🔍 اسکن فوری منابع' },
        { text: '📑 صف بررسی' },
      ],
      [
        { text: '📡 منابع خبری' },
        { text: '🤖 هوش مصنوعی' },
      ],
      [
        { text: '📢 تنظیمات کانال' },
        { text: '🗞️ دریافت روزنامه' },
      ],
    ],
    resize_keyboard: true,
    input_field_placeholder: 'گزینه‌ای انتخاب کنید یا متنی برای خلاصه بفرستید...',
  };
}

export function reviewPostKeyboard(postId, sourceUrl = '', currentIndex = 0, totalCount = 1) {
  const rows = [
    [
      { text: '✅ تایید و انتشار در کانال', callback_data: `pub:${postId}:${currentIndex}` },
      { text: '❌ رد پیش‌نویس', callback_data: `rej:${postId}:${currentIndex}` },
    ],
  ];

  if (totalCount > 1) {
    const navRow = [];
    if (currentIndex > 0) {
      navRow.push({ text: '⬅️ قبلی', callback_data: `m:review:${currentIndex - 1}` });
    }
    navRow.push({ text: `📌 ${currentIndex + 1} از ${totalCount}`, callback_data: 'act:noop' });
    if (currentIndex < totalCount - 1) {
      navRow.push({ text: '➡️ بعدی', callback_data: `m:review:${currentIndex + 1}` });
    }
    rows.push(navRow);
  }

  const actRow = [
    { text: '🔁 بازنویسی با مدل دیگر', callback_data: `regen:${postId}:${currentIndex}` },
  ];
  if (sourceUrl) {
    actRow.push({ text: '🌐 متن اصلی', url: sourceUrl });
  }
  rows.push(actRow);

  rows.push([
    { text: '🔙 بازگشت به منوی اصلی', callback_data: 'm:menu' },
  ]);

  return { inline_keyboard: rows };
}

export function sourcesManagementKeyboard(sourcesList) {
  const keyboard = [];

  for (const s of sourcesList) {
    const statusIcon = s.enabled ? '✅' : '⏸️';
    const typeIcon = s.type === 'telegram' ? '📢' : '🌐';
    keyboard.push([
      { text: `${statusIcon} ${typeIcon} ${s.name}`, callback_data: `tog:src:${s.id}` },
      { text: '🗑️', callback_data: `del:src:${s.id}` },
    ]);
  }

  keyboard.push([
    { text: '➕ افزودن کانال یا فید جدید', callback_data: 'act:add_source' },
  ]);
  keyboard.push([
    { text: '🔙 بازگشت به منوی اصلی', callback_data: 'm:menu' },
  ]);

  return { inline_keyboard: keyboard };
}

export function aiSettingsKeyboard(user, keysList, customProvidersList = []) {
  const keyboard = [];

  // Keys with Priority Up / Down and Delete
  keysList.forEach((k, idx) => {
    const statusIcon = k.status === 'active' ? '🟢' : k.status === 'cooldown' ? '🟡' : '🔴';
    const label = k.label || `${k.provider.toUpperCase()}`;
    const tokenDisplay = k.totalTokens ? ` (${Math.round(k.totalTokens / 1000)}k tkn)` : '';

    keyboard.push([
      { text: `${statusIcon} #${idx + 1} ${label}${tokenDisplay}`, callback_data: `noop` },
      { text: '⬆️', callback_data: `up:key:${k.id}` },
      { text: '⬇️', callback_data: `dn:key:${k.id}` },
      { text: '🗑️', callback_data: `del:key:${k.id}` },
    ]);
  });

  // Action Buttons
  keyboard.push([
    { text: '➕ افزودن کلید به استخر (API Key)', callback_data: 'act:add_key' },
  ]);

  keyboard.push([
    { text: '🧪 تست سلامت کلیدها و مدل‌های فعال', callback_data: 'act:test_keys' },
  ]);

  // Custom Providers with Delete Option
  if (customProvidersList && customProvidersList.length > 0) {
    keyboard.push([
      { text: '─── 🛠️ ارائه‌دهنده‌های کاستوم ───', callback_data: 'noop' },
    ]);
    customProvidersList.forEach((cp) => {
      keyboard.push([
        { text: `🛠️ ${cp.name} (${cp.defaultModel || 'default'})`, callback_data: `info:prov:${cp.id}` },
        { text: '🗑️ حذف', callback_data: `del:prov:${cp.id}` },
      ]);
    });
  }

  keyboard.push([
    { text: '🌐 افزودن ارائه‌دهنده جدید (کاستوم / دلخواه)', callback_data: 'act:add_custom_prov' },
  ]);

  const policy = user.routingPolicy || 'fallback';
  const policyLabel = ROUTING_POLICIES[policy]?.name || 'فالبک (Fallback)';
  keyboard.push([
    { text: `🔀 استراتژی: ${policyLabel}`, callback_data: 'm:pick_policy' },
  ]);

  const prefProv = (user.preferredAiProvider || 'gemini').toUpperCase();
  keyboard.push([
    { text: `⚡ پرووایدر پیش‌فرض: ${prefProv}`, callback_data: 'm:pick_provider' },
    { text: '📊 آمار مصرف توکن‌ها', callback_data: 'm:token_stats' },
  ]);

  keyboard.push([
    { text: '🔙 بازگشت به منوی اصلی', callback_data: 'm:menu' },
  ]);

  return { inline_keyboard: keyboard };
}

export function providerSelectionKeyboard(customProvidersList = []) {
  const rows = [
    [
      { text: '✨ Google Gemini (Flash)', callback_data: 'set:prov:gemini' },
      { text: '⚡ Groq (Llama 3.3)', callback_data: 'set:prov:groq' },
    ],
    [
      { text: '🧠 DeepSeek (Chat)', callback_data: 'set:prov:deepseek' },
      { text: '🌐 OpenRouter / OpenAI', callback_data: 'set:prov:openai' },
    ],
  ];

  // Add custom providers if any
  for (const cp of customProvidersList) {
    rows.push([
      { text: `🛠️ ${cp.name} (کاستوم)`, callback_data: `set:prov:${cp.slug}` },
      { text: '🗑️ حذف ارائه‌دهنده', callback_data: `del:prov:${cp.id}` },
    ]);
  }

  rows.push([
    { text: '🔙 بازگشت به تنظیمات AI', callback_data: 'm:ai' },
  ]);

  return { inline_keyboard: rows };
}

export function routingPolicyKeyboard(currentPolicy = 'fallback') {
  const rows = [];
  const policies = [
    { id: 'fallback', label: '🛡️ فالبک اولویتی (Fallback)', desc: 'استفاده بر اساس ترتیب اولویت بالا/پایین' },
    { id: 'round_robin', label: '🔄 راند رابین (Round-Robin)', desc: 'توزیع چرخشی مساوی بین کلیدها' },
    { id: 'smart_router', label: '🧠 اسمارت روتر (Smart Router)', desc: 'انتخاب سالم‌ترین کلید با کمترین شکست' },
    { id: 'fusion', label: '⚡ فیوژن پیشرفته (Fusion)', desc: 'بالاترین کیفیت بازنویسی' },
  ];

  for (const p of policies) {
    const isSelected = p.id === currentPolicy ? ' ✅' : '';
    rows.push([
      { text: `${p.label}${isSelected}`, callback_data: `set:policy:${p.id}` },
    ]);
  }

  rows.push([
    { text: '🔙 بازگشت به تنظیمات AI', callback_data: 'm:ai' },
  ]);

  return { inline_keyboard: rows };
}

export function keyProviderPickerKeyboard(customProvidersList = []) {
  const rows = [
    [{ text: 'Gemini (Google)', callback_data: 'prompt_key:gemini' }],
    [{ text: 'Groq (فوق سریع و رایگان)', callback_data: 'prompt_key:groq' }],
    [{ text: 'DeepSeek', callback_data: 'prompt_key:deepseek' }],
    [{ text: 'OpenAI / OpenRouter', callback_data: 'prompt_key:openai' }],
  ];

  for (const cp of customProvidersList) {
    rows.push([
      { text: `🛠️ ${cp.name} (${cp.baseUrl})`, callback_data: `prompt_key:${cp.slug}` },
    ]);
  }

  rows.push([
    { text: '🔙 بازگشت به تنظیمات AI', callback_data: 'm:ai' },
  ]);

  return { inline_keyboard: rows };
}

export function channelSettingsKeyboard(user) {
  const autoIcon = user.autoPublish ? 'روشن 🚀' : 'خاموش 📑';
  const modeLabels = {
    individual: '📰 تک‌پست اختصاصی',
    bulletin: '🗞️ بولتن تجمیعی',
    smart: '⚡ حالت هوشمند',
  };
  const modeText = modeLabels[user.publishMode || 'smart'] || '⚡ حالت هوشمند';
  return {
    inline_keyboard: [
      [
        { text: `📢 آیدی کانال: ${user.channelId || 'تنظیم‌نشده'}`, callback_data: 'act:set_channel' },
      ],
      [
        { text: `🚀 انتشار خودکار: ${autoIcon}`, callback_data: 'tog:autopub' },
      ],
      [
        { text: `📰 حالت انتشار: ${modeText}`, callback_data: 'm:publish_mode' },
      ],
      [
        { text: `✏️ ویرایش فوتر و امضای کانال`, callback_data: 'act:set_footer' },
      ],
      [
        { text: '🔙 بازگشت به منوی اصلی', callback_data: 'm:menu' },
      ],
    ],
  };
}

export function publishModeKeyboard(currentMode = 'smart') {
  return {
    inline_keyboard: [
      [
        { text: `${currentMode === 'smart' ? '✅ ' : ''}⚡ حالت هوشمند (پیش‌فرض)`, callback_data: 'set_pm:smart' },
      ],
      [
        { text: `${currentMode === 'individual' ? '✅ ' : ''}📰 تک‌پست اختصاصی (تمام اخبار جداگانه)`, callback_data: 'set_pm:individual' },
      ],
      [
        { text: `${currentMode === 'bulletin' ? '✅ ' : ''}🗞️ بولتن تجمیعی ساعتی (همیشه یک پست)`, callback_data: 'set_pm:bulletin' },
      ],
      [
        { text: '🔙 بازگشت به تنظیمات کانال', callback_data: 'm:channel' },
      ],
    ],
  };
}

export function backToMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🔙 بازگشت به منوی اصلی', callback_data: 'm:menu' }],
    ],
  };
}

export function backToAiKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🔙 بازگشت به تنظیمات هوش مصنوعی', callback_data: 'm:ai' }],
    ],
  };
}

export function healthCheckKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '🔄 تست مجدد کلیدها', callback_data: 'act:test_keys' },
        { text: '➕ افزودن کلید جدید', callback_data: 'act:add_key' },
      ],
      [
        { text: '🔙 بازگشت به تنظیمات AI', callback_data: 'm:ai' },
        { text: '🏠 منوی اصلی', callback_data: 'm:menu' },
      ],
    ],
  };
}

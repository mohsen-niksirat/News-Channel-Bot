/**
 * Interactive Keyboards for NewsStudio Bot
 */

import { ROUTING_POLICIES } from 'lib/ai_router';
import { ADMIN_ID } from 'lib/db';
import { TONE_PROFILES } from 'lib/tones';
import { VALID_CATEGORIES, CATEGORY_LABELS, parseSourceCategories } from 'lib/categories';
import { parseScheduleWindows, formatScheduleWindowsPersian } from 'lib/schedule';

export function mainMenuKeyboard(user) {
  const autoPubStatus = user?.autoPublish ? 'روشن 🚀' : 'دستی 📑';
  const miniAppUrl = 'https://app9260009899.tgcloud.ai/?uid=' + (user?.tgId || '');
  const rows = [
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
  ];

  if (user && (user.tgId === ADMIN_ID || user.id === ADMIN_ID)) {
    rows.push([
      { text: '👑 پنل آمار کل پلتفرم (Admin)', callback_data: 'm:admin_stats' },
    ]);
  }

  return {
    inline_keyboard: rows,
  };
}

export function mainReplyKeyboard(userId = ADMIN_ID) {
  const effectiveId = userId || ADMIN_ID;
  const miniAppUrl = 'https://app9260009899.tgcloud.ai/?uid=' + effectiveId;
  const rows = [
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
  ];

  if (userId === ADMIN_ID) {
    rows.push([
      { text: '👑 آمار مدیریت سیستم' },
    ]);
  }

  return {
    keyboard: rows,
    resize_keyboard: true,
    input_field_placeholder: 'گزینه‌ای انتخاب کنید یا متنی برای خلاصه بفرستید...',
  };
}

export function adminStatsKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '🔄 بروزرسانی آمار زنده', callback_data: 'act:admin_stats_refresh' },
        { text: '🔍 اجرای اسکن فوری', callback_data: 'act:scan' },
      ],
      [
        { text: '🤖 مدیریت هوش مصنوعی', callback_data: 'm:ai' },
        { text: '📡 مدیریت منابع', callback_data: 'm:sources' },
      ],
      [
        { text: '🔙 بازگشت به منوی اصلی', callback_data: 'm:menu' },
      ],
    ],
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
      { text: '🏷️ دسته‌ها', callback_data: `cats:src:${s.id}` },
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

export function sourceCategoriesKeyboard(source) {
  const keyboard = [];
  const activeCats = parseSourceCategories(source?.categories);

  // 2 buttons per row for compact Persian UI
  for (let i = 0; i < VALID_CATEGORIES.length; i += 2) {
    const row = [];
    const cat1 = VALID_CATEGORIES[i];
    const on1 = activeCats.includes(cat1);
    row.push({
      text: `${on1 ? '✅' : '❌'} ${CATEGORY_LABELS[cat1] || cat1}`,
      callback_data: `tog:scat:${source.id}:${cat1}`,
    });

    if (i + 1 < VALID_CATEGORIES.length) {
      const cat2 = VALID_CATEGORIES[i + 1];
      const on2 = activeCats.includes(cat2);
      row.push({
        text: `${on2 ? '✅' : '❌'} ${CATEGORY_LABELS[cat2] || cat2}`,
        callback_data: `tog:scat:${source.id}:${cat2}`,
      });
    }
    keyboard.push(row);
  }

  keyboard.push([
    { text: '🔙 بازگشت به مدیریت منابع', callback_data: 'm:sources' },
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

  const curTone = user.toneProfile || 'standard';
  const toneName = TONE_PROFILES[curTone]?.name || 'خبری روان';
  keyboard.push([
    { text: `🎨 لحن و سبک نگارش: ${toneName}`, callback_data: 'm:tone' },
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
  const windows = parseScheduleWindows(user?.scheduleWindows);
  const schedCount = windows ? `${windows.length} زمان فعال` : 'همیشه';

  return {
    inline_keyboard: [
      [
        { text: `📢 آیدی کانال: ${user.channelId || 'تنظیم‌نشده'}`, callback_data: 'act:set_channel' },
      ],
      [
        { text: `🚀 انتشار خودکار: ${autoIcon}`, callback_data: 'tog:autopub' },
      ],
      [
        { text: `⏱️ ساعات انتشار: ${schedCount}`, callback_data: 'm:schedule' },
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

export function scheduleSettingsKeyboard(user) {
  const keyboard = [];
  const windows = parseScheduleWindows(user?.scheduleWindows);

  if (windows && windows.length > 0) {
    for (const w of windows) {
      keyboard.push([
        { text: `⏰ ساعت ${w} (به وقت تهران)`, callback_data: 'act:noop' },
        { text: '🗑️ حذف', callback_data: `del:sched:${w}` },
      ]);
    }
  }

  // Quick preset buttons to add common schedule times
  keyboard.push([
    { text: '➕ ۰۹:۰۰', callback_data: 'add:sched:09:00' },
    { text: '➕ ۱۳:۰۰', callback_data: 'add:sched:13:00' },
    { text: '➕ ۱۸:۰۰', callback_data: 'add:sched:18:00' },
    { text: '➕ ۲۱:۰۰', callback_data: 'add:sched:21:00' },
  ]);

  keyboard.push([
    { text: '✏️ افزودن ساعت دلخواه (مثلاً 10:30)', callback_data: 'act:add_schedule_custom' },
  ]);

  if (windows && windows.length > 0) {
    keyboard.push([
      { text: '🔄 پاک کردن همه ساعات (انتشار در هر اسکن)', callback_data: 'act:clear_schedule' },
    ]);
  }

  keyboard.push([
    { text: '🔙 بازگشت به تنظیمات کانال', callback_data: 'm:channel' },
  ]);

  return { inline_keyboard: keyboard };
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

export function toneSelectionKeyboard(user) {
  const current = user?.toneProfile || 'standard';
  const customNote = user?.toneCustom ? ` («${user.toneCustom.slice(0, 20)}...»)` : '';
  const rows = [
    [
      { text: `${current === 'standard' ? '✅ ' : ''}📰 خبری روان (استاندارد)`, callback_data: 'set:tone:standard' },
      { text: `${current === 'formal' ? '✅ ' : ''}🏛️ رسمی و تحلیلی`, callback_data: 'set:tone:formal' },
    ],
    [
      { text: `${current === 'energetic' ? '✅ ' : ''}⚡ پرانرژی و جذاب`, callback_data: 'set:tone:energetic' },
      { text: `${current === 'concise' ? '✅ ' : ''}🎯 فشرده و تیترمحور`, callback_data: 'set:tone:concise' },
    ],
    [
      { text: `${current === 'custom' ? '✅ ' : ''}✏️ لحن اختصاصی${customNote}`, callback_data: 'set:tone:custom' },
    ],
    [
      { text: '🔙 بازگشت به تنظیمات هوش مصنوعی', callback_data: 'm:ai' },
    ],
  ];
  return { inline_keyboard: rows };
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

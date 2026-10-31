import { api } from 'sdk';
import {
  getOrCreateUser,
  getUser,
  updateUser,
  setUserState,
  getUserSources,
  addSource,
  addAiKey,
  getAiKeys,
  getCustomProviders,
  getCustomProviderBySlug,
  addCustomProvider,
  updateCustomProviderModels,
  getTokenUsageStats,
  isPostAlreadyHarvested,
  saveDraftPost,
  getDraftPosts,
  markPostPublished,
  ADMIN_ID,
  getAdminPlatformStats,
  formatAdminStatsMessage,
} from 'lib/db';
import { runScanForUser } from 'lib/scanner';
import { generateNewsRewrite, ROUTING_POLICIES } from 'lib/ai_router';
import { runHealthCheckForUser } from 'lib/health_check';
import { buildEditorialPost, buildPostButtons, sendRichPostSafe, escHtml } from 'lib/rich_post';
import {
  mainMenuKeyboard,
  mainReplyKeyboard,
  reviewPostKeyboard,
  sourcesManagementKeyboard,
  aiSettingsKeyboard,
  channelSettingsKeyboard,
  healthCheckKeyboard,
  adminStatsKeyboard,
  backToMenuKeyboard,
} from 'lib/keyboards';

export default async function (message) {
  if (!message || !message.chat) return;
  const chat = message.chat;
  const from = message.from;
  if (!from || from.is_bot) return;

  const { user } = await getOrCreateUser(from);
  const text = (message.text || message.caption || '').trim();

  // Handle Telegram Mini App Data sent via Telegram.WebApp.sendData(...)
  if (message.web_app_data && message.web_app_data.data) {
    try {
      const payload = JSON.parse(message.web_app_data.data);
      if (payload.action === 'trigger_scan') {
        await api.sendMessage({
          chat_id: chat.id,
          text: '⏳ <b>درخواست پایش فوری از مینی‌اپ دریافت شد!</b>\nدر حال بررسی منابع و آماده‌سازی اخبار...',
          parse_mode: 'HTML',
        });
        await runScanForUser(from.id, chat.id);
        return;
      }
      if (payload.action === 'test_keys') {
        await api.sendMessage({
          chat_id: chat.id,
          text: '⏳ <b>در حال تست سلامت کلیدها از مینی‌اپ...</b>\nلطفاً چند لحظه شکیبا باشید.',
          parse_mode: 'HTML',
        }).catch(() => {});

        try {
          const rep = await runHealthCheckForUser(from.id);
          await api.sendMessage({
            chat_id: chat.id,
            text: rep.html,
            parse_mode: 'HTML',
            reply_markup: healthCheckKeyboard(),
          });
        } catch (err) {
          await api.sendMessage({
            chat_id: chat.id,
            text: `❌ خطا در ارزیابی سلامت: ${escHtml(err.message)}`,
            reply_markup: healthCheckKeyboard(),
          });
        }
        return;
      }
      if (payload.action === 'toggle_autopub') {
        const nextState = user.autoPublish ? 0 : 1;
        await updateUser(from.id, { autoPublish: nextState });
        const label = nextState ? 'روشن (خودکار) 🚀' : 'دستی (صف پیش‌نویس) 📑';
        await api.sendMessage({
          chat_id: chat.id,
          text: `✅ وضعیت انتشار خودکار از طریق مینی‌اپ روی <b>${label}</b> تنظیم شد.`,
          parse_mode: 'HTML',
          reply_markup: mainMenuKeyboard(await getUser(from.id)),
        });
        return;
      }
    } catch (e) {
      console.warn('WebApp data error:', e.message);
    }
  }

  // 0. Universal Cancel
  if (text === '/cancel' || text === '❌ انصراف' || text === '❌ لغو') {
    await setUserState(from.id, 'idle');
    await api.sendMessage({
      chat_id: chat.id,
      text: '❌ عملیات لغو شد و به منوی اصلی بازگشتید.',
      reply_markup: mainReplyKeyboard(from.id),
    });
    return;
  }

  // 1. FSM States
  if (user.state && user.state !== 'idle') {
    // A) Setting Channel Username
    if (user.state === 'set_channel') {
      let ch = text.trim();
      if (!ch.startsWith('@') && !ch.startsWith('-100')) {
        ch = '@' + ch.replace(/^https?:\/\/t\.me\//i, '');
      }
      await updateUser(from.id, { channelId: ch });
      await setUserState(from.id, 'idle');

      let reply = `✅ کانال اختصاصی شما با موفقیت روی <code>${escHtml(ch)}</code> تنظیم شد.`;
      try {
        const chatMember = await api.getChatMember({ chat_id: ch, user_id: (await api.getMe()).id });
        if (chatMember && (chatMember.status === 'administrator' || chatMember.status === 'creator')) {
          reply += `\n\n🎉 <b>ربات مدیر این کانال است و آماده انتشار خبرها می‌باشد!</b>`;
        } else {
          reply += `\n\n⚠️ <b>نکته مهم:</b> ربات هنوز در کانال <code>${escHtml(ch)}</code> ادمین نشده است.\nبرای اینکه ربات بتواند خبرها را منتشر کند، لطفاً ربات را به عنوان <b>مدیر (Administrator)</b> با دسترسی ارسال پیام در کانال ادد فرمایید.`;
        }
      } catch {
        reply += `\n\n⚠️ <b>نکته مهم:</b> ربات هنوز در کانال <code>${escHtml(ch)}</code> ادمین نشده است.\nبرای اینکه ربات بتواند خبرها را منتشر یا حذف کند، لطفاً ربات را به عنوان <b>مدیر (Administrator)</b> با دسترسی ارسال پیام در کانال ادد فرمایید.`;
      }

      const updatedUser = await getUser(from.id);
      await api.sendMessage({
        chat_id: chat.id,
        text: reply,
        parse_mode: 'HTML',
        reply_markup: channelSettingsKeyboard(updatedUser),
      });
      return;
    }

    // B) Setting Footer
    if (user.state === 'set_footer') {
      await updateUser(from.id, { footerText: text });
      await setUserState(from.id, 'idle');
      const updatedUser = await getUser(from.id);
      await api.sendMessage({
        chat_id: chat.id,
        text: `✅ فوتر و امضای کانال ذخیره شد:\n\n<code>${escHtml(text)}</code>`,
        parse_mode: 'HTML',
        reply_markup: channelSettingsKeyboard(updatedUser),
      });
      return;
    }

    // C) Custom Provider Wizard: Name
    if (user.state === 'add_prov_name') {
      const name = text.trim();
      await setUserState(from.id, 'add_prov_url', { name });
      await api.sendMessage({
        chat_id: chat.id,
        text:
          `🌐 نام ارائه‌دهنده: <b>${escHtml(name)}</b>\n\n` +
          `حالا لطفاً <b>ENDPOINT یا Base URL</b> سایت ارائه‌دهنده را ارسال فرمایید:\n` +
          `(مثال: <code>https://api.openai.com/v1</code> یا <code>https://api.avalai.ir/v1</code> یا <code>https://api.deepinfra.com/v1/openai</code>):`,
        parse_mode: 'HTML',
        reply_markup: backToMenuKeyboard(),
      });
      return;
    }

    // D) Custom Provider Wizard: URL
    if (user.state === 'add_prov_url') {
      const baseUrl = text.trim();
      let name = 'ارائه‌دهنده من';
      try {
        const st = typeof user.stateData === 'string' ? JSON.parse(user.stateData || '{}') : (user.stateData || {});
        if (st.name) name = st.name;
      } catch {}

      const cp = await addCustomProvider(from.id, {
        name,
        baseUrl,
        defaultModel: 'gpt-4o-mini',
        models: ['gpt-4o-mini'],
      });

      await setUserState(from.id, 'idle');
      await api.sendMessage({
        chat_id: chat.id,
        text:
          `✅ ارائه‌دهنده <b>${escHtml(name)}</b> با آدرس <code>${escHtml(baseUrl)}</code> با موفقیت ذخیره شد!\n\n` +
          `آیا مایلید مدل‌های پیش‌فرض این ارائه‌دهنده را دستی اضافه کنید؟`,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '➕ افزودن دستی مدل‌ها', callback_data: `act:prov_models:${cp.id}` }],
            [{ text: '⚡ استفاده از مدل پیش‌فرض (gpt-4o-mini)', callback_data: 'm:ai' }],
          ],
        },
      });
      return;
    }

    // E) Custom Provider Wizard: Models
    if (user.state.startsWith('add_prov_models:')) {
      const provId = parseInt(user.state.replace('add_prov_models:', ''), 10);
      const models = text.split(/[,،\n]+/).map((s) => s.trim()).filter(Boolean);
      await updateCustomProviderModels(provId, models);
      await setUserState(from.id, 'idle');
      const cpList = await getCustomProviders(from.id);
      const keysList = await getAiKeys(from.id);
      await api.sendMessage({
        chat_id: chat.id,
        text:
          `✅ مدل‌های ارائه‌دهنده با موفقیت ذخیره شدند:\n` +
          `<b>${escHtml(models.join(', '))}</b>\n\n` +
          `اکنون می‌توانید از منوی مدیریت هوش مصنوعی، کلیدهای اختصاصی این ارائه‌دهنده را اضافه کنید.`,
        parse_mode: 'HTML',
        reply_markup: aiSettingsKeyboard(user, keysList, cpList),
      });
      return;
    }

    // F) Adding AI Key
    if (user.state.startsWith('add_key:')) {
      const provider = user.state.replace('add_key:', '');
      const apiKey = text.trim();
      let label = `${provider.toUpperCase()} (اختصاصی)`;
      let baseUrl = null;

      if (provider.startsWith('c_')) {
        const cp = await getCustomProviderBySlug(provider);
        if (cp) {
          label = `${cp.name} (کاستوم)`;
          baseUrl = cp.baseUrl;
        }
      }

      await addAiKey({
        userId: from.id,
        provider,
        apiKey,
        label,
        baseUrl,
      });

      await setUserState(from.id, 'idle');
      const keysList = await getAiKeys(from.id);
      const cpList = await getCustomProviders(from.id);
      await api.sendMessage({
        chat_id: chat.id,
        text: `✅ کلید جدید با موفقیت به استخر هوش مصنوعی افزوده شد!`,
        parse_mode: 'HTML',
        reply_markup: aiSettingsKeyboard(user, keysList, cpList),
      });
      return;
    }

    // G) Adding Custom Source
    if (user.state === 'add_source') {
      const input = text.trim();
      let type = 'rss';
      let name = input;
      let urlOrHandle = input;

      if (input.startsWith('@') || input.includes('t.me/')) {
        type = 'telegram';
        name = input.replace(/^(?:https?:\/\/)?(?:t\.me|telegram\.me)\//i, '');
        if (!name.startsWith('@')) name = '@' + name;
        urlOrHandle = name;
      }

      await addSource(from.id, {
        name,
        type,
        urlOrHandle,
        lang: 'fa',
        category: 'custom',
      });
      await setUserState(from.id, 'idle');
      const sourcesList = await getUserSources(from.id);
      await api.sendMessage({
        chat_id: chat.id,
        text: `✅ منبع جدید <b>${escHtml(name)}</b> اضافه شد!`,
        parse_mode: 'HTML',
        reply_markup: sourcesManagementKeyboard(sourcesList),
      });
      return;
    }
  }

  // 2. Main Commands
  if (text.startsWith('/start')) {
    await setUserState(from.id, 'idle');
    const welcome =
      `📰 <b>سلام ${escHtml(from.first_name)} عزیز؛ به استودیوی خبر تلگرام خوش آمدید!</b>\n\n` +
      `این ربات، دستیار هوشمند شما برای پایش، خلاصه‌سازی و انتشار خودکار اخبار کانال است:\n\n` +
      `🔹 <b>پایش منابع:</b> فیدهای پرسرعت RSS و خبرگزاری‌ها\n` +
      `🔹 <b>روتر هوش مصنوعی (مشابه ۹روتر):</b> اتصال به Gemini، Groq، DeepSeek و ارائه‌دهنده‌های کاستوم\n` +
      `🔹 <b>جابجایی اولویت کلیدها:</b> دکمه‌های ⬆️ و ⬇️ برای ترتیب فراخوانی کلیدها\n` +
      `🔹 <b>استراتژی‌های پیشرفته:</b> فالبک، راند رابین، اسمارت روتر و فیوژن\n` +
      `🔹 <b>داشبورد توکن‌ها:</b> مشاهده دقیق مصرف روزانه و ماهانه توکن‌ها\n` +
      `🔹 <b>استودیوی ژورنالی (Rasa Rich Studio):</b> انتشار با نقل‌قول بازشونده و دکمه‌های کپی\n\n` +
      `👇 <i>برای شروع، یکی از گزینه‌های زیر را انتخاب کنید:</i>`;

    await api.sendMessage({
      chat_id: chat.id,
      text: welcome,
      parse_mode: 'HTML',
      reply_markup: mainMenuKeyboard(user),
    });
    await api.sendMessage({
      chat_id: chat.id,
      text: '👇 نوار دسترسی سریع فعال است:',
      reply_markup: mainReplyKeyboard(from.id),
    });

    try {
      await api.setChatMenuButton({
        chat_id: chat.id,
        menu_button: {
          type: 'web_app',
          text: 'داشبورد خبر',
          web_app: { url: `https://app9260009899.tgcloud.ai/?uid=${from.id}` },
        },
      });
    } catch (e) {}

    return;
  }

  // 3. Scan command
  if (text === '/scan' || text === '🔍 اسکن فوری منابع') {
    await runScanForUser(from.id, chat.id);
    return;
  }

  // 4. Review Queue
  if (
    text === '/review' ||
    text === '📑 صف بررسی' ||
    text === '📄 صف بررسی پیش‌نویس‌ها' ||
    text.includes('صف بررسی') ||
    text.includes('پیش‌نویس')
  ) {
    const drafts = await getDraftPosts(from.id, 50);
    if (!drafts || drafts.length === 0) {
      await api.sendMessage({
        chat_id: chat.id,
        text:
          '🎉 <b>صف بررسی پیش‌نویس‌ها در حال حاضر خالی است!</b>\n\n' +
          '💡 <i>نکته:</i> وقتی حالت «انتشار خودکار» روشن باشد، اخبار مستقیماً به کانال ارسال می‌شوند و در صف پیش‌نویس قرار نمی‌گیرند.\n' +
          'برای دریافت اخبار جدید می‌توانید گزینه «🔍 اسکن فوری منابع» را بزنید.',
        parse_mode: 'HTML',
        reply_markup: mainMenuKeyboard(user),
      });
      return;
    }

    const post = drafts[0];
    const total = drafts.length;
    const cardText = `📑 <b>پیش‌نویس [۱ از ${total}]</b> - منبع: <b>${escHtml(post.sourceName)}</b>\n\n${post.formattedHtml}`;

    await sendRichPostSafe({
      chatId: chat.id,
      postHtml: cardText,
      imageUrl: post.imageUrl,
      buttons: reviewPostKeyboard(post.id, post.sourceUrl, 0, total),
    });
    return;
  }

  // 5. AI Settings Command
  if (text === '/keys' || text === '🤖 هوش مصنوعی') {
    const keysList = await getAiKeys(from.id);
    const cpList = await getCustomProviders(from.id);
    const policy = ROUTING_POLICIES[user.routingPolicy || 'fallback']?.name || 'فالبک اولویتی';
    await api.sendMessage({
      chat_id: chat.id,
      text:
        `🤖 <b>مدیریت کلیدها و روتر هوش مصنوعی (مشابه ۹روتر):</b>\n\n` +
        `پرووایدر پیش‌فرض: <b>${user.preferredAiProvider.toUpperCase()}</b>\n` +
        `استراتژی فعال: <b>${policy}</b>\n` +
        `تعداد کلیدهای موجود در استخر: <b>${keysList.length}</b>\n` +
        `ارائه‌دهنده‌های سفارشی: <b>${cpList.length}</b>\n\n` +
        `💡 با دکمه‌های ⬆️ و ⬇️ می‌توانید اولویت مصرف کلیدها را تغییر دهید.`,
      parse_mode: 'HTML',
      reply_markup: aiSettingsKeyboard(user, keysList, cpList),
    });
    return;
  }

  // 5.5. Test Keys Health Command
  if (text === '/testkeys' || text === '🧪 تست سلامت کلیدها') {
    await api.sendMessage({
      chat_id: chat.id,
      text: '⏳ <b>در حال تست سلامت کلیدها و دریافت مدل‌های فعال...</b>\n\nلطفاً چند ثانیه شکیبا باشید.',
      parse_mode: 'HTML',
    });

    const report = await runHealthCheckForUser(from.id);
    await api.sendMessage({
      chat_id: chat.id,
      text: report.html,
      parse_mode: 'HTML',
      reply_markup: healthCheckKeyboard(),
    });
    return;
  }

  // 6. Token Usage Command
  if (text === '/tokens' || text === '📊 آمار مصرف توکن‌ها') {
    const stats = await getTokenUsageStats(from.id);
    const provLines = Object.entries(stats.byProvider)
      .map(([p, c]) => `• <b>${p}</b>: <code>${c.toLocaleString('fa-IR')}</code> توکن`)
      .join('\n');

    const msg =
      `📊 <b>داشبورد تحلیل مصرف توکن‌ها و هزینه‌ها:</b>\n\n` +
      `🗓️ <b>امروز:</b> <code>${stats.today.total.toLocaleString('fa-IR')}</code> توکن\n` +
      `├ ورودی (Prompt): <code>${stats.today.prompt.toLocaleString('fa-IR')}</code>\n` +
      `└ خروجی (Completion): <code>${stats.today.completion.toLocaleString('fa-IR')}</code>\n\n` +
      `📅 <b>۷ روز گذشته:</b> <code>${stats.week.toLocaleString('fa-IR')}</code> توکن\n` +
      `📆 <b>۳۰ روز گذشته (ماهانه):</b> <code>${stats.month.toLocaleString('fa-IR')}</code> توکن\n` +
      `🌐 <b>کل مصرف از ابتدا:</b> <code>${stats.allTime.toLocaleString('fa-IR')}</code> توکن\n\n` +
      `🔹 <b>مصرف بر اساس پرووایدرها:</b>\n` +
      (provLines || 'هنوز مصرفی ثبت نشده است.') +
      `\n\n💡 <i>روتر هوشمند با توزیع بار و کش، مانع از سوختن توکن‌ها و محدودیت نرخ (429) می‌شود.</i>`;

    await api.sendMessage({
      chat_id: chat.id,
      text: msg,
      parse_mode: 'HTML',
      reply_markup: backToMenuKeyboard(),
    });
    return;
  }

  // 6.5. Admin Platform Stats Command (Strictly ADMIN_ID only)
  if (
    text === '/admin' ||
    text === '/admin_stats' ||
    text === '/stats_admin' ||
    text === '👑 آمار مدیریت سیستم' ||
    text.includes('آمار مدیریت')
  ) {
    if (from.id !== ADMIN_ID) {
      await api.sendMessage({
        chat_id: chat.id,
        text: '⛔ <b>دسترسی غیرمجاز!</b> این بخش انحصاراً برای مدیریت کل سیستم تعبیه شده است.',
        parse_mode: 'HTML',
      });
      return;
    }

    const stats = await getAdminPlatformStats();
    const msg = formatAdminStatsMessage(stats);
    await api.sendMessage({
      chat_id: chat.id,
      text: msg,
      parse_mode: 'HTML',
      reply_markup: adminStatsKeyboard(),
    });
    return;
  }

  // 7. On-Demand Forward Summary (Forward from any chat/channel to summarize instantly!)
  if (message.forward_origin || message.forward_from || message.forward_from_chat || (text.length > 80 && !text.startsWith('/'))) {
    await api.sendMessage({
      chat_id: chat.id,
      text: '🤖 <b>پیام شما دریافت شد! در حال نگارش خلاصه و فرمت‌بندی ژورنالی...</b>',
      parse_mode: 'HTML',
    });

    try {
      const prompt =
        `شما یک سردبیر ارشد هستید. این متن فوروارد شده را تحلیل و به یک پست شیک تلگرامی با تیتر، خلاصه لید و نکات کلیدی تبدیل کن:\n\n` +
        text;

      const aiRes = await generateNewsRewrite({
        systemPrompt: 'تو یک روزنامه‌نگار و نویسنده خلاق اخبار هستی. متن را روان، شیوا و خواندنی بازنویسی کن.',
        userPrompt: prompt,
        preferredProvider: user.preferredAiProvider || 'gemini',
        preferredModel: user.preferredModel || 'gemini-3.1-flash-lite',
        userId: from.id,
        routingPolicy: user.routingPolicy || 'fallback',
      });

      const fullText = aiRes.text;
      const tMatch = fullText.match(/\[TITLE\]:?\s*([^\n]+)/i);
      const sMatch = fullText.match(/\[SUMMARY\]:?\s*([\s\S]*?)(?=\[DETAILS\]|$)/i);
      const dMatch = fullText.match(/\[DETAILS\]:?\s*([\s\S]*?)$/i);

      const aiTitle = tMatch ? tMatch[1].trim() : 'خلاصه پیام فوروارد شده';
      const aiSummary = sMatch ? sMatch[1].trim() : fullText.slice(0, 200);
      const aiDetails = dMatch ? dMatch[1].trim() : '';

      const formattedHtml = buildEditorialPost({
        title: aiTitle,
        summary: aiSummary,
        deepDive: aiDetails,
        sourceName: 'پیام فورواردی',
        footerText: user.footerText || '📢 @MyLeitner',
        useExpandable: true,
      });

      await sendRichPostSafe({
        chatId: chat.id,
        postHtml: formattedHtml,
        buttons: backToMenuKeyboard(),
      });
    } catch (err) {
      await api.sendMessage({
        chat_id: chat.id,
        text: `❌ خطا در خلاصه‌سازی: ${escHtml(err.message)}`,
      });
    }
    return;
  }

  // Fallback Menu
  await api.sendMessage({
    chat_id: chat.id,
    text: '👇 لطفاً یکی از گزینه‌های منو را انتخاب کنید:',
    reply_markup: mainMenuKeyboard(user),
  });
}

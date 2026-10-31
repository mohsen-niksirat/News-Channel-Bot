import { api, db } from 'sdk';
import {
  getOrCreateUser,
  getUser,
  updateUser,
  setUserState,
  getUserSources,
  toggleSource,
  deleteSource,
  getAiKeys,
  deleteAiKey,
  moveAiKeyPriority,
  getCustomProviders,
  deleteCustomProvider,
  getTokenUsageStats,
  getDraftPosts,
  getPostById,
  markPostPublished,
  markPostRejected,
  ADMIN_ID,
  getAdminPlatformStats,
  formatAdminStatsMessage,
} from 'lib/db';
import { runScanForUser } from 'lib/scanner';
import { generateNewsRewrite, ROUTING_POLICIES } from 'lib/ai_router';
import { runHealthCheckForUser } from 'lib/health_check';
import { buildEditorialPost, buildPostButtons, sendRichPostSafe, preparePostForPublishing, escHtml } from 'lib/rich_post';
import {
  mainMenuKeyboard,
  mainReplyKeyboard,
  reviewPostKeyboard,
  sourcesManagementKeyboard,
  aiSettingsKeyboard,
  providerSelectionKeyboard,
  routingPolicyKeyboard,
  keyProviderPickerKeyboard,
  channelSettingsKeyboard,
  publishModeKeyboard,
  healthCheckKeyboard,
  adminStatsKeyboard,
  backToMenuKeyboard,
} from 'lib/keyboards';

export default async function (query) {
  if (!query || !query.data) return;
  const data = query.data;
  const from = query.from;
  const message = query.message;
  if (!message || !message.chat) return;

  const chatId = message.chat.id;
  const messageId = message.message_id;

  try {
    await api.answerCallbackQuery({ callback_query_id: query.id });
  } catch {}

  const { user } = await getOrCreateUser(from);

  // 1. Navigation Menus
  if (data === 'm:menu') {
    await setUserState(from.id, 'idle');
    try {
      await api.editMessageText({
        chat_id: chatId,
        message_id: messageId,
        text: `📰 <b>منوی اصلی استودیوی خبر تلگرام:</b>\nکانال متصل: <code>${escHtml(user.channelId || 'تنظیم‌نشده')}</code>`,
        parse_mode: 'HTML',
        reply_markup: mainMenuKeyboard(user),
      });
    } catch {
      await api.sendMessage({
        chat_id: chatId,
        text: `📰 <b>منوی اصلی استودیوی خبر تلگرام:</b>\nکانال متصل: <code>${escHtml(user.channelId || 'تنظیم‌نشده')}</code>`,
        parse_mode: 'HTML',
        reply_markup: mainMenuKeyboard(user),
      });
    }
    return;
  }

  // 1.1 Fast Scan Action
  if (data === 'act:scan') {
    await runScanForUser(from.id, chatId);
    return;
  }

  // 1.15 Admin Platform Stats (Strictly ADMIN_ID only)
  if (data === 'm:admin_stats' || data === 'act:admin_stats_refresh') {
    if (from.id !== ADMIN_ID) {
      try {
        await api.answerCallbackQuery({
          callback_query_id: query.id,
          text: '⛔ دسترسی غیرمجاز! این بخش انحصاراً مخصوص مدیر اصلی پلتفرم است.',
          show_alert: true,
        });
      } catch {}
      return;
    }

    const stats = await getAdminPlatformStats();
    const msg = formatAdminStatsMessage(stats);

    try {
      await api.editMessageText({
        chat_id: chatId,
        message_id: messageId,
        text: msg,
        parse_mode: 'HTML',
        reply_markup: adminStatsKeyboard(),
      });
      if (data === 'act:admin_stats_refresh') {
        try {
          await api.answerCallbackQuery({
            callback_query_id: query.id,
            text: '🔄 آمار زنده سیستم بروزرسانی شد.',
          });
        } catch {}
      }
    } catch {
      await api.sendMessage({
        chat_id: chatId,
        text: msg,
        parse_mode: 'HTML',
        reply_markup: adminStatsKeyboard(),
      });
    }
    return;
  }

  // Helper for rendering and paginating drafts in the review queue
  async function showReviewDraft(cId, mId, uId, index = 0, isEdit = false) {
    const drafts = await getDraftPosts(uId, 50);
    if (!drafts || drafts.length === 0) {
      const emptyText =
        '🎉 <b>صف بررسی پیش‌نویس‌ها در حال حاضر خالی است!</b>\n\n' +
        '💡 <i>نکته:</i> وقتی حالت «انتشار خودکار» روشن باشد، اخبار اسکن‌شده مستقیماً به کانال ارسال می‌شوند و در صف پیش‌نویس قرار نمی‌گیرند.\n' +
        'برای دریافت اخبار جدید می‌توانید گزینه زیر را بزنید:';
      const kb = {
        inline_keyboard: [
          [{ text: '🔍 اسکن فوری منابع', callback_data: 'act:scan' }],
          [{ text: '🔙 بازگشت به منوی اصلی', callback_data: 'm:menu' }],
        ],
      };
      if (isEdit && mId) {
        try {
          return await api.editMessageText({
            chat_id: cId,
            message_id: mId,
            text: emptyText,
            parse_mode: 'HTML',
            reply_markup: kb,
          });
        } catch {}
      }
      return await api.sendMessage({
        chat_id: cId,
        text: emptyText,
        parse_mode: 'HTML',
        reply_markup: kb,
      });
    }

    const safeIdx = Math.max(0, Math.min(index, drafts.length - 1));
    const post = drafts[safeIdx];
    const total = drafts.length;

    const cardText = `📑 <b>پیش‌نویس [${safeIdx + 1} از ${total}]</b> - منبع: <b>${escHtml(post.sourceName)}</b>\n\n${post.formattedHtml}`;
    const kb = reviewPostKeyboard(post.id, post.sourceUrl, safeIdx, total);

    if (isEdit && mId && !post.imageUrl) {
      try {
        return await api.editMessageText({
          chat_id: cId,
          message_id: mId,
          text: cardText,
          parse_mode: 'HTML',
          reply_markup: kb,
        });
      } catch {}
    }

    return await sendRichPostSafe({
      chatId: cId,
      postHtml: cardText,
      imageUrl: post.imageUrl,
      buttons: kb,
    });
  }

  // 1.2 Review Queue Navigation
  if (data.startsWith('m:review')) {
    const parts = data.split(':');
    const targetIdx = parseInt(parts[2] || '0', 10);
    await showReviewDraft(chatId, messageId, from.id, targetIdx, true);
    return;
  }

  // 1.3 Publish Mode Menu
  if (data === 'm:publish_mode') {
    const currentMode = user.publishMode || 'smart';
    const pmText =
      '📰 <b>تنظیم حالت انتشار اخبار در کانال:</b>\n\n' +
      '⚡ <b>حالت هوشمند (پیش‌فرض):</b> ۱ یا ۲ خبر جدید به صورت تک‌پست اختصاصی، و ۳ خبر به بالا در قالب یک بولتن خلاصه ساعتی تجمیع می‌شود.\n\n' +
      '📰 <b>تک‌پست اختصاصی:</b> همه اخبار همیشه به صورت جداگانه با تصویر کاور و تحلیل عمیق منتشر می‌شوند.\n\n' +
      '🗞️ <b>بولتن تجمیعی ساعتی:</b> اخبار همیشه در قالب یک خلاصه گزیده رویدادها بدون تصویر اضافه تجمیع می‌شوند.';
    try {
      await api.editMessageText({
        chat_id: chatId,
        message_id: messageId,
        text: pmText,
        parse_mode: 'HTML',
        reply_markup: publishModeKeyboard(currentMode),
      });
    } catch {
      await api.sendMessage({
        chat_id: chatId,
        text: pmText,
        parse_mode: 'HTML',
        reply_markup: publishModeKeyboard(currentMode),
      });
    }
    return;
  }

  if (data.startsWith('set_pm:')) {
    const mode = data.replace('set_pm:', '');
    await updateUser(from.id, { publishMode: mode });
    user.publishMode = mode;
    try {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: '✅ حالت انتشار با موفقیت ذخیره شد.' });
      await api.editMessageReplyMarkup({
        chat_id: chatId,
        message_id: messageId,
        reply_markup: publishModeKeyboard(mode),
      });
    } catch {}
    return;
  }

  if (data === 'act:noop') {
    return;
  }

  // 2. Publish Post to Channel (pub:<id> or pub:<id>:<index>)
  if (data.startsWith('pub:')) {
    const parts = data.split(':');
    const postId = parseInt(parts[1], 10);
    const curIdx = parseInt(parts[2] || '0', 10);
    const post = await getPostById(postId);

    if (!post || post.status === 'published') {
      try {
        await api.answerCallbackQuery({ callback_query_id: query.id, text: 'این پست قبلاً منتشر شده است!' });
      } catch {}
      await showReviewDraft(chatId, messageId, from.id, curIdx, true);
      return;
    }

    if (!user.channelId) {
      await api.sendMessage({
        chat_id: chatId,
        text: '⚠️ ابتدا باید آیدی کانال خود را از بخش «📢 تنظیمات کانال» وارد کنید.',
        reply_markup: channelSettingsKeyboard(user),
      });
      return;
    }

    // Fully format the post for channel publication (guarantees headline, summary, source link, divider, and footer tags)
    const postHtml = preparePostForPublishing({ post, user });

    const sent = await sendRichPostSafe({
      chatId: user.channelId,
      postHtml: postHtml,
      imageUrl: post.imageUrl,
      buttons: null,
      disableWebPagePreview: true,
    });

    if (sent && sent.message_id) {
      await markPostPublished(post.id, sent.message_id);
      await updateUser(from.id, { postsPublishedCount: (user.postsPublishedCount || 0) + 1 });
      try {
        await api.answerCallbackQuery({ callback_query_id: query.id, text: '🚀 پست در کانال منتشر شد! بارگذاری بعدی...' });
      } catch {}
    } else {
      await api.sendMessage({
        chat_id: chatId,
        text: `❌ خطا در ارسال به کانال! مطمئن شوید ربات در کانال ${escHtml(user.channelId)} مدیر (Admin) با دسترسی ارسال پیام است.`,
      });
    }

    // Automatically advance to the next draft in line!
    await showReviewDraft(chatId, messageId, from.id, curIdx, true);
    return;
  }

  // 3. Reject Draft (rej:<id> or rej:<id>:<index>)
  if (data.startsWith('rej:')) {
    const parts = data.split(':');
    const postId = parseInt(parts[1], 10);
    const curIdx = parseInt(parts[2] || '0', 10);
    await markPostRejected(postId);
    try {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: '🗑️ این پیش‌نویس رد شد! بارگذاری بعدی...' });
    } catch {}

    // Automatically advance to the next draft in line!
    await showReviewDraft(chatId, messageId, from.id, curIdx, true);
    return;
  }

  // 4. Regenerate Draft (regen:<id> or regen:<id>:<index>)
  if (data.startsWith('regen:')) {
    const parts = data.split(':');
    const postId = parseInt(parts[1], 10);
    const curIdx = parseInt(parts[2] || '0', 10);
    const post = await getPostById(postId);
    if (!post) return;

    try {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: '🔄 در حال بازنویسی مجدد با هوش مصنوعی...' });
    } catch {}

    try {
      const aiRes = await generateNewsRewrite({
        systemPrompt: 'تو یک روزنامه‌نگار تیزبین هستی. این خبر را با تیتری جذاب‌تر بازنویسی کن.',
        userPrompt: post.originalTitle + '\n' + (post.aiSummary || ''),
        preferredProvider: user.preferredAiProvider,
        preferredModel: user.preferredModel,
        userId: from.id,
        routingPolicy: user.routingPolicy || 'fallback',
      });

      const formatted = buildEditorialPost({
        title: 'بازنویسی: ' + post.originalTitle,
        summary: aiRes.text,
        footerText: user.footerText || `📢 ${user.channelId || '@MyLeitner'}`,
        useExpandable: true,
      });

      await db.run('UPDATE posts SET formatted_html = :html, ai_summary = :sum WHERE id = :id', {
        ':html': formatted,
        ':sum': aiRes.text.slice(0, 200),
        ':id': post.id,
      });

      await showReviewDraft(chatId, messageId, from.id, curIdx, true);
    } catch (err) {
      await api.sendMessage({ chat_id: chatId, text: `❌ خطا در بازنویسی: ${escHtml(err.message)}` });
    }
    return;
  }

  // 5. Sources Management
  if (data === 'm:sources') {
    const list = await getUserSources(from.id);
    await api.sendMessage({
      chat_id: chatId,
      text: '📡 <b>مدیریت منابع خبری:</b>\nبا لمس هر گزینه وضعیت آن فعال یا غیرفعال می‌شود:',
      parse_mode: 'HTML',
      reply_markup: sourcesManagementKeyboard(list),
    });
    return;
  }

  if (data.startsWith('tog:src:')) {
    const srcId = parseInt(data.replace('tog:src:', ''), 10);
    await toggleSource(srcId, from.id);
    const list = await getUserSources(from.id);
    try {
      await api.editMessageReplyMarkup({
        chat_id: chatId,
        message_id: messageId,
        reply_markup: sourcesManagementKeyboard(list),
      });
    } catch {}
    return;
  }

  if (data.startsWith('del:src:')) {
    const srcId = parseInt(data.replace('del:src:', ''), 10);
    await deleteSource(srcId, from.id);
    const list = await getUserSources(from.id);
    try {
      await api.editMessageReplyMarkup({
        chat_id: chatId,
        message_id: messageId,
        reply_markup: sourcesManagementKeyboard(list),
      });
    } catch {}
    return;
  }

  if (data === 'act:add_source') {
    await setUserState(from.id, 'add_source');
    await api.sendMessage({
      chat_id: chatId,
      text:
        '✏️ <b>افزودن منبع جدید:</b>\n\n' +
        'می‌توانید آیدی یک کانال تلگرام (مثلاً <code>@digiato</code>) یا آدرس یک فید RSS (مثلاً <code>https://zoomit.ir/feed/</code>) را ارسال کنید:',
      parse_mode: 'HTML',
      reply_markup: backToMenuKeyboard(),
    });
    return;
  }

  // 6. AI Management & Keys Pool
  if (data === 'm:ai') {
    const keysList = await getAiKeys(from.id);
    const cpList = await getCustomProviders(from.id);
    const policy = ROUTING_POLICIES[user.routingPolicy || 'fallback']?.name || 'فالبک اولویتی';
    const textMsg =
      `🤖 <b>مدیریت کلیدها و روتر هوش مصنوعی (مشابه ۹روتر):</b>\n\n` +
      `پرووایدر پیش‌فرض: <b>${user.preferredAiProvider.toUpperCase()}</b>\n` +
      `استراتژی فعال روتر: <b>${policy}</b>\n` +
      `تعداد کلیدهای موجود در استخر: <b>${keysList.length}</b>\n` +
      `ارائه‌دهنده‌های سفارشی: <b>${cpList.length}</b>\n\n` +
      `💡 با دکمه‌های ⬆️ و ⬇️ می‌توانید اولویت مصرف کلیدها را مطابق نیاز تنظیم کنید.`;

    try {
      await api.editMessageText({
        chat_id: chatId,
        message_id: messageId,
        text: textMsg,
        parse_mode: 'HTML',
        reply_markup: aiSettingsKeyboard(user, keysList, cpList),
      });
    } catch {
      await api.sendMessage({
        chat_id: chatId,
        text: textMsg,
        parse_mode: 'HTML',
        reply_markup: aiSettingsKeyboard(user, keysList, cpList),
      });
    }
    return;
  }

  // Priority Reordering (Up / Down)
  if (data.startsWith('up:key:') || data.startsWith('dn:key:')) {
    const dir = data.startsWith('up:key:') ? 'up' : 'down';
    const keyId = parseInt(data.replace(/^(up|dn):key:/, ''), 10);
    await moveAiKeyPriority(keyId, dir, from.id);
    const keysList = await getAiKeys(from.id);
    const cpList = await getCustomProviders(from.id);
    try {
      await api.editMessageReplyMarkup({
        chat_id: chatId,
        message_id: messageId,
        reply_markup: aiSettingsKeyboard(user, keysList, cpList),
      });
    } catch {}
    return;
  }

  if (data.startsWith('del:key:')) {
    const keyId = parseInt(data.replace('del:key:', ''), 10);
    await deleteAiKey(keyId, from.id);
    const keysList = await getAiKeys(from.id);
    const cpList = await getCustomProviders(from.id);
    try {
      await api.editMessageReplyMarkup({
        chat_id: chatId,
        message_id: messageId,
        reply_markup: aiSettingsKeyboard(user, keysList, cpList),
      });
    } catch {}
    return;
  }

  // Health Check for all keys & active models
  if (data === 'act:test_keys') {
    try {
      await api.editMessageText({
        chat_id: chatId,
        message_id: messageId,
        text: '⏳ <b>در حال تست سلامت کلیدها و دریافت مدل‌های فعال...</b>\n\nلطفاً چند ثانیه شکیبا باشید.',
        parse_mode: 'HTML',
      });
    } catch {}

    const report = await runHealthCheckForUser(from.id);

    try {
      await api.editMessageText({
        chat_id: chatId,
        message_id: messageId,
        text: report.html,
        parse_mode: 'HTML',
        reply_markup: healthCheckKeyboard(),
      });
    } catch {
      await api.sendMessage({
        chat_id: chatId,
        text: report.html,
        parse_mode: 'HTML',
        reply_markup: healthCheckKeyboard(),
      });
    }
    return;
  }

  // Add Custom Provider Wizard
  if (data === 'act:add_custom_prov') {
    await setUserState(from.id, 'add_prov_name');
    await api.sendMessage({
      chat_id: chatId,
      text:
        '🌐 <b>افزودن ارائه‌دهنده جدید هوش مصنوعی (Custom Provider):</b>\n\n' +
        'لطفاً <b>نام ارائه‌دهنده</b> را ارسال کنید (می‌تواند هر نام دلخواهی حتی فارسی باشد، مثلاً: <code>AvalAI</code> یا <code>هوش مصنوعی من</code> یا <code>DeepInfra</code>):',
      parse_mode: 'HTML',
      reply_markup: backToMenuKeyboard(),
    });
    return;
  }

  // Prompt Custom Provider Models manually
  if (data.startsWith('act:prov_models:')) {
    const provId = data.replace('act:prov_models:', '');
    await setUserState(from.id, `add_prov_models:${provId}`);
    await api.sendMessage({
      chat_id: chatId,
      text:
        '✏️ <b>افزودن دستی نام مدل‌ها:</b>\n\n' +
        'نام مدل‌ها را با کاما (,) یا در خطوط جداگانه بفرستید:\n' +
        'مثال: <code>gpt-4o, claude-3-5-sonnet, gemini-2.5-flash</code>',
      parse_mode: 'HTML',
      reply_markup: backToMenuKeyboard(),
    });
    return;
  }

  // Delete Custom Provider
  if (data.startsWith('del:prov:')) {
    const provId = parseInt(data.replace('del:prov:', ''), 10);
    await deleteCustomProvider(provId, from.id);
    const cpList = await getCustomProviders(from.id);
    const keysList = await getAiKeys(from.id);
    const updatedUser = await getUser(from.id);

    try {
      await api.editMessageText({
        chat_id: chatId,
        message_id: messageId,
        text: '🗑️ <b>ارائه‌دهنده سفارشی و تمامی کلیدهای متصل به آن با موفقیت حذف شدند.</b>\n\nتنظیمات به‌روزرسانی شد:',
        parse_mode: 'HTML',
        reply_markup: aiSettingsKeyboard(updatedUser, keysList, cpList),
      });
    } catch {
      await api.sendMessage({
        chat_id: chatId,
        text: '🗑️ <b>ارائه‌دهنده سفارشی و تمامی کلیدهای متصل به آن با موفقیت حذف شدند.</b>',
        parse_mode: 'HTML',
        reply_markup: aiSettingsKeyboard(updatedUser, keysList, cpList),
      });
    }
    return;
  }

  // Info Custom Provider Tap
  if (data.startsWith('info:prov:')) {
    try {
      await api.answerCallbackQuery({
        callback_query_id: query.id,
        text: 'برای حذف روی دکمه سطل زباله کنار آن ضربه بزنید.',
        show_alert: false,
      });
    } catch {}
    return;
  }

  // Add Key prompt
  if (data === 'act:add_key') {
    const cpList = await getCustomProviders(from.id);
    await api.sendMessage({
      chat_id: chatId,
      text: '🤖 <b>پرووایدر کلید جدید را انتخاب کنید:</b>',
      parse_mode: 'HTML',
      reply_markup: keyProviderPickerKeyboard(cpList),
    });
    return;
  }

  if (data.startsWith('prompt_key:')) {
    const provider = data.replace('prompt_key:', '');
    await setUserState(from.id, `add_key:${provider}`);
    await api.sendMessage({
      chat_id: chatId,
      text: `🔑 لطفاً کلید API مربوط به <b>${provider.toUpperCase()}</b> را ارسال فرمایید:`,
      parse_mode: 'HTML',
      reply_markup: backToMenuKeyboard(),
    });
    return;
  }

  if (data === 'm:pick_provider') {
    const cpList = await getCustomProviders(from.id);
    await api.sendMessage({
      chat_id: chatId,
      text: '⚡ لطفاً پرووایدر پیش‌فرض مدنظر خود را انتخاب فرمایید:',
      reply_markup: providerSelectionKeyboard(cpList),
    });
    return;
  }

  if (data.startsWith('set:prov:')) {
    const prov = data.replace('set:prov:', '');
    await updateUser(from.id, { preferredAiProvider: prov });
    const updated = await getUser(from.id);
    await api.sendMessage({
      chat_id: chatId,
      text: `✅ پرووایدر پیش‌فرض هوش مصنوعی با موفقیت روی <b>${prov.toUpperCase()}</b> تنظیم شد!`,
      parse_mode: 'HTML',
      reply_markup: mainMenuKeyboard(updated),
    });
    return;
  }

  // Routing Policy selection
  if (data === 'm:pick_policy') {
    await api.sendMessage({
      chat_id: chatId,
      text:
        '🔀 <b>تعیین استراتژی فراخوانی و توزیع بار بین کلیدها:</b>\n\n' +
        '• <b>فالبک (Fallback):</b> از اولین کلید بر اساس اولویت بالا/پایین شروع می‌کند و فقط هنگام خطا یا 429 به کلید بعدی سوئیچ می‌کند.\n' +
        '• <b>راند رابین (Round-Robin):</b> درخواست‌ها را به‌صورت چرخشی مساوی بین کلیدها تقسیم می‌کند تا سقف هیچ کلیدی پر نشود.\n' +
        '• <b>اسمارت روتر (Smart Router):</b> سالم‌ترین کلید را بر اساس کمترین شکست و بیشترین سرعت انتخاب می‌کند.\n' +
        '• <b>فیوژن (Fusion):</b> بالاترین دقت با تلفیق مدل‌های برتر.',
      parse_mode: 'HTML',
      reply_markup: routingPolicyKeyboard(user.routingPolicy || 'fallback'),
    });
    return;
  }

  if (data.startsWith('set:policy:')) {
    const policy = data.replace('set:policy:', '');
    await updateUser(from.id, { routingPolicy: policy });
    const updatedUser = await getUser(from.id);
    const keysList = await getAiKeys(from.id);
    const cpList = await getCustomProviders(from.id);
    const pName = ROUTING_POLICIES[policy]?.name || policy;
    await api.sendMessage({
      chat_id: chatId,
      text: `✅ استراتژی روتر با موفقیت روی <b>${pName}</b> تنظیم شد!`,
      parse_mode: 'HTML',
      reply_markup: aiSettingsKeyboard(updatedUser, keysList, cpList),
    });
    return;
  }

  // Token Usage Stats
  if (data === 'm:token_stats') {
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
      chat_id: chatId,
      text: msg,
      parse_mode: 'HTML',
      reply_markup: backToMenuKeyboard(),
    });
    return;
  }

  // 7. Channel Settings
  if (data === 'm:channel') {
    await api.sendMessage({
      chat_id: chatId,
      text: `📢 <b>تنظیمات کانال اختصاصی شما:</b>\n\nکانال متصل: <b>${escHtml(user.channelId || 'تنظیم نشده')}</b>\nحالت انتشار: <b>${user.autoPublish ? 'خودکار 🚀' : 'دستی (صف بررسی) 📑'}</b>\nامضا و فوتر: <code>${escHtml(user.footerText)}</code>`,
      parse_mode: 'HTML',
      reply_markup: channelSettingsKeyboard(user),
    });
    return;
  }

  if (data === 'tog:autopub') {
    const newAuto = !user.autoPublish;
    await updateUser(from.id, { autoPublish: newAuto });
    const updated = await getUser(from.id);
    try {
      await api.editMessageReplyMarkup({
        chat_id: chatId,
        message_id: messageId,
        reply_markup: channelSettingsKeyboard(updated),
      });
    } catch {}
    await api.sendMessage({
      chat_id: chatId,
      text: newAuto
        ? '🚀 <b>حالت انتشار خودکار روشن شد!</b>\nاز این پس خبرهای اسکن‌شده بلافاصله پس از پردازش هوش مصنوعی در کانال شما منتشر خواهند شد.'
        : '📑 <b>حالت دستی (صف بررسی) فعال شد.</b>\nخبرها قبل از انتشار در قالب پیش‌نویس برای تایید شما به پی‌وی ارسال می‌شوند.',
      parse_mode: 'HTML',
    });
    return;
  }

  if (data === 'act:set_channel') {
    await setUserState(from.id, 'set_channel');
    await api.sendMessage({
      chat_id: chatId,
      text:
        '📢 <b>تنظیم کانال اختصاصی:</b>\n\n' +
        'لطفاً آیدی کانال خود را با علامت @ بفرستید (مثال: <code>@MyLeitner</code> یا آدرس کامل):\n\n' +
        '💡 <i>نکته: ربات حتماً باید با دسترسی ارسال پیام در کانال شما «مدیر» (Administrator) شده باشد.</i>',
      parse_mode: 'HTML',
      reply_markup: backToMenuKeyboard(),
    });
    return;
  }

  if (data === 'act:set_footer') {
    await setUserState(from.id, 'set_footer');
    await api.sendMessage({
      chat_id: chatId,
      text:
        '✏️ <b>تنظیم فوتر و امضای کانال:</b>\n\n' +
        'متن یا آیدی دلخواه خود را بفرستید (این متن در انتهای تمام پست‌های منتشرشده قرار می‌گیرد، مثلاً: <code>📢 کانال رسمی: @MyLeitner</code>):',
      parse_mode: 'HTML',
      reply_markup: backToMenuKeyboard(),
    });
    return;
  }

  // 8. Daily Digest (روزنامه امروز)
  if (data === 'act:digest') {
    await api.sendMessage({
      chat_id: chatId,
      text: '🗞️ <b>در حال گردآوری و تجمیع روزنامه اختصاصی امروز با هوش مصنوعی...</b>\nلطفاً چند لحظه شکیبا باشید.',
      parse_mode: 'HTML',
    });

    try {
      const drafts = await getDraftPosts(from.id, 6);
      if (!drafts || drafts.length === 0) {
        await api.sendMessage({
          chat_id: chatId,
          text: '📌 خبر کافی برای چاپ روزنامه موجود نیست. ابتدا دکمه «🔍 اسکن فوری منابع» را بزنید.',
          reply_markup: mainMenuKeyboard(user),
        });
        return;
      }

      const combinedText = drafts.map((d, i) => `${i + 1}. [${d.sourceName}] ${d.aiTitle}: ${d.aiSummary}`).join('\n\n');

      const aiRes = await generateNewsRewrite({
        systemPrompt: 'تو سردبیر یک مجله خبری معتبر هستی. اخبار امروز را در قالب یک "روزنامه صبحگاهی ۳ دقیقه‌ای" جذاب و خوش‌خوان با ایموجی‌های مناسب دسته‌بندی و ادغام کن.',
        userPrompt: combinedText,
        preferredProvider: user.preferredAiProvider,
        preferredModel: user.preferredModel,
        userId: from.id,
        routingPolicy: user.routingPolicy || 'fallback',
      });

      const digestHtml =
        `🗞️ <b>روزنامه و خلاصه اخبار اختصاصی امروز</b>\n` +
        `📅 <i>${new Date().toLocaleDateString('fa-IR')}</i>\n` +
        `──────────────\n\n` +
        aiRes.text +
        `\n\n──────────────\n` +
        `${escHtml(user.footerText || '📢 @MyLeitner')}`;

      await sendRichPostSafe({
        chatId: chatId,
        postHtml: digestHtml,
        buttons: backToMenuKeyboard(),
      });
    } catch (err) {
      await api.sendMessage({
        chat_id: chatId,
        text: `❌ خطا در تهیه روزنامه: ${escHtml(err.message)}`,
      });
    }
    return;
  }
}

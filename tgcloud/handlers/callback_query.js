import { api } from 'sdk';
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
  providerSelectionKeyboard,
  routingPolicyKeyboard,
  keyProviderPickerKeyboard,
  channelSettingsKeyboard,
  healthCheckKeyboard,
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

  // 2. Publish Post to Channel (pub:<id>)
  if (data.startsWith('pub:')) {
    const postId = parseInt(data.replace('pub:', ''), 10);
    const post = await getPostById(postId);

    if (!post || post.status === 'published') {
      await api.sendMessage({ chat_id: chatId, text: '⚠️ این پست قبلاً منتشر شده یا یافت نشد.' });
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

    const buttons = buildPostButtons({
      sourceUrl: post.sourceUrl,
      sourceName: post.sourceName,
      summaryToCopy: post.aiSummary,
      channelUsername: user.channelId,
    });

    const sent = await sendRichPostSafe({
      chatId: user.channelId,
      postHtml: post.formattedHtml,
      imageUrl: post.imageUrl,
      buttons,
    });

    if (sent && sent.message_id) {
      await markPostPublished(post.id, sent.message_id);
      await updateUser(from.id, { postsPublishedCount: (user.postsPublishedCount || 0) + 1 });
      await api.sendMessage({
        chat_id: chatId,
        text: `✅ <b>پست با موفقیت در کانال ${escHtml(user.channelId)} منتشر شد!</b>`,
        parse_mode: 'HTML',
      });
    } else {
      await api.sendMessage({
        chat_id: chatId,
        text: `❌ خطا در ارسال به کانال! لطفاً مطمئن شوید ربات در کانال ${escHtml(user.channelId)} مدیر (Admin) است.`,
      });
    }
    return;
  }

  // 3. Reject Draft (rej:<id>)
  if (data.startsWith('rej:')) {
    const postId = parseInt(data.replace('rej:', ''), 10);
    await markPostRejected(postId);
    await api.sendMessage({
      chat_id: chatId,
      text: '🗑️ این پیش‌نویس رد و از صف خارج شد.',
    });
    return;
  }

  // 4. Regenerate Draft (regen:<id>)
  if (data.startsWith('regen:')) {
    const postId = parseInt(data.replace('regen:', ''), 10);
    const post = await getPostById(postId);
    if (!post) return;

    await api.sendMessage({ chat_id: chatId, text: '🔄 در حال بازنویسی مجدد با هوش مصنوعی...' });

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
        footerText: user.footerText || '📢 @MyLeitner',
        useExpandable: true,
      });

      await api.sendMessage({
        chat_id: chatId,
        text: `✨ <b>نسخه جدید بازنویسی شد:</b>\n\n${formatted}`,
        parse_mode: 'HTML',
        reply_markup: reviewPostKeyboard(post.id, post.sourceUrl),
      });
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
    await api.sendMessage({
      chat_id: chatId,
      text: '🗑️ ارائه‌دهنده سفارشی و کلیدهای متصل به آن حذف شدند.',
      reply_markup: providerSelectionKeyboard(cpList),
    });
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

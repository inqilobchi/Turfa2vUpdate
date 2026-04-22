require('dotenv').config();
const Fastify = require('fastify');
const puppeteer = require('puppeteer');
const fastify = Fastify({ logger: true });
const TelegramBot = require('node-telegram-bot-api');
const { fetch } = require('undici');
const cheerio = require('cheerio');
const mongoose = require('mongoose');
const axios = require('axios');
const User = require('./models/User');
const adminPanel= require('./admin'); 
const REQUIRED_CHANNELS = (process.env.REQUIRED_CHANNELS || '').split(',').map(ch => ch.trim()).filter(Boolean);
const MONGO_URI = process.env.MONGO_URI;
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim()).filter(Boolean);
const tempReferrers = new Map(); 
const userSelections = new Map();
const MAX_ATTEMPTS = 40; 
const checkInterval = 15000;  
const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { webHook: true });

const WEBHOOK_PATH = `/webhook/${token}`;
const FULL_WEBHOOK_URL = `${process.env.PUBLIC_URL}${WEBHOOK_PATH}`;
fastify.post(WEBHOOK_PATH, async (req, reply) => {
  reply.code(200).send();
  setImmediate(() => {
    try {
      bot.processUpdate(req.body);
    } catch (e) {
      console.error('processUpdate error:', e.message);
    }
  });
});

fastify.get('/healthz', (_, reply) => reply.send({ status: 'ok' }));

fastify.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' }, async (err, address) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  fastify.log.info(`Server listening at ${address}`);

  try {
    await fetch(`https://api.telegram.org/bot${token}/setWebhook?url=${FULL_WEBHOOK_URL}`);
    fastify.log.info('Webhook successfully set');
  } catch (e) {
    fastify.log.error('Webhook error:', e.message);
  }
});
bot.getMe().then((botInfo) => {
  bot.me = botInfo;
  console.log(`🤖 Bot ishga tushdi: @${bot.me.username}`);
}).catch((err) => {
  console.error("Bot ma'lumotini olishda xatolik:", err.message);
});
adminPanel(bot)
mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('MongoDBga ulandi');
}).catch(err => {
  console.error('MongoDB ulanishda xatolik:', err);
  process.exit(1);
});

async function isUserSubscribed(userId) {
  if (!REQUIRED_CHANNELS.length) return true; 

  for (const channel of REQUIRED_CHANNELS) {
    try {
      const res = await bot.getChatMember(channel, userId);
      if (!['member', 'creator', 'administrator'].includes(res.status)) {
        return false; 
      }
    } catch (err) {
      console.error(`Obuna tekshirishda xatolik [${channel}]:`, err.message);
      return false;
    }
  }

  return true;
}
async function getSubscriptionMessage() {
  const buttons = [];

  for (const channel of REQUIRED_CHANNELS) {
    try {
      const chat = await bot.getChat(channel);
      const title = chat.title || channel;
      const channelLink = `https://t.me/${channel.replace('@', '')}`;
      buttons.push([{ text: `${title}`, url: channelLink }]);
    } catch (err) {
      console.error(`Kanal nomini olishda xatolik: ${channel}`, err.message);
      // fallback
      buttons.push([{ text: `${channel}`, url: `https://t.me/${channel.replace('@', '')}` }]);
    }
  } 
  const SUPPORT_BOT_LINK = 'https://t.me/TurfaSeenBot?start=user19';
  const SUPPORT_BOT_TITILE = 'Turfa Seen | Rasmiy🤖';
  buttons.push([{ text: `${SUPPORT_BOT_TITILE}`, url: SUPPORT_BOT_LINK }]);  
  buttons.push([{ text: '✅ Obuna bo‘ldim', callback_data: 'check_subscription' }]);

  return {
    text: `<b>❗ Botdan foydalanish uchun quyidagi kanallarga obuna bo‘ling:</b>`,
    options: {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: buttons
      }
    }
  };
}

function clearUser(userId) {
  userSelections.delete(userId);
  userSelections.delete(`${userId}_selected`);
  userSelections.delete(`${userId}_selected_number`);
}

async function showNumberPage(chatId, messageId, userId, userSelections) {
  const selections = userSelections.get(userId);
  if (!selections) {
    console.error('❌ userSelections topilmadi');
    return;
  }

  const { allNumbers, receiveNumbers, currentPage, pageSize, totalPages } = selections;
  const startIdx = currentPage * pageSize;
  const endIdx = Math.min(startIdx + pageSize, allNumbers.length);
  const pageNumbers = allNumbers.slice(startIdx, endIdx);

  if (pageNumbers.length === 0) {
    return bot.editMessageText('❌ Bu sahifada raqamlar yo\'q.', {
      chat_id: chatId,
      message_id: messageId
    });
  }

  const buttons = [];
  for (let i = 0; i < pageNumbers.length; i += 2) {  
    const row = [];
    
const item1 = pageNumbers[i];
let siteLabel1 = '';
if (item1.site.includes('onlinesim.io')) {
  siteLabel1 = '🪐';
} else if (item1.site === receiveSite) {
  siteLabel1 = '🎁';
} else if (item1.site === sevenSimSite) {
  siteLabel1 = '✨';
}
row.push({ 
  text: `${item1.phone}${siteLabel1}`, 
  callback_data: `select_number_${item1.site.includes('onlinesim.io') ? 'onlinesim' : item1.site === receiveSite ? 'receive' : '7sim'}_${startIdx + i}`
});

if (i + 1 < pageNumbers.length) {
  const item2 = pageNumbers[i + 1];
  let siteLabel2 = '';
  if (item2.site.includes('onlinesim.io')) {
    siteLabel2 = '🪐';
  } else if (item2.site === receiveSite) {
    siteLabel2 = '🎁';
  } else if (item2.site === sevenSimSite) {
    siteLabel2 = '✨';
  }
  row.push({ 
    text: `${item2.phone}${siteLabel2}`, 
    callback_data: `select_number_${item2.site.includes('onlinesim.io') ? 'onlinesim' : item2.site === receiveSite ? 'receive' : '7sim'}_${startIdx + i + 1}` 
  });
} else {
      row.push({ text: '—', callback_data: null }); 
    }

    buttons.push(row);
  }

  const paginationRow = [];
  if (currentPage > 0) {
    paginationRow.push({ text: '⬅️ Oldingi', callback_data: 'prev_page', style: "success" });
  }
  paginationRow.push({ text: '🛎 Orqaga', callback_data: 'back_to_main', style: "danger" });
  if (currentPage < totalPages - 1 && allNumbers.length > pageSize) {
    paginationRow.push({ text: '➡️ Keyingi', callback_data: 'next_page', style: "success" });
  }

  if (paginationRow.length > 1 || (paginationRow.length === 1 && paginationRow[0].callback_data !== 'back_to_main')) {
    buttons.push(paginationRow);
  } else {
    buttons.push([{ text: '🛎 Orqaga', callback_data: 'back_to_main', style: "danger" }]);
  }

  let siteInfo;
  if (currentPage === 0) {
    siteInfo = `📱 Raqamni tanlang (Sahifa ${currentPage + 1}/${totalPages}):`;
  } else {
    siteInfo = `📱 Raqamni tanlang (Sahifa ${currentPage + 1}/${totalPages}):`;
  }

  return bot.editMessageText(siteInfo, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: buttons.filter(row => row.some(btn => btn.callback_data !== null)) }  
  });
}

const receiveSite = 'https://receive-sms-online.info';
const sevenSimSite = 'https://temp-sms.org';
const countries = {
  'de': { name: '🇩🇪 Germaniya', price: 12, sites: ['https://sms24.me/en/countries/de'] },
  'kr': { name: '🇰🇷 Koreya', price: 13, sites: ['https://sms24.me/en/countries/kr', 'https://sms24.me/en/countries/kr/2', 'https://sms24.me/en/countries/kr/3', 'https://sms24.me/en/countries/kr/4'] },
  'uz': { name: '🇺🇿 O\'zbekiston', price: 18, sites: ['https://sms24.me/en/countries/uz'] },
  'usa': { name: '🇺🇸 AQSH', price: 15, sites: ['https://sms24.me/en/countries/usa', 'https://sms24.me/en/countries/us/2', 'https://sms24.me/en/countries/us/3'] },
  'jp': { name: '🇯🇵 Yaponiya', price: 15, sites: ['https://sms24.me/en/countries/jp'] },
  'pt': { name: '🇵🇹 Portugaliya', price: 7, sites: ['https://sms24.me/en/countries/pt'] },
  'ar': { name: '🇦🇷 Argentina', price: 10, sites: ['https://sms24.me/en/countries/ar'] },
  'cn': { name: '🇨🇳 Xitoy', price: 11, sites: ['https://sms24.me/en/countries/cn'] },
  'at': { name: '🇦🇹 Avstriya', price: 9, sites: ['https://sms24.me/en/countries/at'] },
  'bg': { name: '🇧🇬 Bolgariya', price: 9, sites: ['https://sms24.me/en/countries/bg'] },
  'hk': { name: '🇭🇰 Gonkong', price: 13, sites: ['https://sms24.me/en/countries/hk'] },
  'in': { name: '🇮🇳 Hindiston', price: 9, sites: ['https://sms24.me/en/countries/in'] },
  'id': { name: '🇮🇩 Indoneziya', price: 7, sites: ['https://sms24.me/en/countries/id'] },
  'my': { name: '🇲🇾 Malayziya', price: 8, sites: ['https://sms24.me/en/countries/my'] },
  'mx': { name: '🇲🇽 Meksika', price: 7, sites: ['https://sms24.me/en/countries/mx'] },
  'nl': { name: '🇳🇱 Niderlandiya', price: 9, sites: ['https://sms24.me/en/countries/nl'] },
  'ng': { name: '🇳🇬 Nigeriya', price: 8, sites: ['https://sms24.me/en/countries/ng'] },
  'vn': { name: '🇻🇳 Vetnam', price: 7, sites: ['https://sms24.me/en/countries/vn'] },
  'br': { name: '🇧🇷 Braziliya', price: 10, sites: ['https://sms24.me/en/countries/br'] },
  'hr': { name: '🇭🇷 Xorvatiya', price: 11, sites: ['https://sms24.me/en/countries/hr'] },
  'ph': { name: '🇵🇭 Filippin', price: 8, sites: ['https://sms24.me/en/countries/ph'] }, 
  'es' : { name: '🇪🇸 Ispaniya', price: 13, sites: ['https://sms24.me/en/countries/es', 'https://sms24.me/en/countries/es/2', 'https://sms24.me/en/countries/es/3', 'https://sms24.me/en/countries/es/4', 'https://sms24.me/en/countries/es/5']},
  'it' : { name: '🇮🇹 Italiya', price: 10, sites: ['https://sms24.me/en/countries/it']},
  'can' : { name: '🇨🇦 Kanada', price: 8, sites: ['https://sms24.me/en/countries/ca', 'https://sms24.me/en/countries/ca/2', 'https://sms24.me/en/countries/ca/3', 'https://sms24.me/en/countries/ca/4', 'https://sms24.me/en/countries/ca/5', 'https://sms24.me/en/countries/ca/6', 'https://sms24.me/en/countries/ca/7', 'https://sms24.me/en/countries/ca/8', 'https://sms24.me/en/countries/ca/9', 'https://sms24.me/en/countries/ca/10', 'https://sms24.me/en/countries/ca/11', 'https://sms24.me/en/countries/ca/12', 'https://sms24.me/en/countries/ca/13', 'https://sms24.me/en/countries/ca/14', 'https://sms24.me/en/countries/ca/15']},
  //'7sim': { name: '✨ Tasodifiy', price: 9, sites: [sevenSimSite] }
};
const PHONE_RE = /(\+?\d[\d\s\-\(\)]{6,}\d)/g;
async function fetchHtml(url) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage'
    ]
  });

  const page = await browser.newPage();

  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36'
  );

  await page.goto(url, {
    waitUntil: 'networkidle2',
    timeout: 60000
  });

  const html = await page.content();
  await browser.close();

  return html;
}
async function safeScrape(countryKey, countries) {
  try {
    return await scrapeCountry(countryKey, countries);
  } catch (e) {
    console.log('fallback triggered:', e.message);
    return [];
  }
}
function parsePhones(html, baseUrl) {
  const $ = cheerio.load(html);
  const results = [];

  $('a').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (!text) return;

    const matches = text.match(PHONE_RE);
    if (!matches) return;

    let href = $(el).attr('href');
    if (href && !href.startsWith('http')) {
      href = new URL(href, baseUrl).toString();
    }

    for (const m of matches) {
      const phone = m.replace(/[^\d+]/g, '');
      results.push({ phone, site: baseUrl, href });
    }
  });

  // remove duplicates
  const seen = new Set();
  return results.filter(r => {
    if (seen.has(r.phone)) return false;
    seen.add(r.phone);
    return true;
  });
}
async function scrapeCountry(countryKey, countries) {
  const country = countries[countryKey];
  if (!country) return [];

  let all = [];

  for (const url of country.sites) {
    const html = await fetchHtml(url);
    if (!html) continue;

    const data = parsePhones(html, url);
    all = all.concat(data);
  }

  // final unique filter
  const seen = new Set();
  const unique = all.filter(x => {
    if (seen.has(x.phone)) return false;
    seen.add(x.phone);
    return true;
  });

  return unique;
}
function parseMessagesGeneric(html) {
  const $ = cheerio.load(html);
  const messages = [];
  $('#messages > div.message').each((i, el) => {
    const $el = $(el);
    const text = $el.text().replace(/\s+/g, ' ').trim();
    if (text) messages.push({ text });
  });
  return messages;
}
function filterPhone(phone, site) {
  if (site === sevenSimSite && phone.startsWith('+46')) {
    console.log(`🚫 +46 raqam filtrlandi: ${phone}`);
    return false;  
  }
  return true;
}

async function scrapeSite(url) {
  try {
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);
    const results = [];

    console.log(`🔍 Receive saytda 'a' elementlar soni: ${$('a').length}`);

    $('a').each((i, el) => {
      const $el = $(el);
      const text = $el.text().replace(/\s+/g, ' ').trim();
      if (!text) return;
      const matches = text.match(PHONE_RE);
      if (!matches) return;

      let href = $el.attr('href');
      if (href && !href.startsWith('http')) {
        href = new URL(href, url).toString();
      }

      for (const m of matches) {
        const phone = m.replace(/[^\d+]/g, '');
        if (filterPhone(phone, url)) {
          results.push({ site: url, phone, href });
        }
      }
    });

    const seen = new Map();
    const unique = [];
    for (const r of results) {
      if (!seen.has(r.phone)) {
        seen.set(r.phone, true);
        unique.push(r);
      }
    }
    console.log(`✅ Receive dan unique raqamlar: ${unique.length}`);
    return unique.slice(0, 64);  
  } catch (err) {
    console.error('scrapeSite failed', url, err && err.message);
    return [];
  }
}

async function scrapeSevenSim(url) {
  try {
    const html = await fetchHtml(url);
    const $ = cheerio.load(html); 
    const results = [];

    const selectors = ['a.number', 'a[href^="/number/"]', '.number-item a', 'td a[href*="/number/"]'];

    let totalElements = 0;
    selectors.forEach(sel => {
      const elements = $(sel);
      totalElements += elements.length;
    });

    $('a[href^="/number/"]').each((i, el) => {
      const $el = $(el);
      const text = $el.text().replace(/\s+/g, ' ').trim();
      if (!text) return;

      let phone = text.match(PHONE_RE);
      if (!phone) {
        const href = $el.attr('href');
        if (href && href.includes('/number/')) {
          phone = href.match(/\/number\/(\+?\d[\d\s\-\$\$]+)/); 
          if (phone) {
            phone = phone[1].replace(/[^\d+]/g, '');
          }
        }
      } else {
        phone = phone[0].replace(/[^\d+]/g, '');
      }

      if (!phone || !phone.match(PHONE_RE)) return;

      let href = $el.attr('href');
      if (href && !href.startsWith('http')) {
        href = new URL(href, url).toString();
      }

      if (filterPhone(phone, url)) {
        results.push({ site: url, phone, href });
      }
    });

    if (results.length === 0) {
      console.log('⚠️ Asosiy selector ishlamadi, barcha <a> larni tekshirish...');
      $('a').each((i, el) => {
        const $el = $(el);
        const text = $el.text().replace(/\s+/g, ' ').trim();
        if (!text) return;
        const matches = text.match(PHONE_RE);
        if (!matches) return;

        let href = $el.attr('href');
        if (href && !href.startsWith('http')) {
          href = new URL(href, url).toString();
        }

        for (const m of matches) {
          const phone = m.replace(/[^\d+]/g, '');
          if (filterPhone(phone, url)) {
            results.push({ site: url, phone, href });
          }
        }
      });
    }

    const seen = new Map();
    const unique = [];
    for (const r of results) {
      if (!seen.has(r.phone)) {
        seen.set(r.phone, true);
        unique.push(r);
      }
    }
    return unique.slice(0, 40);
  } catch (err) {
    console.error('scrapeSevenSim failed', url, err && err.message);
    return [];
  }
}
async function scrapeOnlineSim(url) {
  try {
    const html = await fetchHtml(url); // Puppeteer ishlaydi
    if (!html) return [];
    
    const $ = cheerio.load(html);
    const results = [];
    
    console.log(`🔍 SMS24.ME a[]: ${$('a').length}`);
    
    // SMS24.ME maxsus selektorlar
    const selectors = [
      'a[href*="/number/"]',
      'a[href*="/sms/"]', 
      '.phone-number',
      '.number-link',
      'td a',
      '.list-group a'
    ];
    
    selectors.forEach(sel => {
      $(sel).each((i, el) => {
        const $el = $(el);
        const text = $el.text().replace(/\s+/g, ' ').trim();
        let href = $el.attr('href');
        
        if (href && !href.startsWith('http')) {
          href = new URL(href, url).toString();
        }
        
        // Text dan telefon
        const textMatches = text.match(PHONE_RE);
        if (textMatches) {
          for (const m of textMatches) {
            const phone = m.replace(/[^\d+]/g, '');
            if (filterPhone(phone, url)) {
              results.push({ site: url, phone, href });
            }
          }
        }
        
        // URL dan telefon
        if (href) {
          const urlMatches = href.match(/\/number\/(.+?)(\/|\?|$)/) || 
                           href.match(/\/sms\/(\d+)/);
          if (urlMatches) {
            let phone = urlMatches[1].replace(/[^\d+]/g, '');
            if (filterPhone(phone, url)) {
              results.push({ site: url, phone, href });
            }
          }
        }
      });
    });
    
    // Duplicate filter
    const seen = new Map();
    const unique = results.filter(r => {
      if (!seen.has(r.phone)) {
        seen.set(r.phone, true);
        return true;
      }
      return false;
    });
    
    console.log(`✅ SMS24.ME: ${unique.length} raqamlar`);
    return unique.slice(0, 25);
  } catch (err) {
    console.error('scrapeOnlineSim failed:', url, err.message);
    return [];
  }
}
async function fetchMessagesForItem(item) {
  if (!item.href) return { ok: false, error: 'HREF yo‘q' };
  try {
    const html = await fetchHtml(item.href);
    const msgs = parseMessagesGeneric(html);
    if (msgs.length) {
      return { ok: true, url: item.href, messages: msgs.slice(0, 10) };
    }
    return { ok: false, error: 'Xabarlar topilmadi' };
  } catch (err) {
    return { ok: false, error: err.message || 'Xatolik' };
  }
}

async function getUser(userId) {
  return User.findOne({ userId }).exec();
}

async function addUser(userId, referrerId = null) {
  let exists = await getUser(userId);
  if (exists) return exists;

const userDoc = new User({
  userId,
  referals: [],
  referalCount: 0,
  referrer: null,
  agreedToTerms: false
});

if (referrerId && referrerId !== userId) {
  const referrer = await getUser(referrerId);

  if (referrer) {
    userDoc.referrer = referrerId;
    await User.updateOne(
      { userId: referrerId },
      { $addToSet: { referals: userId }, $inc: { referalCount: 1 } }
    );
  } else {
    await addUser(referrerId);
    await User.updateOne(
      { userId: referrerId },
      { $addToSet: { referals: userId }, $inc: { referalCount: 1 } }
    );
  }

  userDoc.referrer = referrerId;

  bot.sendMessage(referrerId, `<b>🎉 Sizga yangi referal qo'shildi!</b>\n<a href='tg://user?id=${userId}'>👤Ro'yxatdan o'tdi : ${userId}</a> `, {parse_mode : 'HTML'});
}

  await userDoc.save();
  return userDoc;
}
async function decrementReferals(userId, count = 5) {
  const user = await getUser(userId);
  if (!user || user.referalCount < count) return false;

  const newReferals = user.referals.slice(0, user.referals.length - count);

  await User.updateOne(
    { userId },
    { $set: { referals: newReferals }, $inc: { referalCount: -count } }
  );
  return true;
}
function termsAgreementMessage() {
  return {
    text: `<b>📜 Foydalanish shartlari</b>
<b>Botdan foydalanish orqali siz quyidagi shartlarga rozilik bildirasiz:</b>
<blockquote>
• Barcha xizmatlar bepul faqat ulardan foydalanishni bilsangiz kifoya. 
• Telegram uchun raqamlarga SMS kod kechikib kelishi yoki umuman kelmasligi mumkin. Buning uchun admin javobgar emas.
• Noto‘g‘ri foydalanish uchun javobgarlik foydalanuvchiga tegishli, adminni bekorga bezovta qilmang.
• Referal va sovg‘alar qaytarilish qoidalari bot shartlariga asosan ishlaydi.
• Qoidalarga rozilik bildirgach e'tirozlar qabul qilinmaydi.
</blockquote>
<b>⬇️ Davom etish uchun pastdagi tugmani bosing:</b>`,
    options: {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ Tasdiqlayman', callback_data: 'accept_terms' }]
        ]
      }
    }
  };
}
function mainMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📞 Raqam olish', callback_data: 'get_number', style: "primary" }],
        [{text: `🧸 Sovg'a olish`, callback_data : 'get_gift', style: "success"}],
        [{ text: '👥 Referal tizimi', callback_data: 'ref_system' }],
      ]
    }
  };
}

async function referalMenu(userId) {
  const user = await getUser(userId);
  const referalCount = user?.referalCount || 0;
  const refLink = `https://t.me/${bot.me.username}?start=${userId}`;

  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: `Referallar soni: ${referalCount}`, callback_data: 'ref_count' }],
        [{ text: '📝 Referal havola', callback_data: 'ref_link', style: "primary" }],
        [{ text: '⬅️ Orqaga', callback_data: 'back_to_main', style: "danger" }],
      ]
    },
    text: `👥 Sizning referallar soningiz: ${referalCount}\n🔗 Havolangiz:\n<code>${refLink}</code>\nUstiga bosilsa nusxa olinadi👆🏻`
  };
}

const gifts = {
  '15stars_heart' : {title : '💝', price : 25},
  '15stars_bear': {title : '🧸', price : 25},
  '25stars_rose' : {title : '🌹', price : 35},
  '25stars_gift' : {title : '🎁', price : 35}
}
bot.onText(/\/start(?: (\d+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const referrerId = match ? parseInt(match[1], 10) : null;
  if (referrerId) {
    tempReferrers.set(userId, referrerId);
  }
  
  if (!(await isUserSubscribed(userId))) {
    const sub = await getSubscriptionMessage();
    return bot.sendMessage(chatId, sub.text, sub.options);
  }
  
  const user = await addUser(userId, referrerId);

if (!user.agreedToTerms) {
  const terms = termsAgreementMessage();
  return bot.sendMessage(chatId, terms.text, terms.options);
}

await bot.sendMessage(chatId, `🦔`, mainMenu());
});

bot.on('callback_query', async (callbackQuery) => {
  const data = callbackQuery.data;
  const msg = callbackQuery.message;
  const userId = callbackQuery.from.id;
  const chatId = msg.chat.id;

  if (data === 'accept_terms') {
  await User.updateOne(
    { userId },
    { $set: { agreedToTerms: true } }
  );

  await bot.answerCallbackQuery(callbackQuery.id, {
    text: '✅ Rozilik tasdiqlandi'
  });

  return bot.editMessageText('🦔', {
    chat_id: chatId,
    message_id: msg.message_id,
    ...mainMenu()
  });
}
if (data === 'check_subscription') {
  if (await isUserSubscribed(userId)) {
    const referrerId = tempReferrers.get(userId) || null;
    const user = await addUser(userId, referrerId);
tempReferrers.delete(userId);

if (!user.agreedToTerms) {
  const terms = termsAgreementMessage();
  return bot.sendMessage(chatId, terms.text, terms.options);
}

return bot.sendMessage(chatId, '✅ Obuna tasdiqlandi!', mainMenu());
  } else {
    const sub = await getSubscriptionMessage();
    return bot.sendMessage(chatId, sub.text, sub.options);
  }
}


  if (data === 'back_to_main') {
    await bot.answerCallbackQuery(callbackQuery.id);
    return bot.editMessageText('🦔', {
      chat_id: chatId,
      message_id: msg.message_id,
      ...mainMenu()
    });
  }

  if (data === 'ref_system') {
    const menu = await referalMenu(userId);
    await bot.answerCallbackQuery(callbackQuery.id);
    return bot.editMessageText(menu.text, {
      chat_id: chatId,
      message_id: msg.message_id,
      reply_markup: menu.reply_markup,
      parse_mode: 'HTML'
    });
  }

  if (data === 'ref_count') {
    const user = await getUser(userId);
    return bot.answerCallbackQuery(callbackQuery.id, {
      text: `Sizda ${user?.referalCount || 0} ta referal bor.`
    });
  }

  if (data === 'ref_link') {
    const refLink = `https://t.me/${bot.me.username}?start=${userId}`;
    return bot.answerCallbackQuery(callbackQuery.id, {
      text: `Sizning referal havolangiz: ${refLink}`,
      show_alert: true
    });
  }
if (data === 'get_number') {
  const user = await getUser(userId);
  if (!user) {
    return bot.answerCallbackQuery(callbackQuery.id, {
      text: 'Iltimos /start buyrug‘ini yuboring.'
    });
  }

const countryEntries = Object.entries(countries);

const countryButtons = [];

for (let i = 0; i < countryEntries.length; i += 2) {
  const row = [];

  const [key1, country1] = countryEntries[i];
  row.push({
    text: `${country1.name} - ${country1.price}💎`,
    callback_data: `select_country_${key1}`
  });

  if (i + 1 < countryEntries.length) {
    const [key2, country2] = countryEntries[i + 1];
    row.push({
      text: `${country2.name} - ${country2.price} 🌿`,
      callback_data: `select_country_${key2}`
    });
  }

  countryButtons.push(row);
}

countryButtons.push([
  { text: '⬅️ Orqaga', callback_data: 'back_to_main', style: "danger" }
]);

await bot.answerCallbackQuery(callbackQuery.id);

return bot.editMessageText("🌍 Qaysi davlatdan raqam xohlaysiz?", {
  chat_id: chatId,
  message_id: msg.message_id,
  reply_markup: { inline_keyboard: countryButtons }
});
}  
if (data === 'next_page') {
  const selections = userSelections.get(userId);
  if (!selections || selections.currentPage >= selections.totalPages - 1) {
    return bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Oxirgi sahifa.' });
  }
  selections.currentPage++;
  userSelections.set(userId, selections);
  return showNumberPage(chatId, msg.message_id, userId, userSelections);
}
if (data === 'prev_page') {
  const selections = userSelections.get(userId);
  if (!selections || selections.currentPage <= 0) {
    return bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Birinchi sahifa.' });
  }
  selections.currentPage--;
  userSelections.set(userId, selections);
  return showNumberPage(chatId, msg.message_id, userId, userSelections);
}
if (data === 'get_gift') {
  const user = await getUser(userId);
  if (!user) {
    return bot.answerCallbackQuery(callbackQuery.id, {
      text: 'Iltimos /start buyrug‘ini yuboring.'
    });
  }

  const giftButtons = Object.entries(gifts).map(([key, gift]) => {
    return [{ text: gift.title, callback_data: `gift_${key}` }];
  });
  giftButtons.push([{ text: '⬅️ Orqaga', callback_data: 'back_to_main', style: "danger" }]);
  await bot.answerCallbackQuery(callbackQuery.id);
  return bot.editMessageText("⤵️ Sovg'alardan birini tanlang:", {
    chat_id: chatId,
    message_id: msg.message_id,
    reply_markup: { inline_keyboard: giftButtons }
  });
}
if (data.startsWith('gift_')) {
  const giftKey = data.slice(5);
  const gift = gifts[giftKey];

  if (!gift) {
    return bot.answerCallbackQuery(callbackQuery.id, {
      text: '❌ Bunday sovg‘a topilmadi.'
    });
  }

  const user = await getUser(userId);
  if (!user) {
    return bot.answerCallbackQuery(callbackQuery.id, {
      text: 'Iltimos /start buyrug‘ini yuboring.'
    });
  }

  if (user.referalCount < gift.price) {
    return bot.answerCallbackQuery(callbackQuery.id, {
      text: `🚫 Bu sovg‘ani olish uchun kamida ${gift.price} ta referal kerak.`,
      show_alert: true
    });
  }

  return bot.editMessageText(
    `<b>✨ Siz ${gift.title} sovg‘asini tanladingiz.</b>\n<i>❗️Ushbu sovg‘ani olish uchun ${gift.price} ta referalingiz kamaytiriladi.\n\nSizga tashlab berilishi biroz vaqt olishi mumkin.</i>\n\n<b>Tasdiqlaysizmi?</b>`,
    {
      chat_id: chatId,
      message_id: msg.message_id,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ Tasdiqlayman', callback_data: `confirm_gift_${giftKey}` }],
          [{ text: '⬅️ Orqaga', callback_data: 'get_gift' }]
        ]
      }
    }
  );
}
if (data.startsWith('select_country_')) {
  const countryKey = data.slice('select_country_'.length);
  const country = countries[countryKey];

  if (!country) {
    return bot.answerCallbackQuery(callbackQuery.id, {
      text: '❌ Bunday davlat topilmadi.'
    });
  }

  userSelections.set(`${userId}_selected_country`, countryKey);

  await bot.answerCallbackQuery(callbackQuery.id);
  return bot.editMessageText(
    `<b>${country.name}</b>\nNarxi: <b>${country.price} referal</b>\n\nSotib olishni xohlaysizmi?`,
    {
      chat_id: chatId,
      message_id: msg.message_id,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ Sotib olish', callback_data: `buy_country_${countryKey}`, style: "success" }],
          [{ text: '⬅️ Orqaga', callback_data: 'get_number', style: "danger" }]
        ]
      }
    }
  );
}

if (data.startsWith('buy_country_')) {
  const countryKey = data.slice('buy_country_'.length);
  const country = countries[countryKey];

  if (!country) {
    return bot.answerCallbackQuery(callbackQuery.id, {
      text: '❌ Davlat topilmadi.'
    });
  }

  const user = await getUser(userId);
  if (!user || user.referalCount < country.price) {
    return bot.answerCallbackQuery(callbackQuery.id, {
      text: `🚫 Yetarli referal yo‘q. Kerak: ${country.price}`,
      show_alert: true
    });
  }

  return bot.editMessageText(
    `<b>✨ ${country.name} uchun ${country.price} referal sarflanadi.</b>\n<i>❗️Tasdiqlaysizmi?</i>`,
    {
      chat_id: chatId,
      message_id: msg.message_id,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ Tasdiqlayman', callback_data: `confirm_buy_country_${countryKey}`, style: "success" }],
          [{ text: '⬅️ Orqaga', callback_data: `select_country_${countryKey}`, style: "danger" }]
        ]
      }
    }
  );
}


if (data.startsWith('confirm_buy_country_')) {
  const countryKey = data.slice('confirm_buy_country_'.length);
  const country = countries[countryKey];

  if (!country) {
    return bot.answerCallbackQuery(callbackQuery.id, {
      text: '❌ Davlat topilmadi.'
    });
  }

  const user = await getUser(userId);
  if (!user || user.referalCount < country.price) {
    return bot.answerCallbackQuery(callbackQuery.id, {
      text: '❌ Yetarli referal yo‘q.',
      show_alert: true
    });
  }

  const ok = await decrementReferals(userId, country.price);
  if (!ok) {
    return bot.answerCallbackQuery(callbackQuery.id, {
      text: '❌ Referal yechishda xatolik.',
      show_alert: true
    });
  }

const results = await scrapeCountry(countryKey, countries);

  const allNumbers = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value);

  const seen = new Map();
  const uniqueNumbers = allNumbers.filter(item => {
    if (!seen.has(item.phone)) {
      seen.set(item.phone, true);
      return true;
    }
    return false;
  });

  if (uniqueNumbers.length === 0) {
    await User.updateOne(
      { userId },
      { $inc: { referalCount: country.price } }
    );
    return bot.editMessageText('❌ Bu davlat uchun raqam topilmadi. Referal qaytarildi.', {
      chat_id: chatId,
      message_id: msg.message_id
    });
  }

  const randomIndex = Math.floor(Math.random() * uniqueNumbers.length);
  const selectedNumber = uniqueNumbers[randomIndex];

  userSelections.set(`${userId}_selected_number`, { ...selectedNumber, countryKey, cost: country.price, paid: true });

  await bot.editMessageText(
    `<b>📞 Sizga ${country.name} dan raqam berildi: <code>${selectedNumber.phone}</code></b>\n<i>👉 Endi “SMS olish” tugmasini bosing.</i>\n\n<u>10 daqiqa ichida xabar kelmasa sizga xabar beramiz.</u>`,
    {
      chat_id: chatId,
      message_id: msg.message_id,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📩 SMS olish', callback_data: 'get_sms_now', style: "success" }],
          [{ text: '❌ Bekor qilish', callback_data: 'cancel_sms', style: "danger" }],
          [{ text: '⬅️ Orqaga', callback_data: 'back_to_main' }]
        ]
      }
    }
  );
}



if (data.startsWith('confirm_gift_')) {
  const giftKey = data.slice('confirm_gift_'.length);
  const gift = gifts[giftKey];

  if (!gift) {
    return bot.answerCallbackQuery(callbackQuery.id, {
      text: '❌ Sovg‘a topilmadi.'
    });
  }

  const user = await getUser(userId);
  if (!user || user.referalCount < gift.price) {
    return bot.answerCallbackQuery(callbackQuery.id, {
      text: '❌ Yetarli referal yo‘q.',
      show_alert: true
    });
  }

  const success = await decrementReferals(userId, gift.price);
  if (!success) {
    return bot.answerCallbackQuery(callbackQuery.id, {
      text: '❌ Referal kamaytirishda xatolik.',
      show_alert: true
    });
  }

  await bot.editMessageText(
    `<b>🎉 Tabriklaymiz! Siz ${gift.title}sovg‘asini oldingiz!</b> \n<u>Referallaringizdan ${gift.price} tasi olib tashlandi.</u>\n\n <b><i>Sabrli bo'ling admin faol bo'lgach sizga buyurtmangizni yetkazib beradi.🌝</i></b>`,
    {
      chat_id: chatId,
      message_id: msg.message_id,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '⬅️ Asosiy menyuga', callback_data: 'back_to_main', style: "primary" }]
        ]
      }
    }
  );

  const fullName = `${callbackQuery.from.first_name || ''} ${callbackQuery.from.last_name || ''}`.trim();
  const username = callbackQuery.from.username ? `@${callbackQuery.from.username}` : 'yo‘q';

  const userInfoText = `
🎁 <b>Sovg‘a buyurtma qilindi</b>

🎉 Sovg‘a: <b>${gift.title}</b>
💸 Narxi: <b>${gift.price} referal</b>

🆔 ID: <code>${userId}</code>
👤 Ism: <a href="tg://user?id=${userId}"><b>${fullName}</b></a>
🔗 Username: ${username}
`.trim();

  for (const adminId of ADMIN_IDS) {
    bot.sendMessage(adminId, userInfoText, { parse_mode: 'HTML' });
  }
}


if (data.startsWith('select_number_')) {
  let idx, siteType;
  if (data.startsWith('select_number_receive_')) {
    siteType = 'receive';
    idx = parseInt(data.split('_').pop(), 10);
  } else if (data.startsWith('select_number_7sim_')) {
    siteType = '7sim';
    idx = parseInt(data.split('_').pop(), 10);
  } else if (data.startsWith('select_number_onlinesim_')) {
    siteType = 'onlinesim';
    idx = parseInt(data.split('_').pop(), 10);
  } else {
    return bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Noto\'g\'ri tanlov.' });
  }
  const selections = userSelections.get(userId);
  if (!selections) {
    return bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Raqamlar topilmadi.' });
  }
  const selected = selections.allNumbers[idx];  
  if (!selected) {
    return bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Tanlangan raqam topilmadi (indeks: ' + idx + ').' });  
  }
  const countryKey = userSelections.get(`${userId}_selected_country`);
  const country = countries[countryKey];
  if (!country) {
    return bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Davlat topilmadi.' });
  }
    const ok = await decrementReferals(userId, country.price);
  if (!ok) {
    return bot.answerCallbackQuery(callbackQuery.id, { text: '🚫 Yetarli referal yo‘q.' });
  }
  userSelections.set(`${userId}_selected_number`, {
    ...selected,
    site: selected.site,
    countryKey,
    cost: country.price,
    paid: true
  });
  const siteName = selected.site === receiveSite ? '' : '';
  await bot.answerCallbackQuery(callbackQuery.id);
  return bot.editMessageText(
    `<b>📞 Siz <code>${selected.phone}</code> raqamini tanladingiz.</b>\n<i>👉 Endi “SMS olish” tugmasini bosing.</i>`,
    {
      chat_id: chatId,
      message_id: msg.message_id,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📩 SMS olish', callback_data: 'get_sms_now', style: "success" }],
          [{ text: '⬅️ Orqaga', callback_data: 'back_to_main', style: "danger" }]
        ]
      }
    }
  );
}

  if (data === 'confirm_number') {
  const selected = userSelections.get(`${userId}_selected`);
  if (!selected) {
    return bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Raqam topilmadi.' });
  }
  
  const country = countries[selected.countryKey];
  if (!country) {
    return bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Davlat topilmadi.' });
  }

  const ok = await decrementReferals(userId, country.price);
  if (!ok) {
    return bot.answerCallbackQuery(callbackQuery.id, { text: '🚫 Yetarli referal yo‘q.' });
  }
  
  userSelections.set(`${userId}_selected_number`, {
    ...selected,
    cost: country.price,
    paid: true
  });



    return bot.editMessageText(
      `<b>📞 Siz tanlagan raqam: <code>${selected.phone}</code></b>\n<i>👉 Endi “SMS olish” tugmasini bosing.</i>`,
      {
        chat_id: chatId,
        message_id: msg.message_id,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📩 SMS olish', callback_data: 'get_sms_now', style: "success" }],
            [{ text: '⬅️ Orqaga', callback_data: 'back_to_main', style: "danger" }]
          ]
        }
      }
    );
  }


if (data === 'get_sms_now') {
  const selected = userSelections.get(`${userId}_selected_number`);
  if (!selected) {
    return bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Raqam tanlanmagan.' });
  }
 await bot.answerCallbackQuery(callbackQuery.id, { text: 'SMS kutilmoqda...' });
 userSelections.set(`${userId}_sms_start_time`, Date.now());

  let attempts = 0;
  const cancelTimer = setTimeout(async () => {
    try {
      await bot.editMessageReplyMarkup({
        inline_keyboard: [
          [{ text: '❌ Bekor qilish (Referal qaytariladi)', callback_data: 'cancel_sms' }],
          [{ text: '⬅️ Orqaga', callback_data: 'back_to_main' }]
        ]
      }, { chat_id: chatId, message_id: msg.message_id });
    } catch {}
  }, 180000);  // 3 daqiqa

  async function poll() {
    if (attempts++ >= MAX_ATTEMPTS) {
      clearTimeout(cancelTimer);
      clearUser(userId);
      return bot.editMessageText('❌ SMS kod kelmadi.', {
        chat_id: chatId,
        message_id: msg.message_id
      });
    }

    const res = await fetchMessagesForItem(selected);
    if (res.ok) {
      clearTimeout(cancelTimer);
      clearUser(userId);
      return bot.editMessageText(
        res.messages.map(m => m.text).join('\n\n'),
        { chat_id: chatId, message_id: msg.message_id }
      );
    }

    setTimeout(poll, checkInterval);
  }

  poll();
}

if (data === 'cancel_sms') {
  const selected = userSelections.get(`${userId}_selected_number`);
  if (!selected) return;

  const startTime = userSelections.get(`${userId}_sms_start_time`);
  if (!startTime || Date.now() - startTime < 180000) {  
    return bot.answerCallbackQuery(callbackQuery.id, {
      text: 'Bekor qilish 3 daqiqadan so\'ng ishlaydi.',
      show_alert: true
    });
  }

  await User.updateOne(
    { userId },
    { $inc: { referalCount: selected.cost || 0 } }
  );

  clearUser(userId);
  return bot.editMessageText(
    `<b>❌ SMS kutish bekor qilindi. Referal qaytarildi.</b>`,
    {
      chat_id: chatId,
      message_id: msg.message_id,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '⬅️ Asosiy menyuga', callback_data: 'back_to_main', style: "primary" }]
        ]
      }
    }
  );
}

  bot.answerCallbackQuery(callbackQuery.id).catch(() => {});
});

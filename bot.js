import TelegramBot from "node-telegram-bot-api";
import { db, ref, set, get } from "./firebase-config.js";

// Bot Token & Admin ID environment variables
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const ADMIN_ID = process.env.ADMIN_ID;

// Start + Buttons
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(
    chatId,
    "👋 Welcome!\n💳 Deposit বা 💰 Balance দেখার জন্য Menu ব্যবহার করুন।",
    {
      reply_markup: {
        keyboard: [["💳 Deposit", "💰 Balance"]],
        resize_keyboard: true,
        one_time_keyboard: false
      }
    }
  );
});

// Handle Buttons
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  // Deposit Start
  if (text === "💳 Deposit") {
    await set(ref(db, `pending/${chatId}`), { step: "amount" });
    bot.sendMessage(chatId, "📌 কত টাকা Add করতে চান লিখুন (যেমন: 100):");
  }

  // Balance Check
  if (text === "💰 Balance") {
    const snapshot = await get(ref(db, `balances/${chatId}`));
    const balance = snapshot.exists() ? snapshot.val() : 0;
    bot.sendMessage(chatId, `💰 আপনার বর্তমান Balance: ${balance} INR`);
  }

  // Pending Step
  const pendingSnap = await get(ref(db, `pending/${chatId}`));
  if (pendingSnap.exists()) {
    const pendingData = pendingSnap.val();

    // Step 1 → Amount
    if (pendingData.step === "amount" && !isNaN(text)) {
      const amount = parseInt(text);
      await set(ref(db, `pending/${chatId}`), { step: "utr", amount });
      bot.sendPhoto(chatId, "https://your-qr-code-link.png", {
        caption: `💳 আপনি *${amount} INR* Add করতে চাইছেন।\n\n👉 QR Code স্ক্যান করে Payment করুন\nতারপর আপনার *12 digit UTR/Transaction ID* লিখুন।`,
        parse_mode: "Markdown"
      });
    }

    // Step 2 → UTR Input
    else if (pendingData.step === "utr" && /^\d{12}$/.test(text)) {
      const amount = pendingData.amount;
      const utr = text;

      await set(ref(db, `pending/${chatId}`), { step: "waiting", amount, utr });

      bot.sendMessage(chatId, `📩 আপনার ${amount} INR ডিপোজিট রিকোয়েস্ট জমা হয়েছে। Admin verification এর পর Balance Add হবে।`);

      bot.sendMessage(ADMIN_ID, `🆕 Deposit Request\n👤 User: ${chatId}\n💰 Amount: ${amount} INR\n🧾 UTR: ${utr}\n\nApprove করতে:\n/approve ${chatId} ${utr} ${amount}`);
    }
  }
});

// Admin Approve
bot.onText(/\/approve (\d+) (\d{12}) (\d+)/, async (msg, match) => {
  const adminId = msg.chat.id;
  if (adminId != ADMIN_ID) return bot.sendMessage(adminId, "❌ You are not authorized.");

  const userId = match[1];
  const utr = match[2];
  const amount = parseInt(match[3]);

  // Add Balance
  const balanceSnap = await get(ref(db, `balances/${userId}`));
  const balance = balanceSnap.exists() ? balanceSnap.val() : 0;
  await set(ref(db, `balances/${userId}`), balance + amount);

  // Clear pending
  await set(ref(db, `pending/${userId}`), null);

  bot.sendMessage(userId, `✅ আপনার ${amount} INR Admin Approved!\n💰 বর্তমান Balance: ${balance + amount} INR`);
  bot.sendMessage(adminId, `✅ User ${userId} কে ${amount} INR Add করা হলো। Balance: ${balance + amount}`);
});      user.wallet += cashback;
      bot.sendMessage(chatId, `🎁 Reseller Cashback +${cashback}`);
    }

    await user.save();
    bot.sendMessage(chatId, `✅ Key Purchased:\n🔑 ${key}\n📅 Expires: ${expiry.toDateString()}`);
  }
});

// /reseller
bot.onText(/\/reseller/, async (msg) => {
  const chatId = msg.chat.id;
  const user = await User.findOne({ userId: chatId });

  if (!user.reseller) {
    return bot.sendMessage(chatId, "❌ You are not a reseller.");
  }

  bot.sendMessage(chatId,
    "📊 Reseller Panel:\n- Create keys for clients\n- Earn 15% cashback per key"
  );
});

// ========================
// 🔹 Admin Commands
// ========================

// /broadcast
bot.onText(/\/broadcast (.+)/, async (msg, match) => {
  if (msg.chat.id.toString() !== process.env.ADMIN_ID) return;
  const text = match[1];
  const users = await User.find({});
  users.forEach(u => bot.sendMessage(u.userId, `📢 Admin: ${text}`));
});

// /addwallet userId amount
bot.onText(/\/addwallet (\d+) (\d+)/, async (msg, match) => {
  if (msg.chat.id.toString() !== process.env.ADMIN_ID) return;
  const [ , userId, amount ] = match;
  const user = await User.findOne({ userId });
  if (!user) return bot.sendMessage(msg.chat.id, "❌ User not found.");
  user.wallet += parseInt(amount);
  await user.save();
  bot.sendMessage(msg.chat.id, `✅ Added ${amount}💰 to ${userId}`);
  bot.sendMessage(userId, `💳 Admin added ${amount}💰 to your wallet.`);
});

// /makeReseller userId
bot.onText(/\/makeReseller (\d+)/, async (msg, match) => {
  if (msg.chat.id.toString() !== process.env.ADMIN_ID) return;
  const userId = match[1];
  const user = await User.findOne({ userId });
  if (!user) return bot.sendMessage(msg.chat.id, "❌ User not found.");
  user.reseller = true;
  await user.save();
  bot.sendMessage(msg.chat.id, `✅ User ${userId} is now a Reseller.`);
  bot.sendMessage(userId, "🎉 You are now a Reseller!");
});

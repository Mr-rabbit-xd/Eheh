import TelegramBot from "node-telegram-bot-api";
import { db, ref, set, get } from "./firebase-config.js";
import 'dotenv/config';

// Bot Token & Admin ID
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const ADMIN_ID = process.env.ADMIN_ID;

// Default QR Code Link
const DEFAULT_QR = "https://via.placeholder.com/300.png?text=QR+Code";

// /start → Welcome + Buttons
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(
    chatId,
    "👋 স্বাগতম!\n💳 Deposit অথবা 💰 Balance চেক করার জন্য নিচের বাটন ব্যবহার করুন।",
    {
      reply_markup: {
        keyboard: [["💳 Deposit", "💰 Balance"]],
        resize_keyboard: true
      }
    }
  );
});

// Admin sets QR link
bot.onText(/\/setqr (.+)/, async (msg, match) => {
  if (msg.chat.id != ADMIN_ID) {
    bot.sendMessage(msg.chat.id, "❌ আপনি অ্যাডমিন নন।");
    return;
  }
  const newQR = match[1];
  await set(ref(db, "config/qr_url"), newQR);
  bot.sendMessage(ADMIN_ID, "✅ QR কোড আপডেট হয়েছে!");
});

// Handle Deposit & Balance
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith("/")) return;

  // Deposit
  if (text === "💳 Deposit") {
    await set(ref(db, `pending/${chatId}`), { step: "amount" });
    bot.sendMessage(chatId, "📌 কত টাকা Add করতে চান লিখুন (যেমন: 100):");
    return;
  }

  // Balance
  if (text === "💰 Balance") {
    const snap = await get(ref(db, `balances/${chatId}`));
    const balance = snap.exists() ? snap.val() : 0;
    bot.sendMessage(chatId, `💰 আপনার বর্তমান Balance: ${balance} INR`);
    return;
  }

  // Check Pending
  const pendingSnap = await get(ref(db, `pending/${chatId}`));
  if (!pendingSnap.exists()) return;
  const pending = pendingSnap.val();

  // Step 1 → Amount
  if (pending.step === "amount" && !isNaN(text)) {
    const amount = parseInt(text);
    await set(ref(db, `pending/${chatId}`), { step: "utr", amount });

    const qrSnap = await get(ref(db, "config/qr_url"));
    const qrUrl = qrSnap.exists() ? qrSnap.val() : DEFAULT_QR;

    bot.sendPhoto(chatId, qrUrl, {
      caption: `💳 আপনি *${amount} INR* Add করতে চাইছেন।\nQR স্ক্যান করে Payment করুন, তারপর 12-digit UTR লিখুন।`,
      parse_mode: "Markdown"
    });
    return;
  }

  // Step 2 → UTR
  if (pending.step === "utr" && /^\d{12}$/.test(text)) {
    const amount = pending.amount;
    const utr = text;

    await set(ref(db, `pending/${chatId}`), { step: "waiting", amount, utr });

    bot.sendMessage(chatId, `📩 আপনার ${amount} INR ডিপোজিট রিকোয়েস্ট জমা হয়েছে। Admin approve করলে Balance add হবে।`);

    bot.sendMessage(
      ADMIN_ID,
      `🆕 Deposit Request\n👤 User: ${chatId}\n💰 Amount: ${amount}\n🧾 UTR: ${utr}\n\nApprove করতে:\n/approve ${chatId} ${utr} ${amount}`
    );
  }
});

// Admin Approve
bot.onText(/\/approve (\d+) (\d{12}) (\d+)/, async (msg, match) => {
  if (msg.chat.id != ADMIN_ID) {
    bot.sendMessage(msg.chat.id, "❌ আপনি অ্যাডমিন নন।");
    return;
  }

  const userId = match[1];
  const utr = match[2];
  const amount = parseInt(match[3]);

  const snap = await get(ref(db, `balances/${userId}`));
  const balance = snap.exists() ? snap.val() : 0;
  await set(ref(db, `balances/${userId}`), balance + amount);

  await set(ref(db, `pending/${userId}`), null);

  bot.sendMessage(userId, `✅ আপনার ${amount} INR Approved!\n💰 নতুন Balance: ${balance + amount}`);
  bot.sendMessage(ADMIN_ID, `✅ User ${userId} কে ${amount} INR Add করা হলো। Balance: ${balance + amount}`);
});      `🧾 UTR: ${utr}\n\nApprove করতে:\n/approve ${chatId} ${utr} ${amount}`
    );
  }
});

// Admin Approve
bot.onText(/\/approve (\d+) (\d{12}) (\d+)/, async (msg, match) => {
  const adminId = msg.chat.id;
  if (adminId != ADMIN_ID) {
    bot.sendMessage(adminId, "❌ You are not authorized.");
    return;
  }

  const userId = match[1];
  const utr = match[2];
  const amount = parseInt(match[3]);

  // Add Balance
  const balanceSnap = await get(ref(db, `balances/${userId}`));
  const balance = balanceSnap.exists() ? balanceSnap.val() : 0;
  await set(ref(db, `balances/${userId}`), balance + amount);

  // Clear pending
  await set(ref(db, `pending/${userId}`), null);

  // Notify User & Admin
  bot.sendMessage(userId, `✅ আপনার ${amount} INR Admin Approved!\n💰 বর্তমান Balance: ${balance + amount} INR`);
  bot.sendMessage(adminId, `✅ User ${userId} কে ${amount} INR Add করা হলো। Balance: ${balance + amount}`);
});

import TelegramBot from "node-telegram-bot-api";
import { db, ref, set, get } from "./firebase-config.js";
import 'dotenv/config';

// Bot Token & Admin ID
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const ADMIN_ID = process.env.ADMIN_ID;

// Default QR Code Link
const DEFAULT_QR = "https://your-qr-code-link.png";

// /start → Welcome + Buttons
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

// Admin sets QR link
bot.onText(/\/setqr (.+)/, async (msg, match) => {
  const adminId = msg.chat.id;
  if (adminId != ADMIN_ID) {
    bot.sendMessage(adminId, "❌ You are not authorized.");
    return; // ✅ return inside function is ok
  }

  const newQR = match[1];
  await set(ref(db, "config/qr_url"), newQR);
  bot.sendMessage(adminId, `✅ QR Code successfully updated!`);
});

// Handle Deposit & Balance Buttons
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  // Ignore commands handled elsewhere
  if (text.startsWith("/")) return;

  // Deposit
  if (text === "💳 Deposit") {
    await set(ref(db, `pending/${chatId}`), { step: "amount" });
    bot.sendMessage(chatId, "📌 কত টাকা Add করতে চান লিখুন (যেমন: 100):");
    return;
  }

  // Balance check
  if (text === "💰 Balance") {
    const snapshot = await get(ref(db, `balances/${chatId}`));
    const balance = snapshot.exists() ? snapshot.val() : 0;
    bot.sendMessage(chatId, `💰 আপনার বর্তমান Balance: ${balance} INR`);
    return;
  }

  // Pending Step
  const pendingSnap = await get(ref(db, `pending/${chatId}`));
  if (!pendingSnap.exists()) return;

  const pendingData = pendingSnap.val();

  // Step 1 → Amount
  if (pendingData.step === "amount" && !isNaN(text)) {
    const amount = parseInt(text);
    await set(ref(db, `pending/${chatId}`), { step: "utr", amount });

    // Fetch QR from Firebase
    const qrSnap = await get(ref(db, "config/qr_url"));
    const qrUrl = qrSnap.exists() ? qrSnap.val() : DEFAULT_QR;

    bot.sendPhoto(chatId, qrUrl, {
      caption: `💳 আপনি *${amount} INR* Add করতে চাইছেন।\nScan QR Code & pay, তারপর 12-digit UTR লিখুন।`,
      parse_mode: "Markdown"
    });
    return;
  }

  // Step 2 → UTR
  if (pendingData.step === "utr" && /^\d{12}$/.test(text)) {
    const amount = pendingData.amount;
    const utr = text;

    // Save pending
    await set(ref(db, `pending/${chatId}`), { step: "waiting", amount, utr });

    // Notify User
    bot.sendMessage(chatId, `📩 আপনার ${amount} INR ডিপোজিট রিকোয়েস্ট জমা হয়েছে। Admin approval এর পর Balance add হবে।`);

    // Notify Admin
    bot.sendMessage(
      ADMIN_ID,
      `🆕 Deposit Request\n` +
      `👤 User: ${chatId}\n` +
      `💰 Amount: ${amount} INR\n` +
      `🧾 UTR: ${utr}\n\nApprove করতে:\n/approve ${chatId} ${utr} ${amount}`
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

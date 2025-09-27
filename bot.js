import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import pkg from "firebase-admin";

dotenv.config();
const { initializeApp, credential, database } = pkg;

// 🔹 Firebase Init
initializeApp({
  credential: credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  databaseURL: process.env.FIREBASE_DB_URL,
});

const db = database();
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

const ADMIN_ID = process.env.ADMIN_ID; // 🔹 তোমার Telegram ID

// ===============================
// START COMMAND
// ===============================
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  bot.sendMessage(
    chatId,
    "👋 স্বাগতম!\n\n💳 Deposit করতে বা 💰 Balance চেক করতে নিচের বাটন ব্যবহার করুন।",
    {
      reply_markup: {
        keyboard: [["💳 Deposit", "💰 Balance"]],
        resize_keyboard: true,
      },
    }
  );
});

// ===============================
// HANDLE BUTTONS
// ===============================
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  // 💰 Balance
  if (text === "💰 Balance") {
    const snapshot = await db.ref(`users/${chatId}/balance`).once("value");
    const balance = snapshot.val() || 0;
    return bot.sendMessage(chatId, `💰 আপনার বর্তমান Balance: ${balance} INR`);
  }

  // 💳 Deposit
  if (text === "💳 Deposit") {
    await db.ref(`users/${chatId}/state`).set("waiting_amount");
    return bot.sendMessage(chatId, "📌 কত টাকা Add করতে চান লিখুন (যেমন: 100)");
  }

  // ===============================
  // Deposit Amount Step
  // ===============================
  const stateSnap = await db.ref(`users/${chatId}/state`).once("value");
  const state = stateSnap.val();

  if (state === "waiting_amount" && !isNaN(text)) {
    const amount = parseInt(text);

    // ইউজার ডাটায় save করবো
    await db.ref(`users/${chatId}`).update({
      pendingAmount: amount,
      state: "waiting_utr",
    });

    // Admin সেট করা QR code আনবো
    const qrSnap = await db.ref("settings/qr").once("value");
    const qrUrl = qrSnap.val() || "https://via.placeholder.com/300x300.png?text=Set+QR";

    return bot.sendPhoto(chatId, qrUrl, {
      caption: `💳 আপনি ${amount} INR Add করতে চাইছেন\n\n👉 QR স্ক্যান করে Payment করুন\nতারপর 12-digit UTR লিখুন।`,
    });
  }

  // ===============================
  // Deposit UTR Step
  // ===============================
  if (state === "waiting_utr" && /^\d{12}$/.test(text)) {
    const amountSnap = await db.ref(`users/${chatId}/pendingAmount`).once("value");
    const amount = amountSnap.val();

    if (!amount) return bot.sendMessage(chatId, "⚠️ কোনো Pending Amount পাওয়া যায়নি। আবার চেষ্টা করুন।");

    // একই UTR আগে ব্যবহার হয়েছে কিনা check
    const utrCheck = await db.ref(`utrs/${text}`).once("value");
    if (utrCheck.exists()) {
      return bot.sendMessage(chatId, "❌ এই UTR আগে ব্যবহার করা হয়েছে!");
    }

    // Save request
    await db.ref(`requests/${chatId}_${text}`).set({
      userId: chatId,
      amount,
      utr: text,
      status: "pending",
    });

    // UTR mark as used
    await db.ref(`utrs/${text}`).set(true);

    // ইউজারের state reset
    await db.ref(`users/${chatId}`).update({ state: null, pendingAmount: null });

    // Admin কে জানানো হবে
    bot.sendMessage(
      ADMIN_ID,
      `🆕 Deposit Request\n👤 User: ${chatId}\n💰 Amount: ${amount} INR\n🧾 UTR: ${text}\n\nApprove করতে:\n/approve ${chatId} ${text} ${amount}`
    );

    return bot.sendMessage(chatId, "✅ UTR Save হয়েছে। Admin Approval এর জন্য অপেক্ষা করুন।");
  }
});

// ===============================
// ADMIN COMMAND: APPROVE
// ===============================
bot.onText(/\/approve (\d+) (\d{12}) (\d+)/, async (msg, match) => {
  const adminId = msg.chat.id;
  if (adminId != ADMIN_ID) return bot.sendMessage(adminId, "❌ আপনি Admin নন।");

  const userId = match[1];
  const utr = match[2];
  const amount = parseInt(match[3]);

  // Request check
  const reqSnap = await db.ref(`requests/${userId}_${utr}`).once("value");
  if (!reqSnap.exists()) return bot.sendMessage(adminId, "⚠️ এই Request পাওয়া যায়নি।");

  const reqData = reqSnap.val();
  if (reqData.status === "approved") {
    return bot.sendMessage(adminId, "❌ ইতিমধ্যে Approved হয়ে গেছে।");
  }

  // User balance add
  const balanceSnap = await db.ref(`users/${userId}/balance`).once("value");
  const prevBalance = balanceSnap.val() || 0;
  const newBalance = prevBalance + amount;

  await db.ref(`users/${userId}/balance`).set(newBalance);
  await db.ref(`requests/${userId}_${utr}/status`).set("approved");

  // User কে জানানো হবে
  bot.sendMessage(userId, `✅ আপনার ${amount} INR Approved!\n💰 নতুন Balance: ${newBalance} INR`);

  // Admin confirm
  return bot.sendMessage(adminId, `✅ User ${userId} কে ${amount} INR Add করা হলো\nTotal Balance: ${newBalance} INR`);
});

// ===============================
// ADMIN COMMAND: SET QR
// ===============================
bot.onText(/\/setqr (.+)/, async (msg, match) => {
  const adminId = msg.chat.id;
  if (adminId != ADMIN_ID) return bot.sendMessage(adminId, "❌ আপনি Admin নন।");

  const qrLink = match[1];
  await db.ref("settings/qr").set(qrLink);
  return bot.sendMessage(adminId, "✅ নতুন QR Link Save হয়েছে!");
});

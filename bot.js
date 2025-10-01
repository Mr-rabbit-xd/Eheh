import TelegramBot from "node-telegram-bot-api";
import mongoose from "mongoose";
import express from "express";
import dotenv from "dotenv";

dotenv.config();

// ================= CONFIG =================
const token = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;
const BOT_USERNAME = process.env.BOT_USERNAME;
let QR_IMAGE = process.env.QR_IMAGE || "https://via.placeholder.com/300?text=QR+Code";
let REF_BONUS_PERCENT = 15; // default referral bonus

// ================= MONGO =================
mongoose.connect(process.env.MONGO_URL, { useNewUrlParser: true, useUnifiedTopology: true })
.then(() => console.log("✅ MongoDB Connected"))
.catch(err => console.error("❌ MongoDB Error:", err));

// ================= SCHEMAS =================
const userSchema = new mongoose.Schema({
  userId: String,
  name: String,
  balance: { type: Number, default: 0 },
  referrals: { type: [String], default: [] },
  refCode: String,
  referredBy: String,
  deposits: { type: Array, default: [] },
  key: String,
  keyPrice: Number,
  keyExpiry: Date
});
const User = mongoose.model("User", userSchema);

const depositSchema = new mongoose.Schema({
  userId: String,
  amount: Number,
  utr: String,
  status: { type: String, default: "pending" },
  date: { type: Date, default: Date.now }
});
const Deposit = mongoose.model("Deposit", depositSchema);

// ================= EXPRESS =================
const app = express();
app.get("/", (req, res) => res.send("🤖 Bot is running 24/7!"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Server running on port ${PORT}`));

// ================= BOT =================
const bot = new TelegramBot(token, { polling: true });

// ================= HELPERS =================
function generateRefCode(userId) {
  return "REF" + userId.toString();
}

function getMainMenu() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: "💰 Balance" }, { text: "💸 Deposit" }],
        [{ text: "👥 Referral" }, { text: "🔑 Key" }],
      ],
      resize_keyboard: true,
    },
  };
}

function getDepositMenu() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: "💳 New Deposit" }],
        [{ text: "📜 Deposit History" }],
        [{ text: "⬅️ Back" }],
      ],
      resize_keyboard: true,
    },
  };
}

// ================= BOT LOGIC =================
const depositStep = {};
const utrStep = {};

// ---------------- START ----------------
bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const refCodeParam = match ? match[1] : null;

  let user = await User.findOne({ userId });
  if (!user) {
    const newRefCode = generateRefCode(userId);
    user = new User({
      userId,
      name: msg.from.first_name,
      balance: 0,
      referrals: [],
      refCode: newRefCode,
      referredBy: null,
      deposits: [],
    });

    if (refCodeParam) {
      const refUser = await User.findOne({ refCode: refCodeParam });
      if (refUser && refUser.userId !== userId) {
        user.referredBy = refUser.refCode;
        refUser.referrals.push(userId);
        await refUser.save();
        await bot.sendMessage(
          refUser.userId,
          `🎉 Your referral link invited a new user: ${msg.from.first_name}!`
        );
      }
    }

    await user.save();
  }

  bot.sendMessage(
    chatId,
    `👋 Hello ${msg.from.first_name}!\n\nSelect from menu below:`,
    getMainMenu()
  );
});

// ---------------- BALANCE ----------------
bot.onText(/💰 Balance/, async (msg) => {
  const user = await User.findOne({ userId: msg.from.id });
  bot.sendMessage(msg.chat.id, `💰 Your Balance: ${user.balance}৳`, getMainMenu());
});

// ---------------- DEPOSIT ----------------
bot.onText(/💸 Deposit/, (msg) => {
  bot.sendMessage(msg.chat.id, "💸 Deposit Menu:", getDepositMenu());
});

bot.onText(/💳 New Deposit/, (msg) => {
  depositStep[msg.chat.id] = true;
  bot.sendMessage(msg.chat.id, "💰 Enter amount to deposit:");
});

// Deposit Step handler
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (depositStep[chatId] && !isNaN(text)) {
    const amount = parseInt(text);
    await bot.sendPhoto(chatId, QR_IMAGE, {
      caption: `📥 Deposit Started!\nAmount: ${amount}৳\n\n✅ After payment, send UTR/Txn ID (min 12 characters)`,
    });
    utrStep[chatId] = { amount };
    delete depositStep[chatId];
    return;
  }

  if (utrStep[chatId]) {
    const utr = text.trim();
    if (utr.length < 12) return bot.sendMessage(chatId, "❌ UTR must be at least 12 characters.");

    const existing = await Deposit.findOne({ utr });
    if (existing) return bot.sendMessage(chatId, "❌ This UTR is already used. Enter a new one.");

    const deposit = new Deposit({ userId: chatId, amount: utrStep[chatId].amount, utr, status: "pending" });
    await deposit.save();

    await bot.sendMessage(chatId, `✅ Deposit Request Created!\nAmount: ${utrStep[chatId].amount}৳\nUTR: ${utr}`);
    utrStep[chatId] = null;
  }
});

// ---------------- ERROR HANDLING ----------------
process.on("unhandledRejection", err => console.error("Unhandled Rejection:", err));
process.on("uncaughtException", err => console.error("Uncaught Exception:", err));
// ================= REFERRAL MENU =================
bot.onText(/👥 Referral/, async (msg) => {
  const user = await User.findOne({ userId: msg.from.id });
  const refLink = `https://t.me/${BOT_USERNAME}?start=${user.refCode}`;
  bot.sendMessage(msg.chat.id, `💸 Your Referral Link:\n${refLink}`, {
    reply_markup: {
      keyboard: [
        [{ text: "👀 Check Referrals" }, { text: "🏆 Top Referrers" }],
        [{ text: "⬅️ Back" }],
      ],
      resize_keyboard: true,
    },
  });
});

bot.onText(/👀 Check Referrals/, async (msg) => {
  const user = await User.findOne({ userId: msg.from.id });
  if (!user.referrals.length) return bot.sendMessage(msg.chat.id, "❌ No referrals yet.");

  let text = "👥 Your Referrals:\n";
  for (let i = 0; i < user.referrals.length; i++) {
    const r = user.referrals[i];
    const refUser = await User.findOne({ userId: r });
    text += `${i + 1}. ${refUser ? refUser.name : r}\n`;
  }

  bot.sendMessage(msg.chat.id, text);
});

bot.onText(/🏆 Top Referrers/, async (msg) => {
  const usersList = await User.find();
  const leaderboard = usersList
    .map(u => ({ name: u.name || u.userId, count: u.referrals.length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  if (!leaderboard.length) return bot.sendMessage(msg.chat.id, "❌ No referral data.");

  let text = "🏆 Top 10 Referrers:\n";
  leaderboard.forEach((u, i) => text += `${i + 1}. ${u.name} → ${u.count} referrals\n`);
  bot.sendMessage(msg.chat.id, text);
});

// ================= KEY MENU =================
const KEY_PRICES = { 3: 150, 7: 300, 15: 500, 30: 1000 };

bot.onText(/🔑 Key/, (msg) => {
  const priceText = Object.entries(KEY_PRICES)
    .map(([days, price]) => `${days} day → ${price}৳`)
    .join("\n");

  bot.sendMessage(msg.chat.id, `🔑 Key Options:\n${priceText}\n\nReply with day number to buy key (3,7,15,30).`, {
    reply_markup: { remove_keyboard: true },
  });
});

bot.onText(/^\d+$/, async (msg) => {
  const day = parseInt(msg.text);
  if (!KEY_PRICES[day]) return;
  const price = KEY_PRICES[day];
  const user = await User.findOne({ userId: msg.from.id });

  if (user.balance < price) return bot.sendMessage(msg.chat.id, `❌ Not enough balance. Key price: ${price}৳`);

  user.balance -= price;
  user.key = "KEY-" + Math.random().toString(36).substring(2, 10).toUpperCase();
  user.keyPrice = price;
  user.keyExpiry = new Date(Date.now() + day * 24 * 60 * 60 * 1000);
  await user.save();

  bot.sendMessage(msg.chat.id, `✅ Key Purchased!\nKey: ${user.key}\nExpires in: ${day} days\n💰 Remaining Balance: ${user.balance}৳`);
});

// ---------------- BACK BUTTON ----------------
bot.onText(/⬅️ Back/, (msg) => {
  bot.sendMessage(msg.chat.id, "⬅️ Main Menu:", getMainMenu());
});

// ---------------- ADMIN INLINE BUTTON FOR DEPOSIT ----------------
bot.on("callback_query", async (query) => {
  const data = query.data;
  const chatId = query.message.chat.id;

  if (chatId.toString() !== ADMIN_ID) return bot.answerCallbackQuery(query.id, { text: "❌ Only admin." });

  const [action, depositId] = data.split("_");
  const deposit = await Deposit.findById(depositId);
  if (!deposit) return bot.answerCallbackQuery(query.id, { text: "❌ Deposit not found." });

  const user = await User.findOne({ userId: deposit.userId });
  if (!user) return bot.answerCallbackQuery(query.id, { text: "❌ User not found." });

  if (action === "approve") {
    user.balance += deposit.amount;
    deposit.status = "approved";

    // Referral bonus
    if (user.referredBy) {
      const refUser = await User.findOne({ refCode: user.referredBy });
      if (refUser) {
        const bonus = Math.floor((REF_BONUS_PERCENT / 100) * deposit.amount);
        refUser.balance += bonus;
        await refUser.save();
        await bot.sendMessage(refUser.userId, `🎁 You received ${bonus}৳ as referral bonus!`);
      }
    }

    await user.save();
    await deposit.save();
    bot.sendMessage(user.userId, `✅ Your ${deposit.amount}৳ deposit has been approved!\n💰 New Balance: ${user.balance}৳`);
  } else if (action === "cancel") {
    deposit.status = "cancelled";
    await deposit.save();
    bot.sendMessage(user.userId, `❌ Your ${deposit.amount}৳ deposit has been cancelled.`);
  }

  bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: ADMIN_ID, message_id: query.message.message_id });
  bot.answerCallbackQuery(query.id, { text: action === "approve" ? "✅ Approved!" : "❌ Cancelled!" });
});
// ================= ADMIN COMMANDS =================

// Admin command list (chat message buttons, keyboard-free)
bot.onText(/\/admin/, async (msg) => {
  if (msg.from.id.toString() !== ADMIN_ID) return;
  const text = `🛠 Admin Panel Commands:

1️⃣ /setqr <URL> - Set Deposit QR Image
2️⃣ /setkeyprice <days> <price> - Change Key Price
3️⃣ /broadcast <message> - Send message to all users
4️⃣ /stats - Show total users, deposits, referrals
5️⃣ /promocode <code> <amount> - Add promo code`;

  bot.sendMessage(msg.chat.id, text);
});

// ---------------- SET QR ----------------
bot.onText(/\/setqr (.+)/, (msg, match) => {
  if (msg.from.id.toString() !== ADMIN_ID) return;
  QR_IMAGE = match[1];
  bot.sendMessage(msg.chat.id, `✅ New QR set:\n${QR_IMAGE}`);
});

// ---------------- SET KEY PRICE ----------------
bot.onText(/\/setkeyprice (\d+) (\d+)/, (msg, match) => {
  if (msg.from.id.toString() !== ADMIN_ID) return;
  const days = parseInt(match[1]);
  const price = parseInt(match[2]);
  if (!KEY_PRICES[days]) return bot.sendMessage(msg.chat.id, "❌ Invalid day. Use 3,7,15,30.");
  KEY_PRICES[days] = price;
  bot.sendMessage(msg.chat.id, `✅ Key price updated: ${days} day → ${price}৳`);
});

// ---------------- BROADCAST ----------------
bot.onText(/\/broadcast (.+)/, async (msg, match) => {
  if (msg.from.id.toString() !== ADMIN_ID) return;
  const allUsers = await User.find();
  const message = match[1];
  for (let u of allUsers) {
    try { await bot.sendMessage(u.userId, `📢 Broadcast:\n${message}`); } catch(e) {}
  }
  bot.sendMessage(msg.chat.id, `✅ Broadcast sent to ${allUsers.length} users`);
});

// ---------------- STATS ----------------
bot.onText(/\/stats/, async (msg) => {
  if (msg.from.id.toString() !== ADMIN_ID) return;
  const totalUsers = await User.countDocuments();
  const totalDeposits = await Deposit.countDocuments({ status: "approved" });
  const totalReferralEarnings = (await User.find()).reduce((acc,u) => acc + (u.referrals.length * 0), 0); // placeholder
  bot.sendMessage(msg.chat.id, `📊 Stats:

Total Users: ${totalUsers}
Total Approved Deposits: ${totalDeposits}
Total Referral Count: ${totalReferralEarnings}`);
});

// ---------------- PROMO CODES ----------------
let PROMO_CODES = {}; // { code: amount }
bot.onText(/\/promocode (\S+) (\d+)/, (msg, match) => {
  if (msg.from.id.toString() !== ADMIN_ID) return;
  const code = match[1].toUpperCase();
  const amount = parseInt(match[2]);
  PROMO_CODES[code] = amount;
  bot.sendMessage(msg.chat.id, `✅ Promo code added: ${code} → ${amount}৳`);
});

// ---------------- USE PROMO ----------------
bot.onText(/\/usepromo (\S+)/, async (msg, match) => {
  const code = match[1].toUpperCase();
  const user = await User.findOne({ userId: msg.from.id });
  if (!PROMO_CODES[code]) return bot.sendMessage(msg.chat.id, "❌ Invalid promo code.");
  user.balance += PROMO_CODES[code];
  await user.save();
  bot.sendMessage(msg.chat.id, `✅ Promo applied! ${PROMO_CODES[code]}৳ added. New Balance: ${user.balance}৳`);
  delete PROMO_CODES[code]; // single-use
});

// ---------------- ERROR HANDLING ----------------
process.on("unhandledRejection", err => console.error("Unhandled Rejection:", err));
process.on("uncaughtException", err => console.error("Uncaught Exception:", err));

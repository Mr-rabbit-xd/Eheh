import TelegramBot from "node-telegram-bot-api";
import mongoose from "mongoose";
import express from "express";
import dotenv from "dotenv";

dotenv.config();

// ================= CONFIG ==================
const TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;
const BOT_USERNAME = process.env.BOT_USERNAME;
const DEFAULT_REF_BONUS = 15;
let QR_IMAGE = process.env.QR_IMAGE || "https://via.placeholder.com/300?text=QR+Code";

// ================= TELEGRAM BOT ==================
const bot = new TelegramBot(TOKEN, { polling: true });

// ================= EXPRESS KEEP-ALIVE ==================
const app = express();
app.get("/", (req, res) => res.send("🤖 Bot is running 24/7!"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Server running on port ${PORT}`));

// ================= MONGODB ==================
mongoose.connect(process.env.MONGO_URL, { useNewUrlParser: true, useUnifiedTopology: true })
.then(() => console.log("✅ MongoDB Connected"))
.catch(err => console.log("❌ MongoDB Error:", err));

// ================= SCHEMAS ==================
const userSchema = new mongoose.Schema({
  userId: Number,
  name: String,
  balance: { type: Number, default: 0 },
  refCode: String,
  referredBy: String,
  referrals: { type: [Number], default: [] },
  deposits: { type: Array, default: [] },
  key: String
});
const User = mongoose.model("User", userSchema);

const configSchema = new mongoose.Schema({
  refBonusPercent: { type: Number, default: DEFAULT_REF_BONUS }
});
const Config = mongoose.model("Config", configSchema);
let config;
Config.findOne().then(c => { config = c || new Config(); });

// ================= BUTTON MENUS ==================
const getMainMenu = () => ({
  reply_markup: {
    keyboard: [
      [{ text: "💰 Balance" }, { text: "💸 Deposit" }],
      [{ text: "👥 Referral" }, { text: "📜 Transactions" }],
      [{ text: "🔑 Key" }]
    ],
    resize_keyboard: true
  }
});

const getDepositMenu = () => ({
  reply_markup: {
    keyboard: [
      [{ text: "💳 New Deposit" }],
      [{ text: "📜 Deposit History" }],
      [{ text: "⬅️ Back" }]
    ],
    resize_keyboard: true
  }
});

const getReferralMenu = () => ({
  reply_markup: {
    keyboard: [
      [{ text: "👀 Check Referrals" }, { text: "🏆 Top Referrers" }],
      [{ text: "⬅️ Back" }]
    ],
    resize_keyboard: true
  }
});

const getKeyMenu = () => ({
  reply_markup: {
    keyboard: [
      [{ text: "🆕 Get Key" }, { text: "🔑 Your Key" }],
      [{ text: "⬅️ Back" }]
    ],
    resize_keyboard: true
  }
});

// ================= BOT LOGIC ==================
let depositStep = {};
let utrStep = {};

// Helper: generate unique referral code
const generateRefCode = (userId) => "REF" + userId;

// ================= START ==================
bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const name = msg.from.first_name;
  const refCodeFromStart = match[1];

  let user = await User.findOne({ userId });
  if (!user) {
    user = new User({
      userId,
      name,
      balance: 0,
      refCode: generateRefCode(userId),
      referredBy: null
    });

    // Referral logic
    if (refCodeFromStart) {
      const refUser = await User.findOne({ refCode: refCodeFromStart });
      if (refUser && refUser.userId !== userId) {
        user.referredBy = refUser.refCode;
        refUser.referrals.push(userId);
        await refUser.save();
        bot.sendMessage(refUser.userId, `🎉 New user (${name}) joined using your referral link!`);
      }
    }
    await user.save();
  }

  bot.sendMessage(chatId, `👋 Welcome ${name}!\nChoose an option from the menu:`, getMainMenu());
});

// ================= BALANCE ==================
bot.onText(/💰 Balance/, async (msg) => {
  const user = await User.findOne({ userId: msg.from.id });
  bot.sendMessage(msg.chat.id, `💰 Your Balance: ${user.balance}₹`, getMainMenu());
});

// ================= DEPOSIT ==================
bot.onText(/💸 Deposit/, (msg) => {
  bot.sendMessage(msg.chat.id, "💸 Deposit Menu:", getDepositMenu());
});

bot.onText(/💳 New Deposit/, (msg) => {
  depositStep[msg.from.id] = true;
  bot.sendMessage(msg.chat.id, "💰 Enter deposit amount:");
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  // Amount Step
  if (depositStep[userId]) {
    const amount = parseInt(msg.text);
    if (isNaN(amount) || amount <= 0) return bot.sendMessage(chatId, "❌ Invalid amount. Numbers only:");
    utrStep[userId] = { amount };
    delete depositStep[userId];

    // Show QR
    await bot.sendPhoto(chatId, QR_IMAGE, {
      caption: `💰 Deposit Amount: ${amount}₹\nScan QR to pay and then send UTR/Txn ID (min 12 characters)`
    });
    return;
  }

  // UTR Step
  if (utrStep[userId]) {
    const utr = msg.text.trim();
    if (utr.length < 12) return bot.sendMessage(chatId, "❌ UTR must be at least 12 characters. Please re-enter:");
    const user = await User.findOne({ userId });
    const duplicate = await User.findOne({ "deposits.utr": utr });
    if (duplicate) return bot.sendMessage(chatId, "❌ This UTR has already been used. Enter a new one:");
    const deposit = { amount: utrStep[userId].amount, utr, status: "pending" };
    user.deposits.push(deposit);
    await user.save();
    utrStep[userId] = null;
    bot.sendMessage(chatId, `✅ Deposit request created!\n💰 Amount: ${deposit.amount}\n🔑 UTR: ${deposit.utr}`, getDepositMenu());

    // Admin Notification
    const approveData = `approve_${userId}_${utr}`;
    const cancelData = `cancel_${userId}_${utr}`;
    bot.sendMessage(ADMIN_ID,
      `📢 New Deposit Request\n👤 ${user.name}\n💰 ${deposit.amount}\n🔑 ${deposit.utr}`,
      { reply_markup: { inline_keyboard: [[{ text: "✅ Approve", callback_data: approveData }, { text: "❌ Cancel", callback_data: cancelData }]] } }
    );
  }
});

// ================= ADMIN APPROVE/CANCEL ==================
bot.on("callback_query", async (query) => {
  const data = query.data;
  const chatId = query.message.chat.id;
  if (chatId.toString() !== ADMIN_ID) return bot.answerCallbackQuery(query.id, { text: "❌ Only admin can approve/cancel." });
  const [action, userIdStr, utr] = data.split("_");
  const userId = parseInt(userIdStr);
  const user = await User.findOne({ userId });
  if (!user) return bot.answerCallbackQuery(query.id, { text: "❌ User not found." });
  const deposit = user.deposits.find(d => d.utr === utr);
  if (!deposit) return bot.answerCallbackQuery(query.id, { text: "❌ Deposit not found." });

  if (action === "approve") {
    deposit.status = "approved";
    user.balance += deposit.amount;

    // Referral bonus
    if (user.referredBy) {
      const refUser = await User.findOne({ refCode: user.referredBy });
      if (refUser) {
        const bonus = Math.floor((deposit.amount * config.refBonusPercent) / 100);
        refUser.balance += bonus;
        await refUser.save();
        bot.sendMessage(refUser.userId, `💸 You earned ${bonus}₹ (${config.refBonusPercent}%) referral bonus from ${user.name}'s deposit!`);
      }
    }

    await user.save();
    bot.sendMessage(user.userId, `✅ Your deposit of ${deposit.amount}₹ has been approved! 💰 New Balance: ${user.balance}`);
  } else if (action === "cancel") {
    deposit.status = "cancelled";
    await user.save();
    bot.sendMessage(user.userId, `❌ Your deposit of ${deposit.amount}₹ has been cancelled.`);
  }

  bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: ADMIN_ID, message_id: query.message.message_id });
  bot.answerCallbackQuery(query.id, { text: action === "approve" ? "✅ Approved!" : "❌ Cancelled!" });
});

// ================= TRANSACTION HISTORY ==================
bot.onText(/📜 Transactions/, async (msg) => {
  const user = await User.findOne({ userId: msg.from.id });
  if (!user.deposits.length) return bot.sendMessage(msg.chat.id, "❌ No deposit history.", getMainMenu());
  let text = "📜 Deposit History:\n";
  user.deposits.forEach((d, i) => text += `${i+1}. ${d.amount}₹ | UTR: ${d.utr} | Status: ${d.status}\n`);
  bot.sendMessage(msg.chat.id, text, getMainMenu());
});

// ================= REFERRAL ==================
bot.onText(/👥 Referral/, async (msg) => {
  const user = await User.findOne({ userId: msg.from.id });
  const refLink = `https://t.me/${BOT_USERNAME}?start=${user.refCode}`;
  bot.sendMessage(msg.chat.id, `💸 Your Referral Link:\n${refLink}`, getReferralMenu());
});

bot.onText(/👀 Check Referrals/, async (msg) => {
  const user = await User.findOne({ userId: msg.from.id });
  if (!user.referrals.length) return bot.sendMessage(msg.chat.id, "❌ No referrals yet.", getReferralMenu());
  let text = "👥 Your Referrals:\n";
  user.referrals.forEach((r, i) => {
    const refUser = await User.findOne({ userId: r });
    text += `${i + 1}. ${refUser ? refUser.name : r}\n`;
  });
  bot.sendMessage(msg.chat.id, text, getReferralMenu());
});

bot.onText(/🏆 Top Referrers/, async (msg) => {
  const usersList = await User.find();
  const leaderboard = usersList
    .map(u => ({ name: u.name || u.userId, count: u.referrals.length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  if (!leaderboard.length) return bot.sendMessage(msg.chat.id, "❌ No referral data.", getReferralMenu());

  let text = "🏆 Top 10 Referrers:\n";
  leaderboard.forEach((u, i) => text += `${i+1}. ${u.name} → ${u.count} referrals\n`);
  bot.sendMessage(msg.chat.id, text, getReferralMenu());
});

// ================= KEY SYSTEM ==================
bot.onText(/🔑 Key/, (msg) => {
  bot.sendMessage(msg.chat.id, "🔑 Key Menu:", getKeyMenu());
});

bot.onText(/🆕 Get Key/, async (msg) => {
  const user = await User.findOne({ userId: msg.from.id });
  user.key = "KEY-" + Math.random().toString(36).substring(2, 10).toUpperCase();
  await user.save();
  bot.sendMessage(msg.chat.id, `✅ Your new Key:\n${user.key}`, getKeyMenu());
});

bot.onText(/🔑 Your Key/, async (msg) => {
  const user = await User.findOne({ userId: msg.from.id });
  if (!user.key) return bot.sendMessage(msg.chat.id, "❌ You have no Key yet.", getKeyMenu());
  bot.sendMessage(msg.chat.id, `🔑 Your Key:\n${user.key}`, getKeyMenu());
});

// ================= BACK BUTTON ==================
bot.onText(/⬅️ Back/, (msg) => {
  bot.sendMessage(msg.chat.id, "⬅️ Main Menu:", getMainMenu());
});

// ================= ADMIN CHANGE QR ==================
bot.onText(/\/setqr (.+)/, (msg, match) => {
  if (msg.from.id.toString() !== ADMIN_ID) return bot.sendMessage(msg.chat.id, "❌ Only admin can change QR.");
  QR_IMAGE = match[1];
  bot.sendMessage(msg.chat.id, `✅ New QR set:\n${QR_IMAGE}`);
});

// ================= ADMIN CHANGE REF BONUS ==================
bot.onText(/\/setrefbonus (\d+)/, async (msg, match) => {
  if (msg.from.id.toString() !== ADMIN_ID) return bot.sendMessage(msg.chat.id, "❌ Only admin can change referral bonus.");
  const percent = parseInt(match[1]);
  if (isNaN(percent) || percent < 0) return bot.sendMessage(msg.chat.id, "❌ Invalid value.");
  config.refBonusPercent = percent;
  await config.save();
  bot.sendMessage(msg.chat.id, `✅ Referral bonus updated to ${percent}%`);
});

// ================= ERROR HANDLING ==================
process.on("unhandledRejection", err => console.error("Unhandled Rejection:", err));
process.on("uncaughtException", err => console.error("Uncaught Exception:", err));

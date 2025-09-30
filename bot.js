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
let REF_BONUS_PERCENT = 5; // referral %
let DEPOSIT_BONUS_PERCENT = 5; // deposit bonus (above threshold)
let DEPOSIT_BONUS_THRESHOLD = 500;

// ================= MONGODB =================
mongoose.connect(process.env.MONGO_URL, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
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
  role: { type: String, default: "user" }, // user/reseller/admin
});

const User = mongoose.model("User", userSchema);

const depositSchema = new mongoose.Schema({
  userId: String,
  amount: Number,
  utr: String,
  status: { type: String, default: "pending" },
  date: { type: Date, default: Date.now },
});

const Deposit = mongoose.model("Deposit", depositSchema);

const promoSchema = new mongoose.Schema({
  code: String,
  amount: Number,
  usedBy: { type: [String], default: [] },
  expiry: Date,
});

const Promo = mongoose.model("Promo", promoSchema);

// ================= EXPRESS =================
const app = express();
app.get("/", (req, res) => res.send("🤖 Bot is running 24/7!"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Server running on port ${PORT}`));

// ================= TELEGRAM BOT =================
const bot = new TelegramBot(token, { polling: true });

// ================= HELPERS =================
function generateRefCode(userId) {
  return "REF" + userId.toString();
}

function generateApiKey() {
  return "KEY-" + Math.random().toString(36).substring(2, 10).toUpperCase();
}

function getMainMenu() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: "💰 Balance" }, { text: "💸 Deposit" }],
        [{ text: "👥 Referral" }, { text: "🔑 Key" }],
        [{ text: "🎁 Promo" }, { text: "🏆 Leaderboard" }],
        [{ text: "📊 My Stats" }],
      ],
      resize_keyboard: true,
    },
  };
}

// Deposit, Referral, Key, Promo sub-menus
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

function getReferralMenu() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: "👀 Check Referrals" }, { text: "🏆 Top Referrers" }],
        [{ text: "⬅️ Back" }],
      ],
      resize_keyboard: true,
    },
  };
}

function getKeyMenu() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: "🆕 Get Key" }, { text: "🔑 Your Key" }],
        [{ text: "♻️ Renew Key" }],
        [{ text: "⬅️ Back" }],
      ],
      resize_keyboard: true,
    },
  };
}

function getPromoMenu() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: "🎁 Apply Promo" }],
        [{ text: "⬅️ Back" }],
      ],
      resize_keyboard: true,
    },
  };
}

// ================= BOT LOGIC =================
const depositStep = {};
const utrStep = {};
const promoStep = {};

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
    `👋 *Welcome ${msg.from.first_name}!*\n\n` +
    `এই বট দিয়ে তুমি করতে পারো 💰 Deposit, 👥 Referral Income, 🎁 Promo Claim, 🔑 API Key Generate ইত্যাদি।\n\n` +
    `👉 API Key পাওয়ার জন্য "🔑 Key" মেনু ব্যবহার করো।\n` +
    `👉 টাকা আয় করার সব উপায় দেখতে "📊 My Stats" ব্যবহার করো।\n\n` +
    `🚀 চল শুরু করি!`,
    { ...getMainMenu(), parse_mode: "Markdown" }
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

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  // Deposit Step
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
    if (existing) return bot.sendMessage(chatId, "❌ This UTR is already used.");

    const deposit = new Deposit({ userId: chatId, amount: utrStep[chatId].amount, utr, status: "pending" });
    await deposit.save();

    await bot.sendMessage(chatId, `✅ Deposit Request Created!\nAmount: ${utrStep[chatId].amount}৳\nUTR: ${utr}`);

    // Notify Admin
    await bot.sendMessage(
      ADMIN_ID,
      `📢 New Deposit Request:\n👤 ${msg.from.first_name} (@${msg.from.username || "NA"})\n💰 ${utrStep[chatId].amount}৳\nUTR: ${utr}`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "✅ Approve", callback_data: `approve_${deposit._id}` }, { text: "❌ Cancel", callback_data: `cancel_${deposit._id}` }],
          ],
        },
      }
    );

    utrStep[chatId] = null;
    return;
  }

  // Promo Step
  if (promoStep[chatId]) {
    const code = text.trim().toUpperCase();
    const promo = await Promo.findOne({ code });
    if (!promo) {
      bot.sendMessage(chatId, "❌ Invalid promo code.", getPromoMenu());
    } else if (promo.expiry && promo.expiry < new Date()) {
      bot.sendMessage(chatId, "❌ Promo expired.", getPromoMenu());
    } else if (promo.usedBy.includes(msg.from.id.toString())) {
      bot.sendMessage(chatId, "❌ You already used this code.", getPromoMenu());
    } else {
      const user = await User.findOne({ userId: msg.from.id });
      user.balance += promo.amount;
      await user.save();
      promo.usedBy.push(msg.from.id.toString());
      await promo.save();
      bot.sendMessage(chatId, `🎁 Promo applied! +${promo.amount}৳ added to your wallet.`, getPromoMenu());
    }
    promoStep[chatId] = null;
    return;
  }
});

// ---------------- ADMIN INLINE BUTTON ----------------
bot.on("callback_query", async (query) => {
  const [action, depositId] = query.data.split("_");
  const deposit = await Deposit.findById(depositId);
  if (!deposit) return bot.answerCallbackQuery(query.id, { text: "❌ Deposit not found." });

  const user = await User.findOne({ userId: deposit.userId });
  if (!user) return bot.answerCallbackQuery(query.id, { text: "❌ User not found." });

  if (action === "approve") {
    let finalAmount = deposit.amount;

    // Deposit bonus
    if (deposit.amount >= DEPOSIT_BONUS_THRESHOLD) {
      const bonus = Math.floor((DEPOSIT_BONUS_PERCENT / 100) * deposit.amount);
      finalAmount += bonus;
      await bot.sendMessage(user.userId, `🎁 Deposit Bonus! You received +${bonus}৳ extra.`);
    }

    user.balance += finalAmount;
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
    bot.sendMessage(user.userId, `✅ Your ${deposit.amount}৳ deposit approved!\n💰 New Balance: ${user.balance}৳`);
  } else if (action === "cancel") {
    deposit.status = "cancelled";
    await deposit.save();
    bot.sendMessage(user.userId, `❌ Your ${deposit.amount}৳ deposit has been cancelled.`);
  }

  bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: ADMIN_ID, message_id: query.message.message_id });
  bot.answerCallbackQuery(query.id, { text: action === "approve" ? "✅ Approved!" : "❌ Cancelled!" });
});

// ---------------- REFERRAL MENU ----------------
bot.onText(/👥 Referral/, (msg) => bot.sendMessage(msg.chat.id, "👥 Referral Menu:", getReferralMenu()));

bot.onText(/👀 Check Referrals/, async (msg) => {
  const user = await User.findOne({ userId: msg.from.id });
  if (!user.referrals.length) return bot.sendMessage(msg.chat.id, "❌ No referrals yet.", getReferralMenu());

  let text = "👥 Your Referrals:\n";
  for (let i = 0; i < user.referrals.length; i++) {
    const r = user.referrals[i];
    const refUser = await User.findOne({ userId: r });
    text += `${i + 1}. ${refUser ? refUser.name : r}\n`;
  }
  bot.sendMessage(msg.chat.id, text, getReferralMenu());
});

bot.onText(/🏆 Top Referrers/, async (msg) => {
  const users = await User.find();
  const leaderboard = users
    .map(u => ({ name: u.name || u.userId, count: u.referrals.length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  if (!leaderboard.length) return bot.sendMessage(msg.chat.id, "❌ No referral data.", getReferralMenu());

  let text = "🏆 Top 10 Referrers:\n";
  leaderboard.forEach((u, i) => text += `${i + 1}. ${u.name} → ${u.count} referrals\n`);
  bot.sendMessage(msg.chat.id, text, getReferralMenu());
});

// ---------------- KEY MENU ----------------
bot.onText(/🔑 Key/, (msg) => bot.sendMessage(msg.chat.id, "🔑 Key Menu:", getKeyMenu()));

bot.onText(/🆕 Get Key/, async (msg) => {
  const user = await User.findOne({ userId: msg.from.id });
  user.key = generateApiKey();
  await user.save();
  bot.sendMessage(msg.chat.id, `✅ Your new API Key:\n\`${user.key}\``, { ...getKeyMenu(), parse_mode: "Markdown" });
});

bot.onText(/🔑 Your Key/, async (msg) => {
  const user = await User.findOne({ userId: msg.from.id });
  if (!user.key) return bot.sendMessage(msg.chat.id, "❌ You have no Key yet.", getKeyMenu());
  bot.sendMessage(msg.chat.id, `🔑 Your API Key:\n\`${user.key}\``, { ...getKeyMenu(), parse_mode: "Markdown" });
});

bot.onText(/♻️ Renew Key/, async (msg) => {
  const user = await User.findOne({ userId: msg.from.id });
  user.key = generateApiKey();
  await user.save();
  bot.sendMessage(msg.chat.id, `♻️ Your API Key renewed:\n\`${user.key}\``, { ...getKeyMenu(), parse_mode: "Markdown" });
});

// ---------------- PROMO MENU ----------------
bot.onText(/🎁 Promo/, (msg) => bot.sendMessage(msg.chat.id, "🎁 Promo Menu:", getPromoMenu()));

bot.onText(/🎁 Apply Promo/, (msg) => {
  promoStep[msg.chat.id] = true;
  bot.sendMessage(msg.chat.id, "🎁 Enter your promo code:");
});

// ---------------- LEADERBOARD ----------------
bot.onText(/🏆 Leaderboard/, (msg) => bot.sendMessage(msg.chat.id, "Use Referral Menu → 🏆 Top Referrers", getMainMenu()));

// ---------------- STATS ----------------
bot.onText(/📊 My Stats/, async (msg) => {
  const user = await User.findOne({ userId: msg.from.id });
  const totalDeposit = user.deposits.reduce((a, b) => a + (b.amount || 0), 0);
  bot.sendMessage(
    msg.chat.id,
    `📊 *Your Stats*\n\n💰 Balance: ${user.balance}৳\n` +
    `💳 Total Deposit: ${totalDeposit}৳\n` +
    `👥 Total Referrals: ${user.referrals.length}\n` +
    `🔑 API Key: ${user.key ? "✅" : "❌"}`,
    { ...getMainMenu(), parse_mode: "Markdown" }
  );
});

// ---------------- BACK BUTTON ----------------
bot.onText(/⬅️ Back/, (msg) => bot.sendMessage(msg.chat.id, "⬅️ Main Menu:", getMainMenu()));

// ---------------- ADMIN COMMANDS ----------------
bot.onText(/\/setqr (.+)/, (msg, match) => {
  if (msg.from.id.toString() !== ADMIN_ID) return bot.sendMessage(msg.chat.id, "❌ Only admin.");
  QR_IMAGE = match[1];
  bot.sendMessage(msg.chat.id, `✅ New QR set:\n${QR_IMAGE}`);
});

bot.onText(/\/createpromo (.+) (.+)/, async (msg, match) => {
  if (msg.from.id.toString() !== ADMIN_ID) return bot.sendMessage(msg.chat.id, "❌ Only admin.");
  const code = match[1].toUpperCase();
  const amount = parseInt(match[2]);
  const promo = new Promo({ code, amount });
  await promo.save();
  bot.sendMessage(msg.chat.id, `✅ Promo created:\nCode: ${code}\nAmount: ${amount}৳`);
});

// ---------------- ERROR HANDLING ----------------
process.on("unhandledRejection", err => console.error("Unhandled Rejection:", err));
process.on("uncaughtException", err => console.error("Uncaught Exception:", err));

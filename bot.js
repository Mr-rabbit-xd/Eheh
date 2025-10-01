// ======================== bot_part1.js ========================
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

let KEY_PRICES = { 3: 150, 7: 300, 15: 500, 30: 1000 };

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
  keyExpiry: Date,
  keyPrice: Number
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
        [{ text: "🛒 Buy Key" }],
        [{ text: "⬅️ Back" }],
      ],
      resize_keyboard: true,
    },
  };
}

// ================= BOT LOGIC =================
const depositStep = {};
const utrStep = {};
const buyingKeyStep = {};

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
  bot.sendMessage(msg.chat.id, `💰 Your Balance: ₹${user.balance}`, getMainMenu());
});
// ======================== bot_part2.js ========================

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

  // ---------------- Deposit Step ----------------
  if (depositStep[chatId] && !isNaN(text)) {
    const amount = parseInt(text);
    await bot.sendPhoto(chatId, QR_IMAGE, {
      caption: `📥 Deposit Started!\nAmount: ₹${amount}\n\n✅ After payment, send UTR/Txn ID (min 12 characters)`,
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

    await bot.sendMessage(chatId, `✅ Deposit Request Created!\nAmount: ₹${utrStep[chatId].amount}\nUTR: ${utr}`);

    // Notify Admin
    await bot.sendMessage(
      ADMIN_ID,
      `📢 New Deposit Request:\n👤 ${msg.from.first_name} (@${msg.from.username || "NA"})\n💰 ₹${utrStep[chatId].amount}\nUTR: ${utr}\n\nUse inline buttons to Approve/Cancel.`,
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
});

// ---------------- ADMIN INLINE BUTTON ----------------
bot.on("callback_query", async (query) => {
  const data = query.data;
  const chatId = query.message.chat.id;

  // ---------------- Admin Approve/Cancel ----------------
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
        await bot.sendMessage(refUser.userId, `🎁 You received ₹${bonus} as referral bonus!`);
      }
    }

    await user.save();
    await deposit.save();
    bot.sendMessage(user.userId, `✅ Your ₹${deposit.amount} deposit has been approved!\n💰 New Balance: ₹${user.balance}`);
  } else if (action === "cancel") {
    deposit.status = "cancelled";
    await deposit.save();
    bot.sendMessage(user.userId, `❌ Your ₹${deposit.amount} deposit has been cancelled.`);
  }

  bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: ADMIN_ID, message_id: query.message.message_id });
  bot.answerCallbackQuery(query.id, { text: action === "approve" ? "✅ Approved!" : "❌ Cancelled!" });
});

// ---------------- REFERRAL MENU ----------------
bot.onText(/👥 Referral/, async (msg) => {
  const user = await User.findOne({ userId: msg.from.id });
  const refLink = `https://t.me/${BOT_USERNAME}?start=${user.refCode}`;
  bot.sendMessage(msg.chat.id, `💸 Your Referral Link:\n${refLink}`, getReferralMenu());
});

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
  const usersList = await User.find();
  const leaderboard = usersList
    .map(u => ({ name: u.name || u.userId, count: u.referrals.length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  if (!leaderboard.length) return bot.sendMessage(msg.chat.id, "❌ No referral data.", getReferralMenu());

  let text = "🏆 Top 10 Referrers:\n";
  leaderboard.forEach((u, i) => text += `${i + 1}. ${u.name} → ${u.count} referrals\n`);
  bot.sendMessage(msg.chat.id, text, getReferralMenu());
});
// ---------------- KEY MENU ----------------
bot.onText(/🔑 Key/, (msg) => {
  bot.sendMessage(msg.chat.id, "🔑 Key Menu:", getKeyMenu());
});

// Generate new key
bot.onText(/🆕 Get Key/, async (msg) => {
  const user = await User.findOne({ userId: msg.from.id });
  user.key = "KEY-" + Math.random().toString(36).substring(2, 10).toUpperCase();
  user.keyExpiry = null;
  user.keyPrice = null;
  await user.save();
  bot.sendMessage(msg.chat.id, `✅ Your new Key:\n${user.key}`, getKeyMenu());
});

// Show existing key
bot.onText(/🔑 Your Key/, async (msg) => {
  const user = await User.findOne({ userId: msg.from.id });
  if (!user.key) return bot.sendMessage(msg.chat.id, "❌ You have no Key yet.", getKeyMenu());
  bot.sendMessage(msg.chat.id, `🔑 Your Key:\n${user.key}\n💰 Price: ₹${user.keyPrice || "Not set"}\n⏳ Expiry: ${user.keyExpiry ? user.keyExpiry.toDateString() : "Not set"}`, getKeyMenu());
});

// Buy key menu
bot.onText(/🛒 Buy Key/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, "🛒 Select Key Duration & Price:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: `⏳ 3 Days → ₹${KEY_PRICES[3]}`, callback_data: "buykey_3" }],
        [{ text: `⏳ 7 Days → ₹${KEY_PRICES[7]}`, callback_data: "buykey_7" }],
        [{ text: `⏳ 15 Days → ₹${KEY_PRICES[15]}`, callback_data: "buykey_15" }],
        [{ text: `⏳ 30 Days → ₹${KEY_PRICES[30]}`, callback_data: "buykey_30" }],
      ],
    },
  });
});

// ---------------- BUY KEY INLINE ----------------
bot.on("callback_query", async (query) => {
  const data = query.data;
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const user = await User.findOne({ userId });

  // Check for buykey action
  if (data.startsWith("buykey_")) {
    const days = parseInt(data.split("_")[1]);
    const price = KEY_PRICES[days];

    if (user.balance < price) {
      return bot.answerCallbackQuery(query.id, { text: `❌ Insufficient balance. You need ₹${price}`, show_alert: true });
    }

    user.balance -= price;
    user.key = "KEY-" + Math.random().toString(36).substring(2, 10).toUpperCase();
    user.keyPrice = price;
    const now = new Date();
    user.keyExpiry = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    await user.save();

    bot.editMessageText(`✅ Key Purchased!\n🔑 Your Key: ${user.key}\n💰 Price: ₹${price}\n⏳ Expiry: ${user.keyExpiry.toDateString()}`, {
      chat_id: chatId,
      message_id: query.message.message_id,
    });

    return bot.answerCallbackQuery(query.id);
  }

  // Admin set key prices
  if (data.startsWith("setprice_") && chatId.toString() === ADMIN_ID) {
    const [_, day, newPrice] = data.split("_");
    KEY_PRICES[parseInt(day)] = parseInt(newPrice);
    bot.answerCallbackQuery(query.id, { text: `✅ Price for ${day} days set to ₹${newPrice}` });
  }
});

// ---------------- ADMIN COMMANDS ----------------
bot.onText(/\/admin/, (msg) => {
  if (msg.from.id.toString() !== ADMIN_ID) return;
  bot.sendMessage(msg.chat.id, "🛠 Admin Commands Menu:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "💰 Check All Users Balance", callback_data: "admin_balance" }],
        [{ text: "📥 Deposit Requests", callback_data: "admin_deposits" }],
        [{ text: "🗂 User Referrals", callback_data: "admin_referrals" }],
        [{ text: "🔑 Set Key Prices", callback_data: "admin_setprices" }],
        [{ text: "📊 Stats Today", callback_data: "admin_stats" }],
      ],
    },
  });
});

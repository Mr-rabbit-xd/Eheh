import TelegramBot from "node-telegram-bot-api";
import mongoose from "mongoose";
import express from "express";

// ================= ENV CONFIG =================
const token = process.env.BOT_TOKEN;
const mongoURL = process.env.MONGO_URL;
const ADMIN_ID = process.env.ADMIN_ID;
const BOT_USERNAME = process.env.BOT_USERNAME; // Example: H4CK_KEY_bot
let QR_IMAGE = process.env.QR_IMAGE || "https://via.placeholder.com/300?text=QR+Code";

// ================= TELEGRAM BOT =================
const bot = new TelegramBot(token, { polling: true });

// ================= EXPRESS SERVER (Keep Alive) =================
const app = express();
app.get("/", (req, res) => res.send("🤖 Bot is running 24/7!"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Server running on port ${PORT}`));

// ================= MONGODB CONNECT =================
mongoose.connect(mongoURL, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.log("❌ MongoDB Error:", err));

// ================= SCHEMAS =================
const userSchema = new mongoose.Schema({
  userId: String,
  balance: { type: Number, default: 0 },
  refCode: String,
  referredBy: String,
  keys: { type: [String], default: [] }
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

// ================= BUTTON KEYBOARDS =================
const mainMenu = {
  reply_markup: {
    keyboard: [
      [{ text: "💰 Deposit" }, { text: "📊 Balance" }],
      [{ text: "💸 Referral" }, { text: "💳 Transaction" }],
      [{ text: "🔑 Key" }]
    ],
    resize_keyboard: true
  }
};

const depositMenu = {
  reply_markup: {
    keyboard: [
      [{ text: "💵 Deposit Amount" }],
      [{ text: "📜 Deposit History" }],
      [{ text: "⬅️ Back" }]
    ],
    resize_keyboard: true
  }
};

const referralMenu = {
  reply_markup: {
    keyboard: [
      [{ text: "💸 Your Referral Link" }],
      [{ text: "👀 Check Referrals" }],
      [{ text: "🏆 Top Referrers" }],
      [{ text: "⬅️ Back" }]
    ],
    resize_keyboard: true
  }
};

const transactionMenu = {
  reply_markup: {
    keyboard: [
      [{ text: "📜 Transaction History" }],
      [{ text: "⬅️ Back" }]
    ],
    resize_keyboard: true
  }
};

const keyMenu = {
  reply_markup: {
    keyboard: [
      [{ text: "📥 Get Key" }, { text: "🗝 Your Keys" }],
      [{ text: "⬅️ Back" }]
    ],
    resize_keyboard: true
  }
};

// ================= BOT LOGIC =================
const depositStep = {};
const utrStep = {};

// ================= START COMMAND =================
bot.onText(/\/start(?:\s+(\w+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const refCodeFromStart = match[1]; // /start ABC123

  let user = await User.findOne({ userId: chatId });
  if (!user) {
    const newRefCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    user = new User({
      userId: chatId,
      balance: 0,
      refCode: newRefCode,
      referredBy: refCodeFromStart && refCodeFromStart !== newRefCode ? refCodeFromStart : null
    });
    await user.save();

    if (refCodeFromStart) {
      const refUser = await User.findOne({ refCode: refCodeFromStart });
      if (refUser) {
        bot.sendMessage(refUser.userId, `👤 আপনার referral দ্বারা নতুন user join করেছে!`);
      }
    }
  } else if (!user.refCode) {
    user.refCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    await user.save();
  }

  await bot.sendMessage(chatId, `👋 হ্যালো ${msg.from.first_name}!\n\n💰 Deposit করতে "💰 Deposit" বাটন চাপুন\n📊 Balance দেখতে "📊 Balance"\n💸 Referral, 💳 Transaction, 🔑 Key সব মেনু বাটন ব্যবহার করুন।`, mainMenu);
});

// ================= MAIN BUTTON HANDLER =================
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  // ---------------- Back button ----------------
  if (text === "⬅️ Back") return bot.sendMessage(chatId, "Main Menu", mainMenu);

  // ---------------- Main Menu ----------------
  if (text === "💰 Deposit") return bot.sendMessage(chatId, "Deposit Menu", depositMenu);

  if (text === "📊 Balance") {
    let user = await User.findOne({ userId: chatId });
    if (!user) user = await new User({ userId: chatId, balance: 0, refCode: Math.random().toString(36).substring(2,8).toUpperCase() }).save();
    return bot.sendMessage(chatId, `📊 আপনার Balance: ${user.balance} INR`, mainMenu);
  }

  if (text === "💸 Referral") {
    let user = await User.findOne({ userId: chatId });
    if (!user) user = await new User({ userId: chatId, balance: 0, refCode: Math.random().toString(36).substring(2,8).toUpperCase() }).save();
    const refLink = `https://t.me/${BOT_USERNAME}?start=${user.refCode}`;
    return bot.sendMessage(chatId, `💸 আপনার Referral Link:\n${refLink}`, referralMenu);
  }

  if (text === "💳 Transaction") return bot.sendMessage(chatId, "Transaction Menu", transactionMenu);

  if (text === "🔑 Key") return bot.sendMessage(chatId, "🔑 Key Menu", keyMenu);

  // ---------------- Key Menu ----------------
  if (text === "📥 Get Key") {
    return bot.sendMessage(chatId, "📥 Key পাওয়ার জন্য admin এর সাথে যোগাযোগ করুন।", keyMenu);
  }

  if (text === "🗝 Your Keys") {
    let user = await User.findOne({ userId: chatId });
    if (!user || !user.keys.length) return bot.sendMessage(chatId, "❌ আপনার কোনো Key নেই।", keyMenu);
    return bot.sendMessage(chatId, `🗝 আপনার Keys:\n${user.keys.join("\n")}`, keyMenu);
  }

  // ---------------- Deposit Menu ----------------
  if (text === "💵 Deposit Amount") {
    depositStep[chatId] = true;
    return bot.sendMessage(chatId, "💰 কত টাকা Add করতে চাও?");
  }

  if (text === "📜 Deposit History") {
    const deposits = await Deposit.find({ userId: chatId }).sort({ date: -1 });
    if (!deposits.length) return bot.sendMessage(chatId, "📜 কোনো Deposit History নেই।", depositMenu);
    let textMsg = "📜 আপনার Deposit History:\n\n";
    deposits.forEach(d => {
      textMsg += `💰 ${d.amount} INR | UTR: ${d.utr} | Status: ${d.status}\n`;
    });
    return bot.sendMessage(chatId, textMsg, depositMenu);
  }

  // ---------------- Referral Menu ----------------
  if (text === "👀 Check Referrals") {
    const user = await User.findOne({ userId: chatId });
    const referrals = await User.find({ referredBy: user.refCode });
    if (!referrals.length) return bot.sendMessage(chatId, "👀 আপনার কোনো Referral নেই।", referralMenu);
    let msgText = "👀 আপনার Referrals:\n\n";
    referrals.forEach(r => msgText += `👤 ${r.userId}\n`);
    return bot.sendMessage(chatId, msgText, referralMenu);
  }

  if (text === "🏆 Top Referrers") {
    const users = await User.find();
    let msgText = "🏆 Top Referrers:\n\n";
    for (const u of users) {
      const refs = await User.countDocuments({ referredBy: u.refCode });
      if (refs > 0) msgText += `👤 ${u.userId} - ${refs} referrals\n`;
    }
    return bot.sendMessage(chatId, msgText || "❌ এখনো কোনো referral নেই।", referralMenu);
  }

  if (text === "💸 Your Referral Link") {
    const user = await User.findOne({ userId: chatId });
    const refLink = `https://t.me/${BOT_USERNAME}?start=${user.refCode}`;
    return bot.sendMessage(chatId, `💸 আপনার Referral Link:\n${refLink}`, referralMenu);
  }

  // ---------------- Transaction Menu ----------------
  if (text === "📜 Transaction History") {
    const deposits = await Deposit.find({ userId: chatId }).sort({ date: -1 });
    if (!deposits.length) return bot.sendMessage(chatId, "📜 কোনো Transaction History নেই।", transactionMenu);
    let msgText = "📜 Transaction History:\n\n";
    deposits.forEach(d => {
      msgText += `💰 ${d.amount} INR | UTR: ${d.utr} | Status: ${d.status}\n`;
    });
    return bot.sendMessage(chatId, msgText, transactionMenu);
  }

  // ---------------- Deposit Steps ----------------
  if (depositStep[chatId] && !isNaN(text)) {
    const amount = parseInt(text);
    await bot.sendPhoto(chatId, QR_IMAGE, {
      caption: `📥 Deposit শুরু হয়েছে!\n💰 Amount: ${amount} INR\n\n✅ Payment করার পর UTR/Txn ID লিখুন (কমপক্ষে 12 অক্ষর)।`
    });
    utrStep[chatId] = { amount };
    delete depositStep[chatId];
    return;
  }

  if (utrStep[chatId]) {
    const utr = text.trim();
    if (utr.length < 12) return bot.sendMessage(chatId, "❌ UTR কমপক্ষে 12 অক্ষর হতে হবে। আবার লিখুন:");

    // ✅ Duplicate Check
    const existing = await Deposit.findOne({ utr });
    if (existing) return bot.sendMessage(chatId, "❌ এই UTR আগে ব্যবহার হয়েছে। নতুন UTR দিন।");

    const deposit = new Deposit({ userId: chatId, amount: utrStep[chatId].amount, utr, status: "pending" });
    await deposit.save();

    await bot.sendMessage(chatId, `✅ Deposit Request Created!\n💰 Amount: ${utrStep[chatId].amount} INR\n🔑 UTR: ${utr}`);
    utrStep[chatId] = null;

    // Admin Notification with inline buttons
    const approveData = `approve_${deposit._id}`;
    const cancelData = `cancel_${deposit._id}`;
    await bot.sendMessage(ADMIN_ID, 
      `📢 নতুন Deposit Request:\n👤 ${msg.from.first_name} (@${msg.from.username || "NA"})\n💰 ${deposit.amount} INR\n🔑 UTR: ${utr}`, 
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "✅ Approve", callback_data: approveData }, { text: "❌ Cancel", callback_data: cancelData }]
          ]
        }
      }
    );
  }
});

// ================= ADMIN INLINE BUTTON CALLBACK =================
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (chatId.toString() !== ADMIN_ID) return bot.answerCallbackQuery(query.id, { text: "❌ শুধুমাত্র Admin পারবেন।" });

  const [action, depositId] = data.split("_");
  const deposit = await Deposit.findById(depositId);
  if (!deposit) return bot.answerCallbackQuery(query.id, { text: "❌ Deposit পাওয়া যায়নি।" });

  const user = await User.findOne({ userId: deposit.userId }) || new User({ userId: deposit.userId, balance: 0 });

  if (action === "approve") {
    user.balance += deposit.amount;
    deposit.status = "approved";
    await user.save();
    await deposit.save();
    bot.sendMessage(deposit.userId, `✅ আপনার ${deposit.amount} INR Deposit Approved হয়েছে!\n📊 New Balance: ${user.balance} INR`);
  } else if (action === "cancel") {
    deposit.status = "cancelled";
    await deposit.save();
    bot.sendMessage(deposit.userId, `❌ আপনার Deposit ${deposit.amount} INR Cancelled হয়েছে।`);
  }
  bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: ADMIN_ID, message_id: query.message.message_id });
  bot.answerCallbackQuery(query.id, { text: action === "approve" ? "✅ Approved!" : "❌ Cancelled!" });
});

// ================= ADMIN QR CHANGE =================
bot.onText(/\/setqr (.+)/, async (msg, match) => {
  if (msg.chat.id.toString() !== ADMIN_ID) return bot.sendMessage(msg.chat.id, "❌ শুধুমাত্র Admin QR পরিবর্তন করতে পারবে।");
  QR_IMAGE = match[1];
  await bot.sendMessage(msg.chat.id, `✅ নতুন QR কোড সেট করা হলো!\n📌 ${QR_IMAGE}`);
});

// ================= ADMIN ADD KEY =================
bot.onText(/\/addkey (\d+) (.+)/, async (msg, match) => {
  if (msg.chat.id.toString() !== ADMIN_ID) return bot.sendMessage(msg.chat.id, "❌ শুধুমাত্র Admin Key যোগ করতে পারবে।");
  const userId = match[1];
  const newKey = match[2];
  const user = await User.findOne({ userId });
  if (!user) return bot.sendMessage(msg.chat.id, "❌ User পাওয়া যায়নি।");
  user.keys.push(newKey);
  await user.save();
  bot.sendMessage(userId, `🔑 আপনার জন্য নতুন Key Added হয়েছে:\n${newKey}`);
  bot.sendMessage(msg.chat.id, `✅ Key সফলভাবে যোগ করা হলো User ${userId}-এর জন্য।`);
});

// ================= ERROR HANDLER =================
process.on("unhandledRejection", (err) => console.error("Unhandled Rejection:", err));
process.on("uncaughtException", (err) => console.error("Uncaught Exception:", err));

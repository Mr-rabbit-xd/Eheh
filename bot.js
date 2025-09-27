import TelegramBot from "node-telegram-bot-api";
import mongoose from "mongoose";
import express from "express";

// ================= ENV CONFIG =================
const token = process.env.BOT_TOKEN;
const mongoURL = process.env.MONGO_URL;
const ADMIN_ID = process.env.ADMIN_ID;

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
  refCode: String, // unique referral code
  referredBy: String, // who referred
});
const User = mongoose.model("User", userSchema);

const depositSchema = new mongoose.Schema({
  userId: String,
  amount: Number,
  utr: String,
  status: { type: String, default: "pending" },
  date: { type: Date, default: Date.now },
  type: { type: String, default: "deposit" }, // deposit or referral
});
const Deposit = mongoose.model("Deposit", depositSchema);

// ================= BUTTON MENUS =================
const mainMenu = {
  reply_markup: {
    keyboard: [
      [{ text: "💰 Deposit" }, { text: "📊 Balance" }],
      [{ text: "💸 Referral" }, { text: "💳 Transaction" }]
    ],
    resize_keyboard: true
  }
};

const depositMenu = {
  reply_markup: {
    keyboard: [
      [{ text: "💵 Deposit Amount" }, { text: "📜 Deposit History" }],
      [{ text: "⬅️ Back" }]
    ],
    resize_keyboard: true
  }
};

const referralMenu = {
  reply_markup: {
    keyboard: [
      [{ text: "👀 Check Referrals" }, { text: "🏆 Top Referrers" }],
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

// ================= STEP TRACKERS =================
const depositStep = {};
const utrStep = {};
const referralStep = {};

// ================= BOT START =================
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  let user = await User.findOne({ userId: chatId });
  if (!user) {
    // Create new user with unique refCode
    const refCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    user = new User({ userId: chatId, balance: 0, refCode });
    await user.save();
  }
  await bot.sendMessage(chatId, `👋 হ্যালো ${msg.from.first_name}!\n\nMain Menu থেকে অপশন সিলেক্ট করুন।`, mainMenu);
});

// ================= MAIN BUTTON HANDLER =================
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  // ---------------- Deposit Menu ----------------
  if (text === "💰 Deposit") {
    depositStep[chatId] = false;
    return bot.sendMessage(chatId, "💰 Deposit Menu", depositMenu);
  }
  if (text === "💵 Deposit Amount") {
    depositStep[chatId] = true;
    return bot.sendMessage(chatId, "💰 কত টাকা Add করতে চাও? (যেমন: 100, 200)");
  }
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

    // Duplicate Check
    const existing = await Deposit.findOne({ utr });
    if (existing) return bot.sendMessage(chatId, "❌ এই UTR আগে ব্যবহার হয়েছে। নতুন দিন।");

    const deposit = new Deposit({ userId: chatId, amount: utrStep[chatId].amount, utr, status: "pending" });
    await deposit.save();

    // Admin notification
    const approveData = `approve_${deposit._id}`;
    const cancelData = `cancel_${deposit._id}`;
    await bot.sendMessage(ADMIN_ID, 
      `📢 নতুন Deposit Request:\n👤 ${msg.from.first_name} (@${msg.from.username || "NA"})\n💰 ${utrStep[chatId].amount} INR\n🔑 UTR: ${utr}`, 
      {
        reply_markup: {
          inline_keyboard: [[
            { text: "✅ Approve", callback_data: approveData },
            { text: "❌ Cancel", callback_data: cancelData }
          ]]
        }
      }
    );

    await bot.sendMessage(chatId, `✅ Deposit Request Created!\n💰 Amount: ${utrStep[chatId].amount} INR\n🔑 UTR: ${utr}`, depositMenu);
    delete utrStep[chatId];
    return;
  }
  if (text === "📜 Deposit History") {
    const deposits = await Deposit.find({ userId: chatId, type: "deposit" }).sort({ date: -1 });
    if (!deposits.length) return bot.sendMessage(chatId, "📜 কোনো Deposit History নেই।", depositMenu);
    let textHistory = "📜 আপনার Deposit History:\n\n";
    deposits.forEach(d => {
      textHistory += `💰 ${d.amount} INR | UTR: ${d.utr} | Status: ${d.status}\n`;
    });
    return bot.sendMessage(chatId, textHistory, depositMenu);
  }
  if (text === "⬅️ Back") return bot.sendMessage(chatId, "Main Menu", mainMenu);

  // ---------------- Balance ----------------
  if (text === "📊 Balance") {
    let user = await User.findOne({ userId: chatId });
    if (!user) user = new User({ userId: chatId, balance: 0 });
    return bot.sendMessage(chatId, `📊 আপনার Balance: ${user.balance} INR`, mainMenu);
  }

  // ---------------- Referral ----------------
  if (text === "💸 Referral") return bot.sendMessage(chatId, "💸 Referral Menu", referralMenu);
  if (text === "👀 Check Referrals") {
    const referrals = await User.find({ referredBy: chatId.toString() });
    if (!referrals.length) return bot.sendMessage(chatId, "👀 কোনো referral নেই।", referralMenu);
    let refText = "👀 আপনার Referrals:\n\n";
    referrals.forEach(r => { refText += `🔹 ${r.userId}\n`; });
    return bot.sendMessage(chatId, refText, referralMenu);
  }
  if (text === "🏆 Top Referrers") {
    const top = await User.find({}).sort({ balance: -1 }).limit(10); // or referral count
    let topText = "🏆 Top Referrers:\n\n";
    top.forEach(u => { topText += `🔹 ${u.userId} | Balance: ${u.balance}\n`; });
    return bot.sendMessage(chatId, topText, referralMenu);
  }

  // ---------------- Transaction ----------------
  if (text === "💳 Transaction") return bot.sendMessage(chatId, "💳 Transaction Menu", transactionMenu);
  if (text === "📜 Transaction History") {
    const trans = await Deposit.find({ userId: chatId }).sort({ date: -1 });
    if (!trans.length) return bot.sendMessage(chatId, "📜 কোনো Transaction History নেই।", transactionMenu);
    let transText = "📜 আপনার Transactions:\n\n";
    trans.forEach(t => {
      transText += `💰 ${t.amount} INR | UTR: ${t.utr || "-"} | Status: ${t.status}\n`;
    });
    return bot.sendMessage(chatId, transText, transactionMenu);
  }
});

// ================= ADMIN CALLBACK =================
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
    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: ADMIN_ID, message_id: query.message.message_id });
    bot.answerCallbackQuery(query.id, { text: "✅ Approved!" });
  } else if (action === "cancel") {
    deposit.status = "cancelled";
    await deposit.save();
    bot.sendMessage(deposit.userId, `❌ আপনার Deposit ${deposit.amount} INR Cancelled হয়েছে।`);
    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: ADMIN_ID, message_id: query.message.message_id });
    bot.answerCallbackQuery(query.id, { text: "❌ Cancelled!" });
  }
});

// ================= ADMIN QR CHANGE =================
bot.onText(/\/setqr (.+)/, async (msg, match) => {
  if (msg.chat.id.toString() !== ADMIN_ID) return bot.sendMessage(msg.chat.id, "❌ শুধুমাত্র Admin QR পরিবর্তন করতে পারবে।");
  QR_IMAGE = match[1];
  await bot.sendMessage(msg.chat.id, `✅ নতুন QR কোড সেট করা হলো!\n📌 ${QR_IMAGE}`);
});

// ================= ERROR HANDLER =================
process.on("unhandledRejection", (err) => console.error("Unhandled Rejection:", err));
process.on("uncaughtException", (err) => console.error("Uncaught Exception:", err));

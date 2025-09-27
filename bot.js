import TelegramBot from "node-telegram-bot-api";
import mongoose from "mongoose";

const token = process.env.BOT_TOKEN;
const mongoURL = process.env.MONGO_URL;
const ADMIN_ID = process.env.ADMIN_ID;

let QR_IMAGE = process.env.QR_IMAGE || "https://via.placeholder.com/300?text=QR+Code";

const bot = new TelegramBot(token, { polling: true });

// ================= DB Connect =================
mongoose.connect(mongoURL, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.log("❌ MongoDB Error:", err));

// ================= Schemas =================
const userSchema = new mongoose.Schema({
  userId: String,
  balance: { type: Number, default: 0 }
});
const User = mongoose.model("User", userSchema);

const depositSchema = new mongoose.Schema({
  userId: String,
  amount: Number,
  status: { type: String, default: "pending" }
});
const Deposit = mongoose.model("Deposit", depositSchema);

// ================= Commands =================
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, `👋 Welcome ${msg.from.first_name}!\n\nCommands:\n💰 /deposit - টাকা Add করো\n📊 /balance - Balance Check করো`);
});

bot.onText(/\/balance/, async (msg) => {
  const chatId = msg.chat.id;
  let user = await User.findOne({ userId: chatId });
  if (!user) {
    user = new User({ userId: chatId, balance: 0 });
    await user.save();
  }
  await bot.sendMessage(chatId, `📊 Your Balance: ${user.balance} INR`);
});

const depositStep = {};

bot.onText(/\/deposit/, async (msg) => {
  const chatId = msg.chat.id;
  depositStep[chatId] = true;
  await bot.sendMessage(chatId, "💰 কত টাকা Add করতে চাও? Amount লিখো (যেমন: 100, 200)");
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (depositStep[chatId] && !isNaN(text)) {
    const amount = parseInt(text);

    const deposit = new Deposit({ userId: chatId, amount });
    await deposit.save();

    await bot.sendPhoto(chatId, QR_IMAGE, {
      caption: `📥 Deposit Request Created!\n\nAmount: ${amount} INR\n\n📌 QR Code Scan করে টাকা পাঠাও।`
    });

    await bot.sendMessage(ADMIN_ID, `📢 নতুন Deposit Request এসেছে:\n\n👤 User: ${msg.from.username || msg.from.first_name}\n🆔 ID: ${chatId}\n💰 Amount: ${amount} INR\n\nApprove করতে:\n/approve ${chatId} ${amount}`);

    delete depositStep[chatId];
  }
});

// Admin Approve
bot.onText(/\/approve (.+) (.+)/, async (msg, match) => {
  if (msg.chat.id.toString() !== ADMIN_ID) {
    return bot.sendMessage(msg.chat.id, "❌ শুধুমাত্র Admin এই Command চালাতে পারবে।");
  }

  const userId = match[1];
  const amount = parseInt(match[2]);

  let user = await User.findOne({ userId });
  if (!user) {
    user = new User({ userId, balance: 0 });
  }
  user.balance += amount;
  await user.save();

  await Deposit.updateOne({ userId, amount, status: "pending" }, { status: "approved" });

  await bot.sendMessage(userId, `✅ আপনার ${amount} INR জমা হয়েছে!\n📊 New Balance: ${user.balance} INR`);
  await bot.sendMessage(msg.chat.id, `👍 Approved: ${amount} INR for User ${userId}`);
});

// Admin QR Change
bot.onText(/\/setqr (.+)/, async (msg, match) => {
  if (msg.chat.id.toString() !== ADMIN_ID) {
    return bot.sendMessage(msg.chat.id, "❌ শুধুমাত্র Admin QR কোড পরিবর্তন করতে পারবে।");
  }

  const newQr = match[1];
  QR_IMAGE = newQr;
  await bot.sendMessage(msg.chat.id, `✅ নতুন QR কোড সেট করা হয়েছে!\n📌 ${QR_IMAGE}`);
});

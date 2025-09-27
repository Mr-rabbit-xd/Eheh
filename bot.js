import TelegramBot from "node-telegram-bot-api";
import mongoose from "mongoose";
import express from "express";

// ================= ENV CONFIG =================
const token = process.env.BOT_TOKEN;
const mongoURL = process.env.MONGO_URL;
const ADMIN_ID = process.env.ADMIN_ID; // শুধু deposit approve এর জন্য
const COMMISSION_PERCENT = parseInt(process.env.COMMISSION_PERCENT) || 10;

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
  firstName: String,
  username: String,
  balance: { type: Number, default: 0 },
  referrerId: { type: String, default: null },
  referrals: { type: [String], default: [] }
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

// ================= BUTTON STEP STORAGE =================
const depositStep = {};
const utrStep = {};

// ================= BOT COMMANDS =================
bot.onText(/\/start(?: (\d+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const refCode = match[1]; // Optional referral code
  let user = await User.findOne({ userId: chatId });

  if (!user) {
    user = new User({ 
      userId: chatId, 
      firstName: msg.from.first_name, 
      username: msg.from.username || "NA"
    });

    // ✅ Referral set
    if (refCode && refCode !== chatId.toString()) {
      const referrer = await User.findOne({ userId: refCode });
      if (referrer) {
        user.referrerId = refCode;
        referrer.referrals.push(chatId.toString());
        await referrer.save();

        // Referrer message
        await bot.sendMessage(refCode, `🎉 আপনি নতুন user refer করেছেন: ${msg.from.first_name} (UserID: ${chatId})`);
      }
    }

    await user.save();
  }

  // Button Menu
  const options = {
    reply_markup: {
      keyboard: [
        [{ text: "💰 Deposit" }, { text: "📊 Balance" }],
        [{ text: "📜 History" }, { text: "💸 Referral" }]
      ],
      resize_keyboard: true
    }
  };
  await bot.sendMessage(chatId, `👋 হ্যালো ${msg.from.first_name}!\nনিচের button থেকে choose করো।`, options);
});

// ================= BALANCE =================
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  const user = await User.findOne({ userId: chatId });
  if (!user) return;

  // Balance check
  if (text === "📊 Balance") {
    await bot.sendMessage(chatId, `📊 আপনার Balance: ${user.balance} INR`);
    return;
  }

  // History
  if (text === "📜 History") {
    const deposits = await Deposit.find({ userId: chatId }).sort({ date: -1 });
    if (!deposits.length) return bot.sendMessage(chatId, "📜 কোনো Deposit History নেই।");
    let textHistory = "📜 আপনার Deposit History:\n\n";
    deposits.forEach(d => {
      textHistory += `💰 ${d.amount} INR | UTR: ${d.utr} | Status: ${d.status}\n`;
    });
    bot.sendMessage(chatId, textHistory);
    return;
  }

  // Referral
  if (text === "💸 Referral") {
    const refLink = `https://t.me/YOUR_BOT_USERNAME?start=${chatId}`;
    let referralText = `💡 আপনার Referral Link:\n${refLink}\n\n`;
    if (user.referrals.length) {
      referralText += `👥 আপনি নিচের user-দের refer করেছেন:\n`;
      user.referrals.forEach((id, idx) => {
        referralText += `${idx+1}. UserID: ${id}\n`;
      });
    } else {
      referralText += `👥 আপনি এখনও কাউকে refer করেননি।`;
    }
    await bot.sendMessage(chatId, referralText);
    return;
  }

  // Deposit
  if (text === "💰 Deposit") {
    depositStep[chatId] = true;
    await bot.sendMessage(chatId, "💰 কত টাকা Add করতে চাও? (যেমন: 100, 200)");
    return;
  }

  // Deposit Step
  if (depositStep[chatId] && !isNaN(text)) {
    const amount = parseInt(text);
    await bot.sendPhoto(chatId, QR_IMAGE, {
      caption: `📥 Deposit শুরু হয়েছে!\n💰 Amount: ${amount} INR\n\n✅ Payment করার পর UTR/Txn ID লিখুন (কমপক্ষে 12 অক্ষর)।`
    });
    utrStep[chatId] = { amount };
    delete depositStep[chatId];
    return;
  }

  // UTR Step
  if (utrStep[chatId]) {
    const utr = text.trim();
    if (utr.length < 12) return bot.sendMessage(chatId, "❌ UTR কমপক্ষে 12 অক্ষর হতে হবে। আবার লিখুন:");

    const existing = await Deposit.findOne({ utr });
    if (existing) return bot.sendMessage(chatId, "❌ এই UTR আগে ব্যবহার হয়েছে। নতুন UTR দিন।");

    // Save Deposit
    const deposit = new Deposit({ userId: chatId, amount: utrStep[chatId].amount, utr, status: "pending" });
    await deposit.save();

    await bot.sendMessage(chatId, `✅ Deposit Request Created!\n💰 Amount: ${utrStep[chatId].amount} INR\n🔑 UTR: ${utr}\n\n💡 Admin approval প্রয়োজন।`);

    // Commission calculation (if referrer exists)
    if (user.referrerId) {
      const referrer = await User.findOne({ userId: user.referrerId });
      if (referrer) {
        const commission = Math.floor((utrStep[chatId].amount * COMMISSION_PERCENT) / 100);
        referrer.balance += commission;
        await referrer.save();
        await bot.sendMessage(referrer.userId, `💰 আপনি ${commission} INR commission পেয়েছেন ${user.firstName} এর deposit থেকে!`);
      }
    }

    delete utrStep[chatId];
    return;
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

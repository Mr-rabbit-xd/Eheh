require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const mongoose = require("mongoose");

// ✅ Connect MongoDB Atlas
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log("✅ MongoDB Connected"))
.catch(err => console.error("❌ MongoDB Error:", err));

// ========================
// 🔹 MongoDB Schema
// ========================
const userSchema = new mongoose.Schema({
  userId: Number,
  wallet: { type: Number, default: 0 },
  reseller: { type: Boolean, default: false },
  keys: [{ key: String, expiry: Date }]
});
const User = mongoose.model("User", userSchema);

// ========================
// 🔹 Telegram Bot Init
// ========================
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

const KEY_PRICE = {
  "3d": 300,
  "7d": 600,
  "15d": 1000,
  "30d": 1500
};

// ========================
// 🔹 Commands
// ========================

// /start
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  let user = await User.findOne({ userId: chatId });
  if (!user) user = await User.create({ userId: chatId });

  bot.sendMessage(chatId,
    `👋 Welcome!\n\n💳 Wallet: ${user.wallet}\n\n👉 Commands:\n/wallet - Check balance\n/buykey - Buy license key\n/reseller - Reseller options`
  );
});

// /wallet
bot.onText(/\/wallet/, async (msg) => {
  const chatId = msg.chat.id;
  const user = await User.findOne({ userId: chatId });
  bot.sendMessage(chatId, `💰 Your wallet balance: ${user.wallet}`);
});

// /buykey
bot.onText(/\/buykey/, async (msg) => {
  const chatId = msg.chat.id;
  const options = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "3 Days - 300💰", callback_data: "buy_3d" }],
        [{ text: "7 Days - 600💰", callback_data: "buy_7d" }],
        [{ text: "15 Days - 1000💰", callback_data: "buy_15d" }],
        [{ text: "30 Days - 1500💰", callback_data: "buy_30d" }]
      ]
    }
  };
  bot.sendMessage(chatId, "🛒 Choose a license duration:", options);
});

// Handle buykey button
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (data.startsWith("buy_")) {
    const duration = data.split("_")[1];
    const price = KEY_PRICE[duration];
    const user = await User.findOne({ userId: chatId });

    if (user.wallet < price) {
      return bot.sendMessage(chatId, "❌ Not enough balance.");
    }

    // expiry logic
    const expiry = new Date();
    if (duration === "3d") expiry.setDate(expiry.getDate() + 3);
    if (duration === "7d") expiry.setDate(expiry.getDate() + 7);
    if (duration === "15d") expiry.setDate(expiry.getDate() + 15);
    if (duration === "30d") expiry.setDate(expiry.getDate() + 30);

    const key = "KEY-" + Math.random().toString(36).substring(2, 10).toUpperCase();

    user.wallet -= price;
    user.keys.push({ key, expiry });

    // Reseller cashback
    if (user.reseller) {
      const cashback = Math.floor(price * 0.15);
      user.wallet += cashback;
      bot.sendMessage(chatId, `🎁 Reseller Cashback +${cashback}`);
    }

    await user.save();
    bot.sendMessage(chatId, `✅ Key Purchased:\n🔑 ${key}\n📅 Expires: ${expiry.toDateString()}`);
  }
});

// /reseller
bot.onText(/\/reseller/, async (msg) => {
  const chatId = msg.chat.id;
  const user = await User.findOne({ userId: chatId });

  if (!user.reseller) {
    return bot.sendMessage(chatId, "❌ You are not a reseller.");
  }

  bot.sendMessage(chatId,
    "📊 Reseller Panel:\n- Create keys for clients\n- Earn 15% cashback per key"
  );
});

// ========================
// 🔹 Admin Commands
// ========================

// /broadcast
bot.onText(/\/broadcast (.+)/, async (msg, match) => {
  if (msg.chat.id.toString() !== process.env.ADMIN_ID) return;
  const text = match[1];
  const users = await User.find({});
  users.forEach(u => bot.sendMessage(u.userId, `📢 Admin: ${text}`));
});

// /addwallet userId amount
bot.onText(/\/addwallet (\d+) (\d+)/, async (msg, match) => {
  if (msg.chat.id.toString() !== process.env.ADMIN_ID) return;
  const [ , userId, amount ] = match;
  const user = await User.findOne({ userId });
  if (!user) return bot.sendMessage(msg.chat.id, "❌ User not found.");
  user.wallet += parseInt(amount);
  await user.save();
  bot.sendMessage(msg.chat.id, `✅ Added ${amount}💰 to ${userId}`);
  bot.sendMessage(userId, `💳 Admin added ${amount}💰 to your wallet.`);
});

// /makeReseller userId
bot.onText(/\/makeReseller (\d+)/, async (msg, match) => {
  if (msg.chat.id.toString() !== process.env.ADMIN_ID) return;
  const userId = match[1];
  const user = await User.findOne({ userId });
  if (!user) return bot.sendMessage(msg.chat.id, "❌ User not found.");
  user.reseller = true;
  await user.save();
  bot.sendMessage(msg.chat.id, `✅ User ${userId} is now a Reseller.`);
  bot.sendMessage(userId, "🎉 You are now a Reseller!");
});

require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const mongoose = require("mongoose");

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// Connect MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log("✅ MongoDB Connected"))
.catch(err => console.error("❌ MongoDB Error:", err));

// Models
const User = mongoose.model("User", new mongoose.Schema({
  userId: Number,
  wallet: { type: Number, default: 0 },
  reseller: { type: Boolean, default: false },
  keys: [{ key: String, expiry: Date }],
}));

// /start
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  let user = await User.findOne({ userId: chatId });
  if (!user) user = await User.create({ userId: chatId });
  
  bot.sendMessage(chatId, `👋 Welcome!\n💰 Wallet: ${user.wallet}\nUse /buykey to purchase a key.`);
});

// /wallet
bot.onText(/\/wallet/, async (msg) => {
  const chatId = msg.chat.id;
  const user = await User.findOne({ userId: chatId });
  bot.sendMessage(chatId, `💳 Wallet Balance: ${user.wallet}`);
});

// /buykey
bot.onText(/\/buykey/, async (msg) => {
  const chatId = msg.chat.id;
  const user = await User.findOne({ userId: chatId });
  const price = 300; // example price
  if (user.wallet < price) return bot.sendMessage(chatId, "❌ Not enough balance.");
  
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + 3); // 3-day key
  const key = "KEY-" + Math.random().toString(36).substring(2, 10).toUpperCase();
  
  user.wallet -= price;
  user.keys.push({ key, expiry });
  await user.save();
  
  // Reseller cashback
  if (user.reseller) {
    const cashback = Math.floor(price * 0.15);
    user.wallet += cashback;
    await user.save();
    bot.sendMessage(chatId, `🎁 Reseller Cashback: +${cashback}`);
  }
  
  bot.sendMessage(chatId, `✅ Key Purchased: ${key}\n📅 Expires: ${expiry.toDateString()}`);
});

// Admin only
bot.onText(/\/broadcast (.+)/, async (msg, match) => {
  if (msg.chat.id.toString() !== process.env.ADMIN_ID) return;
  const text = match[1];
  const users = await User.find({});
  users.forEach(u => bot.sendMessage(u.userId, `📢 Admin: ${text}`));
});

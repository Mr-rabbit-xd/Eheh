// =========================
// Bot.js (Part 1/3)
// =========================

// Dependencies
import TelegramBot from "node-telegram-bot-api";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

// Connect MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log("✅ MongoDB Connected"))
.catch((err) => console.log("❌ Mongo Error: " + err));

// Bot Token
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// =========================
// Schema / Models
// =========================
const userSchema = new mongoose.Schema({
  userId: String,
  username: String,
  wallet: { type: Number, default: 0 },
  referralCode: String,
  referredBy: String,
  totalReferrals: { type: Number, default: 0 },
  role: { type: String, default: "user" }, // user, reseller, admin, owner
  createdAt: { type: Date, default: Date.now }
});

const settingsSchema = new mongoose.Schema({
  key: String,
  value: String
});

const User = mongoose.model("User", userSchema);
const Settings = mongoose.model("Settings", settingsSchema);

// =========================
// Helper Functions
// =========================
async function getReferralBotUsername() {
  let setting = await Settings.findOne({ key: "referralBotUsername" });
  if (!setting) {
    setting = new Settings({ key: "referralBotUsername", value: "YourBotUsername" });
    await setting.save();
  }
  return setting.value;
}

async function setReferralBotUsername(username) {
  let setting = await Settings.findOne({ key: "referralBotUsername" });
  if (!setting) {
    setting = new Settings({ key: "referralBotUsername", value: username });
  } else {
    setting.value = username;
  }
  await setting.save();
}

// =========================
// Start / Welcome Message
// =========================
bot.onText(/\/start (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const refCode = match[1];

  let user = await User.findOne({ userId: chatId });
  if (!user) {
    const newUser = new User({
      userId: chatId,
      username: msg.from.username || "NoUsername",
      referralCode: chatId.toString()
    });
    if (refCode && refCode !== chatId.toString()) {
      newUser.referredBy = refCode;
      const refUser = await User.findOne({ referralCode: refCode });
      if (refUser) {
        refUser.totalReferrals += 1;
        refUser.wallet += 5; // Referral bonus
        await refUser.save();
        await bot.sendMessage(refUser.userId, `🎉 নতুন রেফার এসেছে! Wallet এ ₹5 যোগ হয়েছে।`);
      }
    }
    await newUser.save();
    user = newUser;
  }

  const referralBotUsername = await getReferralBotUsername();

  bot.sendMessage(chatId, 
`👋 Welcome *${msg.from.first_name}* to the Bot!  

🔑 এখানে আপনি Key কিনতে পারবেন এবং Refer করে আয় করতে পারবেন।  

👉 আপনার Referral Link:
https://t.me/${referralBotUsername}?start=${user.referralCode}

💰 আপনার Wallet: ₹${user.wallet}`, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "💳 Wallet", callback_data: "wallet" }],
        [{ text: "🎁 Referral", callback_data: "referral" }],
        [{ text: "🛒 Buy Key", callback_data: "buykey" }],
        [{ text: "🎉 Offers", callback_data: "offers" }]
      ]
    }
  });
});

bot.onText(/\/start$/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, "👉 বট ব্যবহার শুরু করতে /start চাপুন।");
});

// =========================
// Bot.js (Part 2/3)
// =========================

// =========================
// User Menu Inline Buttons
// =========================
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  const user = await User.findOne({ userId: chatId });
  if (!user) return bot.answerCallbackQuery(query.id, { text: "❌ User not found." });

  if (data === "wallet") {
    bot.sendMessage(chatId, `💰 আপনার Wallet Balance: ₹${user.wallet}`);
  }

  if (data === "referral") {
    const referralBotUsername = await getReferralBotUsername();
    bot.sendMessage(chatId,
`👥 আপনার Referral Link:
https://t.me/${referralBotUsername}?start=${user.referralCode}

মোট রেফার: ${user.totalReferrals}`, { parse_mode: "Markdown" });
  }

  if (data === "buykey") {
    bot.sendMessage(chatId, `🛒 Key কিনতে /buykey কমান্ড ব্যবহার করুন।`);
  }

  if (data === "offers") {
    bot.sendMessage(chatId, `🎉 Current Offers:
1. Deposit ₹500+ get 5% bonus
2. Referral bonus ₹5 per user
3. Special time cashback (Admin set)`);
  }
});

// =========================
// Deposit System
// =========================
const depositStep = {};
const utrStep = {};

bot.onText(/\/deposit/, async (msg) => {
  const chatId = msg.chat.id;
  depositStep[chatId] = true;
  bot.sendMessage(chatId, "💰 Deposit Amount লিখুন (₹):");
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (depositStep[chatId] && !isNaN(text)) {
    const amount = parseInt(text);
    utrStep[chatId] = { amount };
    depositStep[chatId] = false;
    bot.sendMessage(chatId, `📥 Deposit শুরু হয়েছে: ₹${amount}\nUTR/Txn ID পাঠান।`);
    return;
  }

  if (utrStep[chatId]) {
    const utr = text.trim();
    if (utr.length < 12) return bot.sendMessage(chatId, "❌ UTR 12+ character হতে হবে।");

    // Save deposit request (DB or memory)
    if (!global.deposits) global.deposits = [];
    global.deposits.push({ userId: chatId, amount: utrStep[chatId].amount, utr, status: "pending" });

    bot.sendMessage(chatId, `✅ Deposit request তৈরি হয়েছে: ₹${utrStep[chatId].amount}\nUTR: ${utr}\nAdmin approval এর জন্য পাঠানো হয়েছে।`);

    // Notify admin
    bot.sendMessage(process.env.ADMIN_ID, `📢 New Deposit:\nUser: ${user.username} (${chatId})\nAmount: ₹${utrStep[chatId].amount}\nUTR: ${utr}`);
    
    utrStep[chatId] = null;
    return;
  }
});

// =========================
// Promo/Offer System
// =========================
bot.onText(/\/promo (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const code = match[1].toUpperCase();
  const validCodes = ["WELCOME5", "BONUS10", "FREEKEY"];

  if (!validCodes.includes(code)) return bot.sendMessage(chatId, "❌ Invalid promo code.");

  const bonus = code === "WELCOME5" ? 5 : code === "BONUS10" ? 10 : 0;
  user.wallet += bonus;
  await user.save();

  bot.sendMessage(chatId, `🎁 Promo code applied! Wallet এ ₹${bonus} যোগ হয়েছে।`);
});

// =========================
// Leaderboard System
// =========================
bot.onText(/\/leaderboard/, async (msg) => {
  const users = await User.find();
  const top = users.sort((a,b)=>b.totalReferrals - a.totalReferrals).slice(0,10);
  let text = "🏆 Top Referrers:\n";
  top.forEach((u,i)=>text+=`${i+1}. ${u.username} → ${u.totalReferrals}\n`);
  bot.sendMessage(msg.chat.id, text);
});

// =========================
// Reseller System
// =========================
bot.onText(/\/reseller_stats/, async (msg) => {
  const chatId = msg.chat.id;
  if (!["reseller", "admin"].includes(user.role)) return bot.sendMessage(chatId, "❌ Access denied.");

  // Count total keys sold (simulate)
  const soldKeys = 10; // Example
  const cashback = soldKeys * 15; // 15 per key
  bot.sendMessage(chatId, `📊 Reseller Stats:\nTotal Keys Sold: ${soldKeys}\nCashback Earned: ₹${cashback}`);
});



// =========================
// Bot.js (Part 3/3) - Admin Panel
// =========================

bot.onText(/\/admin/, async (msg) => {
  const chatId = msg.chat.id;
  if (chatId.toString() !== process.env.ADMIN_ID) return bot.sendMessage(chatId, "❌ Only Admin can use this.");

  bot.sendMessage(chatId, "🛠 Admin Panel", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "💰 Total Users", callback_data: "admin_total_users" }],
        [{ text: "📥 Pending Deposits", callback_data: "admin_pending_deposits" }],
        [{ text: "🎁 Set Referral Bot Username", callback_data: "admin_set_ref_bot" }],
        [{ text: "📊 Analytics", callback_data: "admin_analytics" }]
      ]
    }
  });
});

// =========================
// Admin Inline Handlers
// =========================
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (chatId.toString() !== process.env.ADMIN_ID) return bot.answerCallbackQuery(query.id, { text: "❌ Only Admin" });

  // Total Users
  if (data === "admin_total_users") {
    const total = await User.countDocuments();
    bot.sendMessage(chatId, `👥 Total Users: ${total}`);
  }

  // Pending Deposits
  if (data === "admin_pending_deposits") {
    if (!global.deposits || !global.deposits.length) return bot.sendMessage(chatId, "❌ No pending deposits.");
    let txt = "📥 Pending Deposits:\n";
    global.deposits.forEach((d, i) => {
      if (d.status === "pending") txt += `${i+1}. User: ${d.userId} | ₹${d.amount} | UTR: ${d.utr}\n`;
    });
    bot.sendMessage(chatId, txt);
  }

  // Set Referral Bot Username
  if (data === "admin_set_ref_bot") {
    bot.sendMessage(chatId, "✏️ Send the new Bot username for referral link:");
    bot.once("message", async (msg) => {
      const newUsername = msg.text.trim();
      await setReferralBotUsername(newUsername);
      bot.sendMessage(chatId, `✅ Referral Bot Username updated: ${newUsername}`);
    });
  }

  // Analytics
  if (data === "admin_analytics") {
    const users = await User.find();
    let totalReferrals = users.reduce((acc,u)=>acc+u.totalReferrals,0);
    let walletTotal = users.reduce((acc,u)=>acc+u.wallet,0);
    bot.sendMessage(chatId,
`📊 Analytics:
Total Users: ${users.length}
Total Wallet Balance: ₹${walletTotal}
Total Referrals: ${totalReferrals}`);
  }

  bot.answerCallbackQuery(query.id, { text: "✅ Done" });
});

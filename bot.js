import TelegramBot from "node-telegram-bot-api";
import mongoose from "mongoose";
import express from "express";
import dotenv from "dotenv";

// Firebase admin
import admin from "firebase-admin";
import serviceAccount from "./serviceAccountKey.json" assert { type: "json" };

dotenv.config();

// ================= CONFIG =================
const token = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;
const BOT_USERNAME = process.env.BOT_USERNAME;
let QR_IMAGE = process.env.QR_IMAGE || "https://via.placeholder.com/300?text=QR+Code";
let REF_BONUS_PERCENT = 15; // default referral bonus
const API_SECRET = process.env.API_SECRET || "mysecret123";

// ================= FIREBASE INIT =================
try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DB_URL
  });
  console.log("✅ Firebase initialized");
} catch (err) {
  console.error("❌ Firebase init error (check serviceAccountKey.json / FIREBASE_DB_URL):", err);
}
const fb = admin.database();

// ================= MONGODB =================
mongoose.connect(process.env.MONGO_URL, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log("✅ MongoDB Connected"))
.catch(err => console.error("❌ MongoDB Error:", err));

// ================= SCHEMAS =================
// Key history schema for MongoDB
const keyHistorySchema = new mongoose.Schema({
  key: String,
  validity: Date,
  purchasedAt: { type: Date, default: Date.now },
  status: { type: String, default: "active" }, // active / expired
});

const userSchema = new mongoose.Schema({
  userId: String,
  name: String,
  balance: { type: Number, default: 0 },
  referrals: { type: [String], default: [] },
  refCode: String,
  referredBy: String,
  deposits: { type: Array, default: [] },

  // legacy key fields (kept for backward compatibility)
  key: String,
  keyExpiry: Date,

  // New: keys history (MongoDB)
  keys: { type: [keyHistorySchema], default: [] },

  sessionsTotal: { type: Number, default: 0 },
  sessionsActive: { type: Number, default: 0 },
  maxSessions: { type: Number, default: 1 },
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

// ================= EXPRESS + API =================
const app = express();
app.use(express.json());

// Root
app.get("/", (req, res) => res.send("🤖 Bot & Key API Running 24/7!"));

// ----- Original /api/check-key (MongoDB based) - keep as before -----
app.get("/api/check-key", async (req, res) => {
  const apiKey = req.headers["x-api-key"];
  if (apiKey !== API_SECRET) {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }

  const { key } = req.query;
  if (!key) {
    return res.status(400).json({ success: false, message: "Key is required" });
  }

  const user = await User.findOne({ key });
  if (!user) {
    return res.status(404).json({ success: false, message: "Invalid Key" });
  }

  const now = new Date();
  const isActive = user.keyExpiry && now < new Date(user.keyExpiry);
  const usedElsewhere = user.sessionsActive > user.maxSessions;

  res.json({
    success: true,
    key: user.key,
    userId: user.userId,
    name: user.name || "Unknown",
    active: isActive,
    expires: user.keyExpiry,
    sessionsActive: user.sessionsActive || 0,
    sessionsTotal: user.sessionsTotal || 0,
    maxSessions: user.maxSessions || 1,
    usedElsewhere
  });
});

// ----- New Firebase-based key check API (for website realtime login) -----
app.get("/api/check-key-firebase", async (req, res) => {
  const apiKey = req.headers["x-api-key"];
  if (apiKey !== API_SECRET) {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }

  const { key } = req.query;
  if (!key) return res.status(400).json({ success: false, message: "Key is required" });

  try {
    const snap = await fb.ref("userinfo/" + key).get();
    if (!snap.exists()) return res.status(404).json({ success: false, message: "Invalid Key" });

    const data = snap.val();
    // parse validity (format: DD-MM-YYYY HH:MM)
    const [datePart, timePart] = (data.validity || "").split(" ");
    if (!datePart || !timePart) {
      return res.json({ success: true, key: data.username, status: data.status || "inactive", active: false });
    }

    const [dd, mm, yyyy] = datePart.split("-");
    const [hh, min] = timePart.split(":");
    const expiry = new Date(yyyy, mm - 1, dd, hh, min);
    const now = new Date();
    const active = data.status === "active" && now < expiry;

    res.json({
      success: true,
      key: data.username,
      status: data.status,
      validity: data.validity,
      active,
      access: data.access,
      deviceId: data.deviceId || null
    });
  } catch (err) {
    console.error("Firebase check-key error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

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

// Update key menu to include both legacy Get Key and new Buy Key + history
function getKeyMenu() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: "🆕 Get Key" }, { text: "🛒 Buy Key" }],
        [{ text: "🔑 Your Key" }, { text: "📜 Key History" }],
        [{ text: "⬅️ Back" }],
      ],
      resize_keyboard: true,
    },
  };
}

// ================= KEY SYSTEM (Firebase + MongoDB history) =================
const PLANS = [
  { days: 3, price: 149 },
  { days: 7, price: 499 },
  { days: 15, price: 999 },
  { days: 30, price: 1799 },
];

function getPlansMenu() {
  return {
    reply_markup: {
      inline_keyboard: PLANS.map(p => [
        { text: `🛒 ${p.days} Days – ${p.price}৳`, callback_data: `buy_${p.days}` }
      ]),
    },
  };
}

function formatDate(d) {
  const pad = n => n.toString().padStart(2, '0');
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Create new key: deduct balance, add history in MongoDB, save active key in Firebase
async function createNewKey(user, days, price) {
  if (user.balance < price) return { error: "❌ Insufficient Balance!" };

  // Deduct balance
  user.balance -= price;

  // Generate key and expiry
  const key = "KEY-" + Math.random().toString(36).substring(2, 10).toUpperCase();
  const now = new Date();
  const expiry = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  // Save to MongoDB history
  user.keys.push({
    key,
    validity: expiry,
    purchasedAt: now,
    status: "active"
  });

  await user.save();

  // Save active key in Firebase for realtime usage (website login)
  try {
    const ref = fb.ref("userinfo").child(key);
    await ref.set({
      username: key,
      status: "active",
      validity: formatDate(expiry),
      access: "1",        // fixed: 1 device
      deviceId: null,     // first login will set deviceId
      rgtime: formatDate(now),
      credit: "0"
    });
  } catch (err) {
    console.error("Firebase save error:", err);
    // even if firebase fail, we have history in MongoDB — but inform caller
    return { error: "❌ Firebase save failed" };
  }

  return { key, expiry, balance: user.balance };
}

// ================= BOT LOGIC (rest preserved) =================
const depositStep = {};
const utrStep = {};

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
    `👋 Hello ${msg.from.first_name}!\n\nSelect from menu below:\n🔑 Use "Key" to generate or check your key.`,
    getMainMenu()
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

// Deposit Amount & UTR Handling
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  // ---------------- Deposit Step ----------------
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
    if (existing) return bot.sendMessage(chatId, "❌ This UTR is already used. Enter a new one.");

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
});

// ---------------- CALLBACK QUERY (Admin Approve + Buy Key) ----------------
bot.on("callback_query", async (query) => {
  const data = query.data;

  // --- Handle Buy Key callback first ---
  if (data.startsWith("buy_")) {
    const days = parseInt(data.split("_")[1]);
    const plan = PLANS.find(p => p.days === days);
    const user = await User.findOne({ userId: query.from.id });

    if (!user) {
      await bot.answerCallbackQuery(query.id, { text: "❌ User not found." });
      return;
    }

    if (user.balance < plan.price) {
      await bot.answerCallbackQuery(query.id, { text: "❌ Insufficient Balance!" });
      return;
    }

    const result = await createNewKey(user, days, plan.price);
    if (result.error) {
      await bot.answerCallbackQuery(query.id, { text: result.error });
      return;
    }

    await bot.sendMessage(
      query.from.id,
      `✅ Key Purchased!\n🔑 ${result.key}\n⏳ Valid for ${days} days\n📅 Expires: ${result.expiry}\n💰 Remaining Balance: ${result.balance}৳`,
      getKeyMenu()
    );

    await bot.answerCallbackQuery(query.id, { text: "✅ Key Purchased!" });
    return;
  }

  // --- Else: Admin approve/cancel (original logic) ---
  const chatId = query.message.chat.id;
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
        await bot.sendMessage(refUser.userId, `🎁 You received ${bonus}৳ as referral bonus!`);
      }
    }

    await user.save();
    await deposit.save();
    bot.sendMessage(user.userId, `✅ Your ${deposit.amount}৳ deposit has been approved!\n💰 New Balance: ${user.balance}৳`);
  } else if (action === "cancel") {
    deposit.status = "cancelled";
    await deposit.save();
    bot.sendMessage(user.userId, `❌ Your ${deposit.amount}৳ deposit has been cancelled.`);
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

// ---------------- KEY MENU (legacy & new) ----------------
bot.onText(/🔑 Key/, (msg) => {
  bot.sendMessage(msg.chat.id, "🔑 Key Menu:", getKeyMenu());
});

// Legacy: Key Generate (keeps previous behavior)
bot.onText(/🆕 Get Key/, async (msg) => {
  const user = await User.findOne({ userId: msg.from.id });
  const days = 3; // default 3 day key
  const now = new Date();
  user.key = "KEY-" + Math.random().toString(36).substring(2, 10).toUpperCase();
  user.keyExpiry = new Date(now.getTime() + days * 24 * 60 * 60 * 1000); // 3 day expiry
  await user.save();
  bot.sendMessage(msg.chat.id, `✅ Your new Key (valid ${days} days):\n${user.key}`, getKeyMenu());
});

// New: Buy Key (shows plans)
bot.onText(/🛒 Buy Key/, (msg) => {
  bot.sendMessage(msg.chat.id, "🛒 Choose a plan:", getPlansMenu());
});

// Show existing key (legacy)
bot.onText(/🔑 Your Key/, async (msg) => {
  const user = await User.findOne({ userId: msg.from.id });
  // prefer latest from keys history if exists, else legacy key
  if ((!user || !user.keys.length) && !user.key) return bot.sendMessage(msg.chat.id, "❌ You have no Key yet.", getKeyMenu());

  let latestKey;
  if (user.keys && user.keys.length) {
    latestKey = user.keys[user.keys.length - 1];
    const expired = new Date() > latestKey.validity;
    bot.sendMessage(
      msg.chat.id,
      `🔑 Your Key:\n${latestKey.key}\nStatus: ${expired ? "❌ Expired" : "✅ Active"}\nExpires: ${latestKey.validity}`,
      getKeyMenu()
    );
    return;
  }

  const now = new Date();
  const expired = now > new Date(user.keyExpiry);
  bot.sendMessage(msg.chat.id, `🔑 Your Key:\n${user.key}\nStatus: ${expired ? "Expired" : "Active"}\nExpires: ${user.keyExpiry}`, getKeyMenu());
});

// Key History (from MongoDB history)
bot.onText(/📜 Key History/, async (msg) => {
  const user = await User.findOne({ userId: msg.from.id });
  if (!user || !user.keys.length) return bot.sendMessage(msg.chat.id, "❌ No key history found.", getKeyMenu());

  let text = "📜 Your Key History:\n";
  user.keys.forEach((k, i) => {
    text += `${i+1}. ${k.key} → ${k.status} (Expires: ${k.validity.toLocaleString()})\n`;
  });

  bot.sendMessage(msg.chat.id, text, getKeyMenu());
});

// ---------------- BACK BUTTON ----------------
bot.onText(/⬅️ Back/, (msg) => {
  bot.sendMessage(msg.chat.id, "⬅️ Main Menu:", getMainMenu());
});

// ---------------- ADMIN QR ----------------
bot.onText(/\/setqr (.+)/, (msg, match) => {
  if (msg.from.id.toString() !== ADMIN_ID) return bot.sendMessage(msg.chat.id, "❌ Only admin.");
  QR_IMAGE = match[1];
  bot.sendMessage(msg.chat.id, `✅ New QR set:\n${QR_IMAGE}`);
});

// ---------------- AUTO EXPIRE (Firebase -> MongoDB sync) ----------------
setInterval(async () => {
  try {
    const now = new Date();
    const userRef = fb.ref("userinfo");
    const snap = await userRef.get();
    if (!snap.exists()) return;
    const data = snap.val();

    for (const key in data) {
      if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
      const entry = data[key];
      if (!entry || !entry.validity) continue;

      const [datePart, timePart] = entry.validity.split(" ");
      if (!datePart || !timePart) continue;
      const [dd, mm, yyyy] = datePart.split("-");
      const [hh, min] = timePart.split(":");
      const expiryDate = new Date(yyyy, mm - 1, dd, hh, min);

      if (now > expiryDate && entry.status === "active") {
        // mark Firebase inactive
        await fb.ref("userinfo").child(key).update({ status: "inactive" });

        // update MongoDB history: find that key and mark expired
        await User.updateOne(
          { "keys.key": key },
          { $set: { "keys.$.status": "expired" } }
        );

        console.log(`⏳ Key expired and synced: ${key}`);
      }
    }
  } catch (err) {
    console.error("Auto-expire error:", err);
  }
}, 60 * 60 * 1000); // every 1 hour

// ---------------- ERROR HANDLING ----------------
process.on("unhandledRejection", err => console.error("Unhandled Rejection:", err));
process.on("uncaughtException", err => console.error("Uncaught Exception:", err));

// End of file

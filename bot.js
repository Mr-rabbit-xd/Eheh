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

function getMainMenu() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: "💰 Balance" }, { text: "💸 Deposit" }],
        [{ text: "👥 Referral" }, { text: "🔑 Key" }],
        [{ text: "🎁 Promo" }, { text: "🏆 Leaderboard" }],
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
const broadcastStep = {};

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
    `👋 Welcome ${msg.from.first_name}!\n\n🔑 এখানে key generate করতে পারবে, deposit করতে পারবে এবং referral system এর মাধ্যমে income করতে পারবে।\n\n👇 নিচের মেনু থেকে বেছে নাও:`,
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
// ---------------- Part 2 ----------------

// Helper: generate API key
function generateApiKey() {
  return "KEY-" + Math.random().toString(36).substring(2, 10).toUpperCase();
}

// ================= BOT MESSAGE HANDLER (UTR, Promo) =================
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text ? msg.text.trim() : "";

  // Ignore commands (they are handled separately)
  if (!text || text.startsWith("/")) return;

  // Deposit - expecting amount step handled in Part1 via depositStep
  if (depositStep[chatId]) {
    if (isNaN(text)) return bot.sendMessage(chatId, "❌ Please enter a valid number for amount.");
    const amount = parseInt(text);
    if (amount <= 0) return bot.sendMessage(chatId, "❌ Amount must be greater than 0.");
    // send QR (from env or default)
    const qr = QR_IMAGE || `https://via.placeholder.com/300?text=Pay+${amount}`;
    await bot.sendPhoto(chatId, qr, { caption: `📥 Deposit Started!\nAmount: ${amount}৳\n\n✅ After payment, send UTR/Txn ID (min 8 characters)` });
    utrStep[chatId] = { amount };
    delete depositStep[chatId];
    return;
  }

  // UTR step
  if (utrStep[chatId]) {
    const utr = text;
    if (utr.length < 8) return bot.sendMessage(chatId, "❌ UTR must be at least 8 characters.");
    const existing = await Deposit.findOne({ utr });
    if (existing) return bot.sendMessage(chatId, "❌ This UTR is already used. Please enter a new UTR.");

    const dep = new Deposit({ userId: msg.from.id, amount: utrStep[chatId].amount, utr, status: "pending" });
    await dep.save();

    // notify admin with inline approve/cancel buttons
    await bot.sendMessage(ADMIN_ID, `📢 New Deposit Request:\n👤 ${msg.from.first_name} (@${msg.from.username || "NA"})\n💰 ${utrStep[chatId].amount}৳\nUTR: ${utr}\nDepositID: ${dep._id}`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "✅ Approve", callback_data: `approve_${dep._id}` }, { text: "❌ Cancel", callback_data: `cancel_${dep._id}` }]
        ]
      }
    });

    await bot.sendMessage(chatId, `✅ Deposit request created for ${utrStep[chatId].amount}৳. Waiting for admin approval.`, getMainMenu());
    utrStep[chatId] = null;
    return;
  }

  // Promo step
  if (promoStep[chatId]) {
    const code = text.toUpperCase();
    const promo = await Promo.findOne({ code });
    if (!promo) {
      promoStep[chatId] = null;
      return bot.sendMessage(chatId, "❌ Invalid promo code.", getPromoMenu());
    }
    // check used
    if (promo.usedBy.includes(String(msg.from.id))) {
      promoStep[chatId] = null;
      return bot.sendMessage(chatId, "❌ You have already used this promo.", getPromoMenu());
    }
    // apply
    const user = await User.findOne({ userId: msg.from.id });
    if (!user) {
      promoStep[chatId] = null;
      return bot.sendMessage(chatId, "❌ User not found.", getPromoMenu());
    }
    user.balance += promo.amount;
    await user.save();
    promo.usedBy.push(String(msg.from.id));
    await promo.save();
    promoStep[chatId] = null;
    return bot.sendMessage(chatId, `🎉 Promo applied! +${promo.amount}৳ added to your balance.`, getPromoMenu());
  }

  // Broadcast step (admin)
  if (broadcastStep[chatId]) {
    // we expect admin to type the broadcast message; then send to all users
    if (String(msg.from.id) !== String(ADMIN_ID)) {
      broadcastStep[chatId] = null;
      return bot.sendMessage(chatId, "❌ Only admin can broadcast.");
    }
    const allUsers = await User.find();
    let sent = 0;
    for (const u of allUsers) {
      try {
        await bot.sendMessage(u.userId, `📢 Broadcast from Admin:\n\n${text}`);
        sent++;
      } catch (e) {
        // ignore send errors
      }
    }
    broadcastStep[chatId] = null;
    return bot.sendMessage(chatId, `✅ Broadcast sent to ${sent} users.`);
  }

  // default fallback (if not in any step) - ignore or help
});

// ---------------- REFERRAL ----------------
bot.onText(/👥 Referral/, (msg) => {
  bot.sendMessage(msg.chat.id, "👥 Referral Menu:", getReferralMenu());
});

bot.onText(/👀 Check Referrals/, async (msg) => {
  const user = await User.findOne({ userId: msg.from.id });
  if (!user || !user.referrals.length) return bot.sendMessage(msg.chat.id, "❌ No referrals yet.", getReferralMenu());
  let list = "👥 Your Referrals:\n";
  for (let i = 0; i < user.referrals.length; i++) {
    const r = user.referrals[i];
    const ru = await User.findOne({ userId: r });
    list += `${i+1}. ${ru ? (ru.name || ru.userId) : r}\n`;
  }
  bot.sendMessage(msg.chat.id, list, getReferralMenu());
});

bot.onText(/🏆 Top Referrers/, async (msg) => {
  const users = await User.find();
  const leaderboard = users.map(u => ({ name: u.name || u.userId, count: u.referrals.length })).sort((a,b)=>b.count-a.count).slice(0,10);
  if (!leaderboard.length) return bot.sendMessage(msg.chat.id, "❌ No referral data.", getReferralMenu());
  let txt = "🏆 Top Referrers:\n";
  leaderboard.forEach((u,i) => txt += `${i+1}. ${u.name} → ${u.count}\n`);
  bot.sendMessage(msg.chat.id, txt, getReferralMenu());
});

// ---------------- KEY ----------------
bot.onText(/🔑 Key/, (msg) => bot.sendMessage(msg.chat.id, "🔑 Key Menu:", getKeyMenu()));

bot.onText(/🆕 Get Key/, async (msg) => {
  let user = await User.findOne({ userId: msg.from.id });
  if (!user) {
    user = new User({ userId: msg.from.id, name: msg.from.first_name, refCode: generateRefCode(msg.from.id) });
  }
  if (!user.key) {
    user.key = generateApiKey();
    await user.save();
  }
  bot.sendMessage(msg.chat.id, `✅ Your API Key:\n\`${user.key}\`\n\nUse this key in your panel to call API endpoints.`, { parse_mode: "Markdown", ...getKeyMenu() });
});

bot.onText(/🔑 Your Key/, async (msg) => {
  const user = await User.findOne({ userId: msg.from.id });
  if (!user || !user.key) return bot.sendMessage(msg.chat.id, "❌ You don't have an API key yet. Use 🆕 Get Key.", getKeyMenu());
  bot.sendMessage(msg.chat.id, `🔑 Your API Key:\n\`${user.key}\``, { parse_mode: "Markdown", ...getKeyMenu() });
});

// ---------------- PROMO MENU ----------------
bot.onText(/🎁 Promo/, (msg) => bot.sendMessage(msg.chat.id, "🎁 Promo Menu:", getPromoMenu()));

bot.onText(/🎁 Apply Promo/, (msg) => {
  promoStep[msg.chat.id] = true;
  bot.sendMessage(msg.chat.id, "🎁 Enter your promo code:");
});

// ---------------- LEADERBOARD & STATS ----------------
bot.onText(/🏆 Leaderboard/, (msg) => bot.sendMessage(msg.chat.id, "Use Referral Menu → 🏆 Top Referrers", getMainMenu()));

bot.onText(/📊 My Stats/, async (msg) => {
  const user = await User.findOne({ userId: msg.from.id });
  const totalDeposits = (user.deposits || []).reduce((s, d) => s + (d.amount || 0), 0);
  bot.sendMessage(msg.chat.id, `📊 *Your Stats*\n\n💰 Balance: ${user.balance}৳\n💳 Total Deposits: ${totalDeposits}৳\n👥 Referrals: ${user.referrals.length}\n🔑 API Key: ${user.key ? "Yes" : "No"}`, { parse_mode: "Markdown", ...getMainMenu() });
});

// ---------------- BACK ----------------
bot.onText(/⬅️ Back/, (msg) => bot.sendMessage(msg.chat.id, "⬅️ Main Menu:", getMainMenu()));
// ---------------- Part 3 ----------------

// ---------- ADMIN INLINE PANEL ----------
// Show admin panel inline (only visible to admin) — triggered by /admin
bot.onText(/\/admin/, async (msg) => {
  if (String(msg.from.id) !== String(ADMIN_ID)) return bot.sendMessage(msg.chat.id, "❌ Only admin can use this.");
  const chatId = msg.chat.id;
  const text = "🛠 Admin Panel — Use buttons below";
  const inline = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "📥 Pending Deposits", callback_data: "admin_pending" }, { text: "💳 Set QR", callback_data: "admin_setqr" }],
        [{ text: "🎁 Create Promo", callback_data: "admin_createpromo" }, { text: "📢 Broadcast", callback_data: "admin_broadcast" }],
        [{ text: "⚙️ Settings", callback_data: "admin_settings" }, { text: "⬅️ Close", callback_data: "admin_close" }]
      ]
    }
  };
  bot.sendMessage(chatId, text, inline);
});

// ---------- CALLBACK_QUERY for Admin Panel and Deposit Approve/Cancel ----------
bot.on("callback_query", async (query) => {
  const data = query.data;
  const fromId = String(query.from.id);
  const msg = query.message;

  // Only admin can interact with admin callbacks
  if (data && data.startsWith("admin_") && fromId !== String(ADMIN_ID)) {
    return bot.answerCallbackQuery(query.id, { text: "❌ Only admin can use this." });
  }

  // Handle admin panel actions
  if (data === "admin_pending") {
    // fetch pending deposits and show a list (first 5)
    const pending = await Deposit.find({ status: "pending" }).limit(10);
    if (!pending.length) {
      await bot.answerCallbackQuery(query.id, { text: "No pending deposits." });
      return bot.sendMessage(fromId, "✅ No pending deposits at the moment.");
    }
    for (const p of pending) {
      const u = await User.findOne({ userId: p.userId });
      const uname = u ? (u.name || u.userId) : p.userId;
      await bot.sendMessage(fromId, `🔔 DepositID: ${p._id}\nUser: ${uname}\nAmount: ${p.amount}৳\nUTR: ${p.utr}`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: "✅ Approve", callback_data: `approve_${p._id}` }, { text: "❌ Cancel", callback_data: `cancel_${p._id}` }]
          ]
        }
      });
    }
    await bot.answerCallbackQuery(query.id, { text: "Pending deposits listed." });
    return;
  }

  if (data === "admin_setqr") {
    // ask admin to send QR image URL (we'll use message step)
    await bot.answerCallbackQuery(query.id, { text: "Send the QR image URL in chat." });
    // set a short-lived state for admin to catch next message as QR
    bot.once("message", async (m) => {
      if (String(m.from.id) !== String(ADMIN_ID)) return;
      const url = m.text && m.text.trim();
      if (!url) return bot.sendMessage(ADMIN_ID, "❌ Invalid URL. Operation cancelled.");
      QR_IMAGE = url;
      return bot.sendMessage(ADMIN_ID, `✅ QR updated to: ${url}`);
    });
    return;
  }

  if (data === "admin_createpromo") {
    await bot.answerCallbackQuery(query.id, { text: "Send promo details in format: CODE AMOUNT" });
    // next admin message should contain code and amount
    bot.once("message", async (m) => {
      if (String(m.from.id) !== String(ADMIN_ID)) return;
      const parts = (m.text || "").split(/\s+/);
      if (parts.length < 2) return bot.sendMessage(ADMIN_ID, "❌ Use: CODE AMOUNT");
      const code = parts[0].toUpperCase();
      const amount = parseInt(parts[1]);
      if (!code || isNaN(amount)) return bot.sendMessage(ADMIN_ID, "❌ Invalid input.");
      const promo = new Promo({ code, amount, usedBy: [] });
      await promo.save();
      return bot.sendMessage(ADMIN_ID, `✅ Promo created: ${code} → ${amount}৳`);
    });
    return;
  }

  if (data === "admin_broadcast") {
    await bot.answerCallbackQuery(query.id, { text: "Send the broadcast message text in chat." });
    broadcastStep[ADMIN_ID] = true;
    return;
  }

  if (data === "admin_settings") {
    await bot.answerCallbackQuery(query.id, { text: "Settings are not inlined yet." });
    return bot.sendMessage(ADMIN_ID, "⚙️ Settings: (You can change code to implement settings UI)");
  }

  if (data === "admin_close") {
    await bot.answerCallbackQuery(query.id, { text: "Admin panel closed." });
    return bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: msg.chat.id, message_id: msg.message_id });
  }

  // ---------- Approve / Cancel deposit callbacks ----------
  if (data && (data.startsWith("approve_") || data.startsWith("cancel_"))) {
    // ensure only admin can approve/cancel
    if (fromId !== String(ADMIN_ID)) return bot.answerCallbackQuery(query.id, { text: "❌ Only admin." });

    const [action, depositId] = data.split("_");
    const deposit = await Deposit.findById(depositId);
    if (!deposit) return bot.answerCallbackQuery(query.id, { text: "❌ Deposit not found." });

    const user = await User.findOne({ userId: deposit.userId });
    if (!user) return bot.answerCallbackQuery(query.id, { text: "❌ User not found." });

    if (action === "approve") {
      // apply simple bonus logic (if amount > threshold, add small bonus)
      let finalAmount = deposit.amount;
      if (deposit.amount >= DEPOSIT_BONUS_THRESHOLD) {
        const bonus = Math.floor((DEPOSIT_BONUS_PERCENT / 100) * deposit.amount);
        finalAmount += bonus;
        try { await bot.sendMessage(user.userId, `🎁 Deposit Bonus! +${bonus}৳ added.`); } catch(e){}
      }
      user.balance += finalAmount;
      deposit.status = "approved";
      await user.save();
      await deposit.save();

      // referral bonus
      if (user.referredBy) {
        const refUser = await User.findOne({ refCode: user.referredBy });
        if (refUser) {
          const refBonus = Math.floor((REF_BONUS_PERCENT / 100) * deposit.amount);
          refUser.balance += refBonus;
          await refUser.save();
          try { await bot.sendMessage(refUser.userId, `🎉 You earned ${refBonus}৳ as referral bonus!`); } catch(e){}
        }
      }

      await bot.editMessageReplyMarkup({}, { chat_id: msg.chat.id, message_id: msg.message_id }).catch(()=>{});
      await bot.answerCallbackQuery(query.id, { text: "✅ Approved" });
      try { await bot.sendMessage(user.userId, `✅ Your ${deposit.amount}৳ deposit approved! New balance: ${user.balance}৳`); } catch(e){}
      return;
    } else {
      deposit.status = "cancelled";
      await deposit.save();
      await bot.editMessageReplyMarkup({}, { chat_id: msg.chat.id, message_id: msg.message_id }).catch(()=>{});
      await bot.answerCallbackQuery(query.id, { text: "❌ Cancelled" });
      try { await bot.sendMessage(user.userId, `❌ Your ${deposit.amount}৳ deposit was cancelled by admin.`); } catch(e){}
      return;
    }
  }

  // If callback wasn't matched above, answer generically
  return bot.answerCallbackQuery(query.id, { text: "Action processed." });
});

// ---------------- Error handlers & process events ----------------
process.on("unhandledRejection", err => console.error("Unhandled Rejection:", err));
process.on("uncaughtException", err => console.error("Uncaught Exception:", err));

import TelegramBot from "node-telegram-bot-api";
import mongoose from "mongoose";

// ====== CONFIG ======
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;
const MONGO_URI = process.env.MONGO_URI;

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ====== DATABASE ======
const userSchema = new mongoose.Schema({
  userId: Number,
  balance: { type: Number, default: 0 },
  referrals: { type: [Number], default: [] },
  key: String,
  keyExpiry: Date,
  keyPrice: Number,
  deposits: { type: [Object], default: [] },
});
const User = mongoose.model("User", userSchema);

mongoose.connect(MONGO_URI).then(() => console.log("✅ MongoDB Connected"));

// ====== KEY PRICES ======
let KEY_PRICES = {
  3: 150,
  7: 300,
  15: 500,
  30: 1000,
};

// ====== MAIN MENU ======
function mainMenu() {
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

// ====== START ======
bot.onText(/\/start/, async (msg) => {
  let user = await User.findOne({ userId: msg.from.id });
  if (!user) {
    user = new User({ userId: msg.from.id });
    await user.save();
  }
  bot.sendMessage(
    msg.chat.id,
    `👋 Welcome, ${msg.from.first_name}!\n\nUse the menu below:`,
    mainMenu()
  );
});

// ====== BALANCE ======
bot.onText(/💰 Balance/, async (msg) => {
  const user = await User.findOne({ userId: msg.from.id });
  bot.sendMessage(msg.chat.id, `💰 Your Balance: ₹${user.balance}`, mainMenu());
});

// ====== DEPOSIT MENU ======
bot.onText(/💸 Deposit/, (msg) => {
  bot.sendMessage(msg.chat.id, "💸 Deposit Menu:", {
    reply_markup: {
      keyboard: [
        [{ text: "💳 New Deposit" }, { text: "📜 Deposit History" }],
        [{ text: "⬅️ Back" }],
      ],
      resize_keyboard: true,
    },
  });
});

// ====== NEW DEPOSIT ======
bot.onText(/💳 New Deposit/, async (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "💳 Send deposit UTR ID here (demo mode, auto approve not added)"
  );
});

// ====== DEPOSIT HISTORY ======
bot.onText(/📜 Deposit History/, async (msg) => {
  const user = await User.findOne({ userId: msg.from.id });
  if (user.deposits.length === 0) {
    return bot.sendMessage(msg.chat.id, "📭 No deposit history found.");
  }
  let text = "📜 Your Deposits:\n\n";
  user.deposits.forEach((d, i) => {
    text += `${i + 1}. ₹${d.amount} – ${d.date}\n`;
  });
  bot.sendMessage(msg.chat.id, text);
});

// ====== REFERRAL MENU ======
bot.onText(/👥 Referral/, (msg) => {
  bot.sendMessage(msg.chat.id, "👥 Referral Menu:", {
    reply_markup: {
      keyboard: [
        [{ text: "👀 My Referrals" }, { text: "🏆 Top Referrers" }],
        [{ text: "⬅️ Back" }],
      ],
      resize_keyboard: true,
    },
  });
});

// ====== MY REFERRALS ======
bot.onText(/👀 My Referrals/, async (msg) => {
  const user = await User.findOne({ userId: msg.from.id });
  bot.sendMessage(
    msg.chat.id,
    `👥 You referred: ${user.referrals.length} users`
  );
});

// ====== TOP REFERRERS ======
bot.onText(/🏆 Top Referrers/, async (msg) => {
  const users = await User.find({});
  const leaderboard = users
    .map((u) => ({ id: u.userId, refs: u.referrals.length }))
    .sort((a, b) => b.refs - a.refs)
    .slice(0, 5);

  let text = "🏆 Top Referrers:\n\n";
  leaderboard.forEach((u, i) => {
    text += `${i + 1}. User ${u.id} → ${u.refs} referrals\n`;
  });
  bot.sendMessage(msg.chat.id, text);
});

// ====== BACK BUTTON ======
bot.onText(/⬅️ Back/, (msg) => {
  bot.sendMessage(msg.chat.id, "⬅️ Back to Main Menu:", mainMenu());
});
// ====== KEY MENU ======
bot.onText(/🔑 Key/, (msg) => {
  bot.sendMessage(msg.chat.id, "🔑 Key Menu:", {
    reply_markup: {
      keyboard: [
        [{ text: "🛒 Buy Key" }, { text: "🔑 Your Key" }],
        [{ text: "⬅️ Back" }],
      ],
      resize_keyboard: true,
    },
  });
});

// ====== BUY KEY ======
bot.onText(/🛒 Buy Key/, (msg) => {
  let text = "🛒 Select Key Plan:\n\n";
  Object.keys(KEY_PRICES).forEach((days) => {
    text += `📌 ${days} Days → ₹${KEY_PRICES[days]}\n`;
  });

  bot.sendMessage(msg.chat.id, text, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: `3 Days (₹${KEY_PRICES[3]})`, callback_data: "buy_3" },
          { text: `7 Days (₹${KEY_PRICES[7]})`, callback_data: "buy_7" },
        ],
        [
          { text: `15 Days (₹${KEY_PRICES[15]})`, callback_data: "buy_15" },
          { text: `30 Days (₹${KEY_PRICES[30]})`, callback_data: "buy_30" },
        ],
      ],
    },
  });
});

// ====== INLINE BUTTON BUY ======
bot.on("callback_query", async (query) => {
  const userId = query.from.id;
  const data = query.data;

  if (data.startsWith("buy_")) {
    const days = parseInt(data.split("_")[1]);
    const price = KEY_PRICES[days];

    const user = await User.findOne({ userId });
    if (user.balance < price) {
      return bot.answerCallbackQuery(query.id, {
        text: "❌ Not enough balance!",
        show_alert: true,
      });
    }

    // Deduct balance
    user.balance -= price;
    user.key = `KEY-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
    user.keyExpiry = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    user.keyPrice = price;
    await user.save();

    bot.editMessageText(
      `✅ Key Purchased!\n\n🔑 Key: ${user.key}\n📅 Valid for: ${days} days\n💰 Remaining Balance: ₹${user.balance}`,
      {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
      }
    );
  }
});

// ====== YOUR KEY ======
bot.onText(/🔑 Your Key/, async (msg) => {
  const user = await User.findOne({ userId: msg.from.id });
  if (!user.key) {
    return bot.sendMessage(msg.chat.id, "❌ You don't have any active key.", {
      reply_markup: {
        keyboard: [[{ text: "🛒 Buy Key" }], [{ text: "⬅️ Back" }]],
        resize_keyboard: true,
      },
    });
  }

  let expiry = user.keyExpiry
    ? user.keyExpiry.toLocaleDateString()
    : "No expiry date";

  bot.sendMessage(
    msg.chat.id,
    `🔑 Your Key: ${user.key}\n📅 Expiry: ${expiry}\n💰 Bought for: ₹${user.keyPrice}`
  );
});
// ================= Part 3 — Admin Panel & Controls =================

// Broadcast state
const broadcastStep = {}; // chatId -> true

// Admin menu - inline
bot.onText(/\/admin/, async (msg) => {
  if (String(msg.from.id) !== String(ADMIN_ID)) return bot.sendMessage(msg.chat.id, "❌ Only admin can use this.");
  const chatId = msg.chat.id;
  const text = "🛠 Admin Panel — Choose an action:";
  const inline = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🔑 Manage Keys", callback_data: "admin_manage_keys" }, { text: "💰 Change Prices", callback_data: "admin_change_prices" }],
        [{ text: "📢 Broadcast", callback_data: "admin_broadcast" }, { text: "👥 Users", callback_data: "admin_users" }],
        [{ text: "📊 Statistics", callback_data: "admin_stats" }, { text: "⬅️ Close", callback_data: "admin_close" }]
      ]
    }
  };
  await bot.sendMessage(chatId, text, inline);
});

// Central callback query handler for admin panel actions
bot.on("callback_query", async (query) => {
  const data = query.data;
  const fromId = String(query.from.id);
  const msg = query.message;

  // protect admin actions
  if (data && data.startsWith("admin_") && fromId !== String(ADMIN_ID)) {
    return bot.answerCallbackQuery(query.id, { text: "❌ Only admin can use this." });
  }

  // Close admin panel
  if (data === "admin_close") {
    try {
      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: msg.chat.id, message_id: msg.message_id });
    } catch (e) {}
    return bot.answerCallbackQuery(query.id, { text: "Closed." });
  }

  // ===== Manage Keys =====
  if (data === "admin_manage_keys") {
    const inline = {
      reply_markup: {
        inline_keyboard: [
          [{ text: "➕ Add Key to User", callback_data: "admin_addkey" }, { text: "➖ Remove Key from User", callback_data: "admin_removekey" }],
          [{ text: "📋 Active Keys", callback_data: "admin_activekeys" }, { text: "⬅️ Back", callback_data: "admin_back_main" }]
        ]
      }
    };
    await bot.editMessageText("🔑 Manage Keys — choose:", { chat_id: msg.chat.id, message_id: msg.message_id, ...inline });
    return bot.answerCallbackQuery(query.id);
  }

  if (data === "admin_back_main") {
    // show main admin panel again
    const text = "🛠 Admin Panel — Choose an action:";
    const inline = {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔑 Manage Keys", callback_data: "admin_manage_keys" }, { text: "💰 Change Prices", callback_data: "admin_change_prices" }],
          [{ text: "📢 Broadcast", callback_data: "admin_broadcast" }, { text: "👥 Users", callback_data: "admin_users" }],
          [{ text: "📊 Statistics", callback_data: "admin_stats" }, { text: "⬅️ Close", callback_data: "admin_close" }]
        ]
      }
    };
    await bot.editMessageText(text, { chat_id: msg.chat.id, message_id: msg.message_id, ...inline });
    return bot.answerCallbackQuery(query.id);
  }

  // Add Key -> ask admin for "userId days price" in next message
  if (data === "admin_addkey") {
    await bot.editMessageText("➕ Send: <userId> <days> <price>\nExample: `123456789 30 1000`", { chat_id: msg.chat.id, message_id: msg.message_id, parse_mode: "Markdown" });
    // wait for next admin message
    bot.once("message", async (m) => {
      if (String(m.from.id) !== String(ADMIN_ID)) return;
      const parts = (m.text || "").trim().split(/\s+/);
      if (parts.length < 3) return bot.sendMessage(ADMIN_ID, "❌ Invalid format. Use: <userId> <days> <price>");
      const targetId = parts[0];
      const days = parseInt(parts[1]);
      const price = parseInt(parts[2]);
      const target = await User.findOne({ userId: targetId });
      if (!target) return bot.sendMessage(ADMIN_ID, `❌ User ${targetId} not found.`);
      // create key
      target.key = "KEY-" + Math.random().toString(36).substring(2, 10).toUpperCase();
      target.keyPrice = price;
      target.keyExpiry = new Date(Date.now() + days * 24 * 3600 * 1000);
      await target.save();
      bot.sendMessage(ADMIN_ID, `✅ Key issued to ${targetId}\nKey: ${target.key}\nValid ${days} days\nPrice: ₹${price}`);
      try { await bot.sendMessage(targetId, `🔑 Admin issued you a key:\n${target.key}\nValid until: ${target.keyExpiry.toDateString()}`); } catch(e){}
    });
    return bot.answerCallbackQuery(query.id, { text: "Send userId days price in chat." });
  }

  // Remove Key -> ask admin for "userId"
  if (data === "admin_removekey") {
    await bot.editMessageText("➖ Send: <userId>\nExample: `123456789`", { chat_id: msg.chat.id, message_id: msg.message_id });
    bot.once("message", async (m) => {
      if (String(m.from.id) !== String(ADMIN_ID)) return;
      const targetId = (m.text || "").trim();
      const target = await User.findOne({ userId: targetId });
      if (!target) return bot.sendMessage(ADMIN_ID, `❌ User ${targetId} not found.`);
      target.key = null;
      target.keyExpiry = null;
      target.keyPrice = null;
      await target.save();
      bot.sendMessage(ADMIN_ID, `✅ Key removed for user ${targetId}`);
      try { await bot.sendMessage(targetId, `⚠️ Your API key has been revoked by admin.`); } catch(e){}
    });
    return bot.answerCallbackQuery(query.id, { text: "Send userId in chat." });
  }

  // Active keys list
  if (data === "admin_activekeys") {
    const usersWithKeys = await User.find({ key: { $exists: true, $ne: null } });
    if (!usersWithKeys.length) {
      await bot.editMessageText("No active keys found.", { chat_id: msg.chat.id, message_id: msg.message_id });
      return bot.answerCallbackQuery(query.id);
    }
    let text = "📋 Active Keys:\n\n";
    usersWithKeys.slice(0, 50).forEach(u => {
      text += `User: ${u.userId} → Key: ${u.key} (exp: ${u.keyExpiry ? u.keyExpiry.toDateString() : "N/A"})\n`;
    });
    await bot.editMessageText(text, { chat_id: msg.chat.id, message_id: msg.message_id });
    return bot.answerCallbackQuery(query.id);
  }

  // ===== Change Prices =====
  if (data === "admin_change_prices") {
    const inline = {
      reply_markup: {
        inline_keyboard: [
          [{ text: `3 days → ₹${KEY_PRICES[3]}`, callback_data: "admin_setprice_3" }],
          [{ text: `7 days → ₹${KEY_PRICES[7]}`, callback_data: "admin_setprice_7" }],
          [{ text: `15 days → ₹${KEY_PRICES[15]}`, callback_data: "admin_setprice_15" }],
          [{ text: `30 days → ₹${KEY_PRICES[30]}`, callback_data: "admin_setprice_30" }],
          [{ text: "⬅️ Back", callback_data: "admin_back_main" }]
        ]
      }
    };
    await bot.editMessageText("Select duration to change price:", { chat_id: msg.chat.id, message_id: msg.message_id, ...inline });
    return bot.answerCallbackQuery(query.id);
  }

  // Admin clicked a specific duration to set new price
  if (data.startsWith("admin_setprice_")) {
    const day = parseInt(data.split("_")[2]);
    await bot.answerCallbackQuery(query.id, { text: `Send new price for ${day} days in chat.` });
    // wait for next message from admin
    bot.once("message", async (m) => {
      if (String(m.from.id) !== String(ADMIN_ID)) return;
      const price = parseInt((m.text || "").trim());
      if (isNaN(price)) return bot.sendMessage(ADMIN_ID, "❌ Invalid price. Operation cancelled.");
      KEY_PRICES[day] = price;
      await bot.sendMessage(ADMIN_ID, `✅ Price updated: ${day} days → ₹${price}`);
      // Optionally notify all users or update a config store
    });
    return;
  }

  // ===== Broadcast =====
  if (data === "admin_broadcast") {
    await bot.editMessageText("📢 Send the broadcast message in chat. It will be sent to all users.", { chat_id: msg.chat.id, message_id: msg.message_id });
    // set a flag so message handler can pick it up, or use once:
    bot.once("message", async (m) => {
      if (String(m.from.id) !== String(ADMIN_ID)) return;
      const text = m.text || "";
      const users = await User.find();
      let sent = 0;
      for (const u of users) {
        try {
          await bot.sendMessage(u.userId, `📢 Broadcast:\n\n${text}`);
          sent++;
        } catch (e) {}
      }
      await bot.sendMessage(ADMIN_ID, `✅ Broadcast complete. Sent to ${sent} users.`);
    });
    return bot.answerCallbackQuery(query.id);
  }

  // ===== Users =====
  if (data === "admin_users") {
    const totalUsers = await User.countDocuments();
    const sample = await User.find().limit(20);
    let text = `👥 Total Users: ${totalUsers}\n\nSample list (first 20):\n`;
    sample.forEach(u => {
      text += `• ${u.userId} — Balance: ₹${u.balance} — Key: ${u.key ? "Yes" : "No"}\n`;
    });
    await bot.editMessageText(text, { chat_id: msg.chat.id, message_id: msg.message_id });
    return bot.answerCallbackQuery(query.id);
  }

  // ===== Stats =====
  if (data === "admin_stats") {
    const totalUsers = await User.countDocuments();
    const usersWithKeys = await User.countDocuments({ key: { $exists: true, $ne: null } });
    // total revenue estimate from keys
    const sold = await User.find({ keyPrice: { $exists: true, $ne: null } });
    const totalKeyRevenue = sold.reduce((s, u) => s + (u.keyPrice || 0), 0);
    // total deposits
    const allDeposits = await Deposit.find({ status: "approved" });
    const totalDeposits = allDeposits.reduce((s, d) => s + (d.amount || 0), 0);

    const text = `📊 Platform Stats:\n\nTotal Users: ${totalUsers}\nActive Keys: ${usersWithKeys}\nKey Revenue (est): ₹${totalKeyRevenue}\nApproved Deposits Total: ₹${totalDeposits}\n`;
    await bot.editMessageText(text, { chat_id: msg.chat.id, message_id: msg.message_id });
    return bot.answerCallbackQuery(query.id);
  }

});

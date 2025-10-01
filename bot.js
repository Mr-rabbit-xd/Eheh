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
}).then(() => console.log("✅ MongoDB Connected"))
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
        [{ text: "🔗 My Referral Link" }],   // ✅ নতুন বাটন
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

    // ✅ যদি referral দিয়ে জয়েন করে
    if (refCodeParam) {      
      const refUser = await User.findOne({ refCode: refCodeParam });      
      if (refUser && refUser.userId !== userId) {        
        user.referredBy = refUser.refCode;        
        refUser.referrals.push(userId);        
        await refUser.save();        

        // ✅ Referrer কে message পাঠাও
        await bot.sendMessage(
          refUser.userId,
          `🎉 আপনার রেফারেল লিঙ্ক দিয়ে নতুন একজন জয়েন করেছে: ${msg.from.first_name} (ID: ${userId})`
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
  const leaderboard = users.map(u => ({ name: u.name || u.userId, count: u.referrals.length }))
                           .sort((a,b)=>b.count-a.count)
                           .slice(0,10);  
  if (!leaderboard.length) return bot.sendMessage(msg.chat.id, "❌ No referral data.", getReferralMenu());  
  let txt = "🏆 Top Referrers:\n";  
  leaderboard.forEach((u,i) => txt += `${i+1}. ${u.name} → ${u.count}\n`);  
  bot.sendMessage(msg.chat.id, txt, getReferralMenu());
});

// ✅ নতুন: নিজের রেফারেল লিঙ্ক
bot.onText(/🔗 My Referral Link/, async (msg) => {
  const user = await User.findOne({ userId: msg.from.id });
  if (!user) return bot.sendMessage(msg.chat.id, "❌ User not found.", getReferralMenu());

  const botUsername = BOT_USERNAME || "YourBotUsername";
  const refLink = `https://t.me/${botUsername}?start=${user.refCode}`;

  bot.sendMessage(
    msg.chat.id,
    `🔗 আপনার রেফারেল লিঙ্ক:\n${refLink}\n\n👉 বন্ধুদের সাথে শেয়ার করুন, তারা ডিপোজিট করলে আপনি বোনাস পাবেন।`,
    getReferralMenu()
  );
});

// ---------------- KEY, PROMO, ADMIN ইত্যাদি সব তোমার কোডের মতোই থাকবে ----------------

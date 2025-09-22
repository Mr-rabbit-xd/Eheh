
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

// Telegram Commands
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, `👋 হ্যালো msg.from.first_name! to the Key Management Bot. /help to see commands.`);
);

bot.onText(/help/, (msg) => 
  bot.sendMessage(msg.chat.id, '📋 Commands:/start - Start the bot/help - Show this message');
);

// Express route (for Render health check)
app.get('/', (req, res) => 
  res.send('Bot is running!');
);

app.listen(PORT, () => 
  console.log(`🚀 Server running on port{PORT}`);
});
```

---



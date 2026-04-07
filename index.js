const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

const db = new sqlite3.Database('./xp.db');

db.run(`CREATE TABLE IF NOT EXISTS users (
  userId TEXT PRIMARY KEY,
  xp INTEGER,
  level INTEGER
)`);

let cooldown = {};

function getLevelXP(level) {
  return level * 100;
}

bot.on('message', (msg) => {
  if (!msg.from || msg.chat.type === 'private') return;

  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const name = msg.from.first_name;

  if (cooldown[userId] && Date.now() - cooldown[userId] < 5000) return;
  cooldown[userId] = Date.now();

  const gainedXP = Math.floor(Math.random() * 10) + 5;

  db.get(`SELECT * FROM users WHERE userId = ?`, [userId], (err, row) => {
    if (!row) {
      db.run(`INSERT INTO users VALUES (?, ?, ?)`, [userId, gainedXP, 1]);
      return;
    }

    let xp = row.xp + gainedXP;
    let level = row.level;

    if (xp >= getLevelXP(level)) {
      xp = 0;
      level++;

      bot.sendMessage(chatId, `🎉 ${name} reached level ${level}!`);

      if (level === 5) bot.setChatAdministratorCustomTitle(chatId, userId, "⭐ Active");
      if (level === 10) bot.setChatAdministratorCustomTitle(chatId, userId, "🔥 Pro");
      if (level === 20) bot.setChatAdministratorCustomTitle(chatId, userId, "👑 Elite");
    }

    db.run(`UPDATE users SET xp = ?, level = ? WHERE userId = ?`, [xp, level, userId]);
  });
});

bot.onText(/\/xp/, (msg) => {
  db.get(`SELECT * FROM users WHERE userId = ?`, [msg.from.id], (err, row) => {
    if (!row) return bot.sendMessage(msg.chat.id, "No XP yet.");
    bot.sendMessage(msg.chat.id, `⭐ Level: ${row.level}\nXP: ${row.xp}`);
  });
});

bot.onText(/\/leaderboard/, (msg) => {
  db.all(`SELECT * FROM users ORDER BY level DESC, xp DESC LIMIT 10`, (err, rows) => {
    let text = "🏆 Leaderboard:\n\n";
    rows.forEach((u, i) => text += `${i+1}. Level ${u.level} (${u.xp} XP)\n`);
    bot.sendMessage(msg.chat.id, text);
  });
});

// Owner command
bot.onText(/\/owner/, (msg) => {
  bot.sendMessage(msg.chat.id, "👑 Owner: brickdish");
});
const express = require("express");
const app = express();

app.get("/", (req, res) => res.send("Bot is running"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));

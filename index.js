const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();
const express = require("express");
const fs = require("fs");

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// Web server for Render
const app = express();
app.get("/", (req, res) => res.send("Bot is running"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));

// Database
const db = new sqlite3.Database('./xp.db');

db.run(`CREATE TABLE IF NOT EXISTS users (
  userId TEXT PRIMARY KEY,
  xp INTEGER,
  level INTEGER
)`);

// Cooldown
let cooldown = {};
const COOLDOWN_MS = 5000;

// Level formula
function getLevelXP(level) {
  return 100 + (level * 50);
}

// XP system
bot.on('message', (msg) => {
  if (!msg.from || msg.chat.type === 'private') return;

  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const name = msg.from.first_name;

  if (cooldown[userId] && Date.now() - cooldown[userId] < COOLDOWN_MS) return;
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

      // Safe titles
      if (level === 5) bot.setChatAdministratorCustomTitle(chatId, userId, "⭐ Active");
      if (level === 10) bot.setChatAdministratorCustomTitle(chatId, userId, "🔥 Pro");
      if (level === 20) bot.setChatAdministratorCustomTitle(chatId, userId, "👑 Elite");
    }

    db.run(`UPDATE users SET xp = ?, level = ? WHERE userId = ?`, [xp, level, userId]);
  });
});

// XP command
bot.onText(/\/xp/, (msg) => {
  db.get(`SELECT * FROM users WHERE userId = ?`, [msg.from.id], (err, row) => {
    if (!row) return bot.sendMessage(msg.chat.id, "No XP yet.");
    bot.sendMessage(msg.chat.id, `⭐ Level: ${row.level}\nXP: ${row.xp}`);
  });
});

// LEVEL command (added)
bot.onText(/\/level/, (msg) => {
  db.get(`SELECT * FROM users WHERE userId = ?`, [msg.from.id], (err, row) => {
    if (!row) return bot.sendMessage(msg.chat.id, "No level yet.");
    bot.sendMessage(msg.chat.id, `🎯 Your Level: ${row.level}`);
  });
});

// Leaderboard with names
bot.onText(/\/leaderboard/, (msg) => {
  const chatId = msg.chat.id;

  db.all(`SELECT * FROM users ORDER BY level DESC, xp DESC LIMIT 10`, async (err, rows) => {
    if (!rows || rows.length === 0) {
      return bot.sendMessage(chatId, "No data yet.");
    }

    let text = "🏆 Leaderboard:\n\n";

    for (let i = 0; i < rows.length; i++) {
      try {
        const user = await bot.getChatMember(chatId, rows[i].userId);
        const name = user.user.username
          ? "@" + user.user.username
          : user.user.first_name;

        text += `${i + 1}. ${name} — Level ${rows[i].level} (${rows[i].xp} XP)\n`;
      } catch {
        text += `${i + 1}. Unknown — Level ${rows[i].level} (${rows[i].xp} XP)\n`;
      }
    }

    bot.sendMessage(chatId, text);
  });
});

// REPORT command
bot.onText(/\/report/, (msg) => {
  const chatId = msg.chat.id;

  db.all(`SELECT * FROM users`, (err, rows) => {
    if (!rows || rows.length === 0) {
      return bot.sendMessage(chatId, "No data yet.");
    }

    let totalUsers = rows.length;
    let totalXP = 0;
    let totalLevels = 0;

    rows.forEach(user => {
      totalXP += user.xp;
      totalLevels += user.level;
    });

    const avgLevel = (totalLevels / totalUsers).toFixed(2);

    let text = `📊 Bot Report

👥 Total Users: ${totalUsers}
⭐ Total XP: ${totalXP}
📈 Average Level: ${avgLevel}
`;

    bot.sendMessage(chatId, text);
  });
});

// EXPORT command (downloads JSON file)
bot.onText(/\/export/, (msg) => {
  const chatId = msg.chat.id;

  db.all(`SELECT * FROM users`, (err, rows) => {
    if (!rows || rows.length === 0) {
      return bot.sendMessage(chatId, "No data to export.");
    }

    const filePath = "./report.json";
    fs.writeFileSync(filePath, JSON.stringify(rows, null, 2));

    bot.sendDocument(chatId, filePath);
  });
});

// Owner command
bot.onText(/\/owner/, (msg) => {
  bot.sendMessage(msg.chat.id, "👑 Owner: brickdish");
});

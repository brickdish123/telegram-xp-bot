const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();
const express = require("express");
const fs = require("fs");
const PDFDocument = require("pdfkit");
const { Document, Packer, Paragraph, Table, TableRow, TableCell } = require("docx");

// ===== BOT INIT (FIX 409 ERROR) =====
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: false });

bot.deleteWebHook().then(() => {
  bot.startPolling();
});

// ===== RENDER SERVER =====
const app = express();
app.get("/", (req, res) => res.send("Bot running"));
const PORT = process.env.PORT || 3000;
app.listen(PORT);

// ===== DATABASE =====
const db = new sqlite3.Database('./xp.db');

db.run(`CREATE TABLE IF NOT EXISTS users (
  userId TEXT PRIMARY KEY,
  xp INTEGER
)`);

// ===== COOLDOWNS =====
let messageCooldown = {};
let dailyCooldown = {};

// ===== XP SYSTEM =====
bot.on('message', (msg) => {
  if (!msg.from || msg.chat.type === 'private' || msg.text.startsWith('/')) return;

  const userId = msg.from.id;

  if (messageCooldown[userId] && Date.now() - messageCooldown[userId] < 5000) return;
  messageCooldown[userId] = Date.now();

  const gainedXP = 2;

  db.run(
    `INSERT INTO users (userId, xp) VALUES (?, ?)
     ON CONFLICT(userId) DO UPDATE SET xp = xp + ?`,
    [userId, gainedXP, gainedXP]
  );
});

// ===== DAILY =====
bot.onText(/\/daily/, (msg) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const now = Date.now();

  const COOLDOWN = 24 * 60 * 60 * 1000;

  if (dailyCooldown[userId] && now - dailyCooldown[userId] < COOLDOWN) {
    const remaining = COOLDOWN - (now - dailyCooldown[userId]);
    const hours = Math.floor(remaining / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);

    return bot.sendMessage(chatId, `⏳ Come back in ${hours}h ${minutes}m`);
  }

  dailyCooldown[userId] = now;

  const rewardXP = 2;

  db.run(
    `INSERT INTO users (userId, xp) VALUES (?, ?)
     ON CONFLICT(userId) DO UPDATE SET xp = xp + ?`,
    [userId, rewardXP, rewardXP]
  );

  bot.sendMessage(chatId, `🎁 You received ${rewardXP} XP!`);
});

// ===== XP CHECK =====
bot.onText(/\/xp/, (msg) => {
  db.get(`SELECT xp FROM users WHERE userId = ?`, [msg.from.id], (err, row) => {
    if (!row) return bot.sendMessage(msg.chat.id, "No XP yet.");
    bot.sendMessage(msg.chat.id, `⭐ XP: ${row.xp}`);
  });
});

// ===== LEADERBOARD =====
bot.onText(/\/leaderboard/, (msg) => {
  const chatId = msg.chat.id;

  db.all(`SELECT * FROM users ORDER BY xp DESC LIMIT 10`, async (err, rows) => {
    let text = "🏆 Leaderboard:\n\n";

    for (let i = 0; i < rows.length; i++) {
      try {
        const user = await bot.getChatMember(chatId, rows[i].userId);
        const name = user.user.username
          ? "@" + user.user.username
          : user.user.first_name;

        text += `${i + 1}. ${name} — ${rows[i].xp} XP\n`;
      } catch {
        text += `${i + 1}. Unknown — ${rows[i].xp} XP\n`;
      }
    }

    bot.sendMessage(chatId, text);
  });
});

// ===== ADMIN: ADD XP =====
bot.onText(/\/addxp (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;

  const member = await bot.getChatMember(chatId, msg.from.id);
  if (!['administrator', 'creator'].includes(member.status)) {
    return bot.sendMessage(chatId, "❌ Only admins can use this.");
  }

  if (!msg.reply_to_message) {
    return bot.sendMessage(chatId, "⚠️ Reply to a user.\nExample: reply + /addxp 50");
  }

  const userId = msg.reply_to_message.from.id;
  const amount = parseInt(match[1]);

  db.run(
    `INSERT INTO users (userId, xp) VALUES (?, ?)
     ON CONFLICT(userId) DO UPDATE SET xp = xp + ?`,
    [userId, amount, amount]
  );

  bot.sendMessage(chatId, `✅ Added ${amount} XP`);
});

// ===== ADMIN: REMOVE XP =====
bot.onText(/\/removexp (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;

  const member = await bot.getChatMember(chatId, msg.from.id);
  if (!['administrator', 'creator'].includes(member.status)) {
    return bot.sendMessage(chatId, "❌ Only admins can use this.");
  }

  if (!msg.reply_to_message) {
    return bot.sendMessage(chatId, "⚠️ Reply to a user.\nExample: reply + /removexp 20");
  }

  const userId = msg.reply_to_message.from.id;
  const amount = parseInt(match[1]);

  db.run(
    `UPDATE users SET xp = MAX(xp - ?, 0) WHERE userId = ?`,
    [amount, userId]
  );

  bot.sendMessage(chatId, `➖ Removed ${amount} XP`);
});

// ===== EXPORT JSON =====
bot.onText(/\/export$/, async (msg) => {
  const chatId = msg.chat.id;

  db.all(`SELECT * FROM users ORDER BY xp DESC`, async (err, rows) => {
    let data = [];

    for (let row of rows) {
      try {
        const user = await bot.getChatMember(chatId, row.userId);
        const name = user.user.username
          ? "@" + user.user.username
          : user.user.first_name;

        data.push({ username: name, xp: row.xp });
      } catch {
        data.push({ username: "Unknown", xp: row.xp });
      }
    }

    fs.writeFileSync("report.json", JSON.stringify(data, null, 2));
    bot.sendDocument(chatId, "report.json");
  });
});

// ===== EXPORT CSV =====
bot.onText(/\/exportcsv/, async (msg) => {
  const chatId = msg.chat.id;

  db.all(`SELECT * FROM users ORDER BY xp DESC`, async (err, rows) => {
    let csv = "User account,XP\n";

    for (let row of rows) {
      try {
        const user = await bot.getChatMember(chatId, row.userId);
        const name = user.user.username
          ? "@" + user.user.username
          : user.user.first_name;

        csv += `${name},${row.xp}\n`;
      } catch {
        csv += `Unknown,${row.xp}\n`;
      }
    }

    fs.writeFileSync("report.csv", csv);
    bot.sendDocument(chatId, "report.csv");
  });
});

// ===== EXPORT PDF =====
bot.onText(/\/exportpdf/, async (msg) => {
  const chatId = msg.chat.id;

  db.all(`SELECT * FROM users ORDER BY xp DESC`, async (err, rows) => {
    const doc = new PDFDocument();
    const stream = fs.createWriteStream("report.pdf");

    doc.pipe(stream);
    doc.fontSize(16).text("XP Report", { align: "center" });
    doc.moveDown();
    doc.text("User | XP");
    doc.moveDown();

    for (let row of rows) {
      let name = "Unknown";
      try {
        const user = await bot.getChatMember(chatId, row.userId);
        name = user.user.username || user.user.first_name;
      } catch {}

      doc.text(`${name} | ${row.xp}`);
    }

    doc.end();

    stream.on("finish", () => {
      bot.sendDocument(chatId, "report.pdf");
    });
  });
});

// ===== EXPORT DOCX =====
bot.onText(/\/exportdocx/, async (msg) => {
  const chatId = msg.chat.id;

  db.all(`SELECT * FROM users ORDER BY xp DESC`, async (err, rows) => {
    const tableRows = [];

    for (let row of rows) {
      let name = "Unknown";
      try {
        const user = await bot.getChatMember(chatId, row.userId);
        name = user.user.username || user.user.first_name;
      } catch {}

      tableRows.push(
        new TableRow({
          children: [
            new TableCell({ children: [new Paragraph(name)] }),
            new TableCell({ children: [new Paragraph(String(row.xp))] })
          ]
        })
      );
    }

    const doc = new Document({
      sections: [{
        children: [
          new Paragraph("XP Report"),
          new Table({
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph("User")] }),
                  new TableCell({ children: [new Paragraph("XP")] })
                ]
              }),
              ...tableRows
            ]
          })
        ]
      }]
    });

    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync("report.docx", buffer);
    bot.sendDocument(chatId, "report.docx");
  });
});

// ===== OWNER =====
bot.onText(/\/owner/, (msg) => {
  bot.sendMessage(msg.chat.id, "👑 Owner: brickdish");
});

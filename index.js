const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();
const express = require("express");
const fs = require("fs");
const PDFDocument = require("pdfkit");
const { Document, Packer, Paragraph, Table, TableRow, TableCell } = require("docx");

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// Render server
const app = express();
app.get("/", (req, res) => res.send("Bot running"));
const PORT = process.env.PORT || 3000;
app.listen(PORT);

// Database
const db = new sqlite3.Database('./xp.db');

db.run(`CREATE TABLE IF NOT EXISTS users (
  userId TEXT PRIMARY KEY,
  xp INTEGER
)`);

// Cooldowns
let messageCooldown = {};
let dailyCooldown = {};

// ================= XP SYSTEM =================
bot.on('message', (msg) => {
  if (!msg.from || msg.chat.type === 'private') return;

  const userId = msg.from.id;

  if (messageCooldown[userId] && Date.now() - messageCooldown[userId] < 5000) return;
  messageCooldown[userId] = Date.now();

  const gainedXP = 2;

  db.get(`SELECT * FROM users WHERE userId = ?`, [userId], (err, row) => {
    if (!row) {
      db.run(`INSERT INTO users VALUES (?, ?)`, [userId, gainedXP]);
    } else {
      db.run(`UPDATE users SET xp = xp + ? WHERE userId = ?`, [gainedXP, userId]);
    }
  });
});

// ================= DAILY =================
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

  const rewardXP = 10;

  db.get(`SELECT * FROM users WHERE userId = ?`, [userId], (err, row) => {
    if (!row) {
      db.run(`INSERT INTO users VALUES (?, ?)`, [userId, rewardXP]);
    } else {
      db.run(`UPDATE users SET xp = xp + ? WHERE userId = ?`, [rewardXP, userId]);
    }

    bot.sendMessage(chatId, `🎁 You received ${rewardXP} XP!`);
  });
});

// ================= REFERRAL =================
bot.onText(/\/start (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const newUserId = msg.from.id;
  const referrerId = match[1].replace("ref_", "");

  if (newUserId == referrerId) return;

  const rewardXP = 5;

  db.get(`SELECT * FROM users WHERE userId = ?`, [referrerId], (err, row) => {
    if (!row) return;

    db.run(`UPDATE users SET xp = xp + ? WHERE userId = ?`, [rewardXP, referrerId]);

    bot.sendMessage(chatId, `🎉 Referral successful! 5 XP awarded.`);
  });
});

// ================= XP COMMAND =================
bot.onText(/\/xp/, (msg) => {
  db.get(`SELECT * FROM users WHERE userId = ?`, [msg.from.id], (err, row) => {
    if (!row) return bot.sendMessage(msg.chat.id, "No XP yet.");
    bot.sendMessage(msg.chat.id, `⭐ XP: ${row.xp}`);
  });
});

// ================= LEADERBOARD =================
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

// ================= EXPORT JSON =================
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

// ================= EXPORT CSV =================
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

// ================= EXPORT PDF =================
bot.onText(/\/exportpdf/, async (msg) => {
  const chatId = msg.chat.id;

  db.all(`SELECT * FROM users ORDER BY xp DESC`, async (err, rows) => {
    const doc = new PDFDocument();
    const stream = fs.createWriteStream("report.pdf");

    doc.pipe(stream);

    doc.fontSize(16).text("XP Report", { align: "center" });
    doc.moveDown();

    doc.text("User account | XP");
    doc.moveDown(0.5);

    for (let row of rows) {
      try {
        const user = await bot.getChatMember(chatId, row.userId);
        const name = user.user.username
          ? "@" + user.user.username
          : user.user.first_name;

        doc.text(`${name} | ${row.xp}`);
      } catch {
        doc.text(`Unknown | ${row.xp}`);
      }
    }

    doc.end();

    stream.on("finish", () => {
      bot.sendDocument(chatId, "report.pdf");
    });
  });
});

// ================= EXPORT DOCX =================
bot.onText(/\/exportdocx/, async (msg) => {
  const chatId = msg.chat.id;

  db.all(`SELECT * FROM users ORDER BY xp DESC`, async (err, rows) => {
    const tableRows = [];

    for (let row of rows) {
      let name = "Unknown";
      try {
        const user = await bot.getChatMember(chatId, row.userId);
        name = user.user.username
          ? "@" + user.user.username
          : user.user.first_name;
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

// ================= OWNER =================
bot.onText(/\/owner/, (msg) => {
  bot.sendMessage(msg.chat.id, "👑 Owner: brickdish");
});

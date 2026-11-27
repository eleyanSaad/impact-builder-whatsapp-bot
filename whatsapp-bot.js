import express from "express";
import fetch from "node-fetch";
import Redis from "ioredis";
import { getMetaConfig } from "./odoo-config.js";

const app = express();
app.use(express.json());

let WA_TOKEN, WA_PHONE_ID, WA_VERIFY_TOKEN;
const PAYMENT_BASE    = process.env.PAYMENT_BASE_URL;

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
const SESSION_TTL = 60 * 60 * 24;

// ── Ramadan ATJ config ──────────────────────────────────────────────
// Automated Ajr: set giving once, reward flows every blessed night.

const CAUSES = {
  "1": { id: "iftar",  name: "Feed a Fasting Soul", emoji: "🍲", costPerson: 10, costFamily: 35,
         hadith: '"Whoever feeds a fasting person earns a reward like theirs." — Tirmidhi' },
  "2": { id: "orphan", name: "Sponsor an Orphan",   emoji: "🤲", costPerson: 50, costFamily: 150,
         hadith: '"I and the guardian of an orphan are like these two in Paradise." — Bukhari' },
  "3": { id: "water",  name: "Water for Life",      emoji: "💧", costPerson: 15, costFamily: 60,
         hadith: '"The best charity is giving water to drink." — Ahmad' },
};

const NIGHTS = {
  "1": { id: "all30",  label: "All 30 Nights",      emoji: "🌙", days: 30, note: "Ajr every single night" },
  "2": { id: "last10", label: "The Last 10 Nights", emoji: "✨", days: 10, note: "When mercy descends" },
  "3": { id: "qadr",   label: "Laylat al-Qadr",     emoji: "🌟", days: 1,  note: "Better than 1,000 months" },
};

const REACH = {
  "1": { type: "person", count: 1, emoji: "🤲",      label: "One Person" },
  "2": { type: "family", count: 1, emoji: "👨‍👩‍👧", label: "One Family (~5)" },
  "3": { type: "family", count: 3, emoji: "🏘️",     label: "Three Families" },
};

// ── Session ─────────────────────────────────────────────────────────
async function getSession(phone) {
  const raw = await redis.get(`session:${phone}`);
  return raw ? JSON.parse(raw) : { step: 0, data: {} };
}
async function saveSession(phone, session) {
  await redis.set(`session:${phone}`, JSON.stringify(session), "EX", SESSION_TTL);
}
async function clearSession(phone) {
  await redis.del(`session:${phone}`);
}

// ── WhatsApp send ───────────────────────────────────────────────────
async function sendMessage(to, text) {
  const response = await fetch(`https://graph.facebook.com/v19.0/${WA_PHONE_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text, preview_url: false } }),
  });
  if (!response.ok) throw new Error(`WhatsApp send failed (${response.status}): ${await response.text()}`);
}

async function sendButtons(to, body, buttons) {
  const chunks = [];
  for (let i = 0; i < buttons.length; i += 3) chunks.push(buttons.slice(i, i + 3));
  for (const chunk of chunks) {
    const response = await fetch(`https://graph.facebook.com/v19.0/${WA_PHONE_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp", to, type: "interactive",
        interactive: {
          type: "button", body: { text: body },
          action: { buttons: chunk.map(b => ({ type: "reply", reply: { id: b.id, title: b.label.slice(0, 20) } })) },
        },
      }),
    });
    if (!response.ok) throw new Error(`WhatsApp send failed (${response.status}): ${await response.text()}`);
  }
}

// ── Steps (4 total) ─────────────────────────────────────────────────
async function stepCause(phone) {
  await sendButtons(phone,
    `🌙✨ *Ramadan Mubarak* ✨🌙\n\n` +
    `Welcome to *Islamic Relief Canada* — your *Automated Ajr* companion.\n\n` +
    `Set your giving once, and let your reward flow *every blessed night*, even while you sleep. 🤲\n\n` +
    `━━━━━━━━━━━━━━\n` +
    `*① What will you give?*\n\n` +
    `🍲 *1* · Feed a Fasting Soul\n      _$10 person · $35 family_\n\n` +
    `🤲 *2* · Sponsor an Orphan\n      _$50 person · $150 family_\n\n` +
    `💧 *3* · Water for Life\n      _$15 person · $60 family_`,
    [{ id: "cause_1", label: "🍲 Feed" }, { id: "cause_2", label: "🤲 Orphan" }, { id: "cause_3", label: "💧 Water" }]
  );
}

async function stepNights(phone, session) {
  const c = CAUSES[session.data.causeKey];
  await sendButtons(phone,
    `${c.emoji} *${c.name}* ✓\n\n` +
    `_${c.hadith}_\n\n` +
    `━━━━━━━━━━━━━━\n` +
    `*② When shall your ajr flow?* 🌙\n\n` +
    `🌙 *1* · All 30 Nights — _give every night_\n\n` +
    `✨ *2* · The Last 10 Nights — _the nights of mercy_\n\n` +
    `🌟 *3* · Laylat al-Qadr — _better than 1,000 months_`,
    [{ id: "night_1", label: "🌙 All 30" }, { id: "night_2", label: "✨ Last 10" }, { id: "night_3", label: "🌟 Al-Qadr" }]
  );
}

async function stepReach(phone, session) {
  const n = NIGHTS[session.data.nightKey];
  await sendButtons(phone,
    `${n.emoji} *${n.label}* ✓  _(${n.note})_\n\n` +
    `━━━━━━━━━━━━━━\n` +
    `*③ How far will your kindness reach?* 🤲\n\n` +
    `🤲 *1* · One Person\n` +
    `👨‍👩‍👧 *2* · One Family _(~5 souls)_\n` +
    `🏘️ *3* · Three Families\n\n` +
    `_Or just type a number — e.g._ *"5 families"*`,
    [{ id: "reach_1", label: "🤲 1 Person" }, { id: "reach_2", label: "👨‍👩‍👧 1 Family" }, { id: "reach_3", label: "🏘️ 3 Families" }]
  );
}

async function stepSummary(phone, session) {
  const c     = CAUSES[session.data.causeKey];
  const n     = NIGHTS[session.data.nightKey];
  const reach = session.data.reach;
  const unit  = reach.type === "family" ? c.costFamily : c.costPerson;
  const word  = reach.type === "family"
    ? (reach.count === 1 ? "family" : "families")
    : (reach.count === 1 ? "person" : "people");
  const total = unit * reach.count * n.days;

  session.data.grandTotal = total;
  await saveSession(phone, session);

  const perNight = n.days > 1 ? `\n      $${unit} × ${reach.count} × ${n.days} nights` : "";
  await sendButtons(phone,
    `*Your Ramadan Ajr Plan* 🌙✨\n\n` +
    `━━━━━━━━━━━━━━\n` +
    `${c.emoji} ${c.name}\n` +
    `${n.emoji} ${n.label}\n` +
    `🫶 ${reach.count} ${word}${perNight}\n` +
    `━━━━━━━━━━━━━━\n\n` +
    `💚 *Total: $${total} CAD*\n` +
    `🌍 Delivered where it's needed most\n` +
    `📋 100% tax-deductible\n\n` +
    `_One payment. Ajr that flows every night, in shā' Allāh._ 🤲`,
    [{ id: "confirm_pay", label: "✅ Confirm & Pay" }, { id: "edit_plan", label: "✏️ Edit plan" }]
  );
}

async function stepPayment(phone, session) {
  const token = Buffer.from(`${phone}:${Date.now()}`).toString("base64url").slice(0, 10);
  const link  = `${PAYMENT_BASE}/${token}`;
  await sendMessage(phone,
    `🔒 *Your secure payment link*\n\n${link}\n\n` +
    `_Valid 24 hours · tax receipt emailed automatically._\n\n` +
    `May Allah accept it from you and multiply it. 🌙\n` +
    `*Jazāk Allāhu Khayran* 🤲`
  );
  await clearSession(phone);
}

// ── Input parsing ───────────────────────────────────────────────────
function parseReach(text) {
  const t = text.toLowerCase().trim();
  if (t.startsWith("reach_")) {
    const r = REACH[t.replace("reach_", "")];
    return r ? { type: r.type, count: r.count } : null;
  }
  const isFamily = /famil/.test(t);
  const m = t.match(/\d+/);
  const num = m ? parseInt(m[0], 10) : NaN;
  if (isNaN(num) || num < 1 || num > 50) return null;
  return { type: isFamily ? "family" : "person", count: num };
}

// ── Conversation engine ─────────────────────────────────────────────
async function handleMessage(phone, text) {
  const t = (text || "").trim().toLowerCase();
  const session = await getSession(phone);

  if (["start", "hi", "hello", "salam", "مرحبا", "السلام عليكم", "رمضان"].includes(t)) {
    await clearSession(phone);
    await saveSession(phone, { step: 1, data: {} });
    await stepCause(phone);
    return;
  }

  switch (session.step) {
    case 0: {
      session.step = 1;
      await saveSession(phone, session);
      await stepCause(phone);
      return;
    }
    case 1: { // cause
      const key = t.replace("cause_", "");
      if (!CAUSES[key]) { await sendMessage(phone, "Please tap an option, or reply 1, 2, or 3. 🌙"); return; }
      session.data.causeKey = key;
      session.step = 2;
      await saveSession(phone, session);
      await stepNights(phone, session);
      return;
    }
    case 2: { // nights
      const key = t.replace("night_", "");
      if (!NIGHTS[key]) { await sendMessage(phone, "Please choose your nights — reply 1, 2, or 3. ✨"); return; }
      session.data.nightKey = key;
      session.step = 3;
      await saveSession(phone, session);
      await stepReach(phone, session);
      return;
    }
    case 3: { // reach
      const reach = parseReach(t);
      if (!reach) { await sendMessage(phone, 'Tap an option, or type a number up to 50 — e.g. *"5 families"*. 🤲'); return; }
      session.data.reach = reach;
      session.step = 4;
      await saveSession(phone, session);
      await stepSummary(phone, session);
      return;
    }
    case 4: { // confirm / edit
      if (t === "confirm_pay" || t.includes("yes") || t.includes("confirm")) {
        session.step = 5;
        await saveSession(phone, session);
        await stepPayment(phone, session);
      } else if (t === "edit_plan" || t.includes("edit")) {
        await saveSession(phone, { step: 1, data: {} });
        await stepCause(phone);
      } else {
        await sendMessage(phone, 'Tap *Confirm & Pay* to continue, or *Edit plan* to start over. 🌙');
      }
      return;
    }
    default: {
      await clearSession(phone);
      await sendMessage(phone, 'Type *start* to begin your Ramadan Ajr plan. 🌙');
    }
  }
}

// ── Webhook ─────────────────────────────────────────────────────────
app.get("/webhook", (req, res) => {
  const { "hub.mode": mode, "hub.verify_token": token, "hub.challenge": challenge } = req.query;
  if (mode === "subscribe" && token === WA_VERIFY_TOKEN) return res.send(challenge);
  res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  console.log("=== WEBHOOK HIT ===");
  console.log(JSON.stringify(req.body, null, 2));

  res.sendStatus(200);

  try {
    const message = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message) { console.log("No message found"); return; }

    const phone = message.from || message.from_user_id;
    if (!phone) { console.warn("Incoming message has no sender identifier"); return; }
    let text = "";

    if (message.type === "text") {
      text = message.text.body;
    } else if (message.type === "interactive") {
      text = message.interactive?.button_reply?.id || "";
    }

    console.log("PHONE:", phone);
    console.log("TEXT:", text);

    if (text) {
      await handleMessage(phone, text);
      console.log("Message processed");
    }
  } catch (err) {
    console.error("Webhook error:", err);
  }
});

const PORT = process.env.PORT || 3001;
try {
  const config = await getMetaConfig();
  WA_TOKEN = config.access_token;
  WA_PHONE_ID = config.phone_number_id;
  WA_VERIFY_TOKEN = config.verify_token;
  app.listen(PORT, () => console.log(`WhatsApp ATJ bot running on port ${PORT}`));
} catch (error) {
  console.error(`Cannot start WhatsApp bot: ${error.message}`);
  redis.disconnect();
  process.exitCode = 1;
}

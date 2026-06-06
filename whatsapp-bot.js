import express from "express";
import fetch from "node-fetch";
import Redis from "ioredis";

const app = express();
app.use(express.json());

const WA_TOKEN        = process.env.WA_TOKEN;
const WA_PHONE_ID     = process.env.WA_PHONE_ID;
const WA_VERIFY_TOKEN = process.env.WA_VERIFY_TOKEN;
const PAYMENT_BASE    = process.env.PAYMENT_BASE_URL;

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
const SESSION_TTL = 60 * 60 * 24;

const CAUSES = {
  "1": { id: "feed",          name: "Feed the Fasting",  costPerson: 10, costFamily: 35  },
  "2": { id: "orphan",        name: "Orphan Care",        costPerson: 50, costFamily: 150 },
  "3": { id: "pilgrim-meals", name: "Feed Pilgrims",      costPerson: 15, costFamily: 50  },
};

const EVENTS = {
  "1": { id: "ramadan",          name: "Ramadan",             days: 30 },
  "2": { id: "hajj-dhul-hijjah", name: "Hajj & Dhul Hijjah",  days: 10 },
  "3": { id: "shawwal",          name: "6 Days of Shawwal",   days: 6  },
  "4": { id: "ashura",           name: "Ashura",              days: 1  },
};

const SCHEDULE_OPTIONS = {
  ramadan:          { "1": { label: "All 30 nights",      days: 30 }, "2": { label: "Last 10 nights", days: 10 } },
  "hajj-dhul-hijjah": { "3": { label: "All 10 days",     days: 10 }, "4": { label: "Day of Arafah",  days: 1  } },
  shawwal:          { "5": { label: "All 6 days",         days: 6  } },
  ashura:           { "6": { label: "Ashura day",         days: 1  } },
};

const COUNTRIES = {
  "1": "Gaza 🇵🇸", "2": "Sudan 🇸🇩", "3": "Yemen 🇾🇪", "4": "Pakistan 🇵🇰", "5": "Global 🌍",
};

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

async function sendMessage(to, text) {
  await fetch(`https://graph.facebook.com/v19.0/${WA_PHONE_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text, preview_url: false } }),
  });
}

async function sendButtons(to, body, buttons) {
  const chunks = [];
  for (let i = 0; i < buttons.length; i += 3) chunks.push(buttons.slice(i, i + 3));
  for (const chunk of chunks) {
    await fetch(`https://graph.facebook.com/v19.0/${WA_PHONE_ID}/messages`, {
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
  }
}

async function stepCause(phone) {
  await sendButtons(phone,
    `Assalamu Alaikum! 🌙 Welcome to *Islamic Relief Canada*.\n\n*Step 1 of 7 — Choose your cause* 🌱\n\n1️⃣ Feed the Fasting — $10/person · $35/family\n2️⃣ Orphan Care — $50/person · $150/family\n3️⃣ Feed Pilgrims — $15/person · $50/family`,
    [{ id: "cause_1", label: "1 — Feed the Fasting" }, { id: "cause_2", label: "2 — Orphan Care" }, { id: "cause_3", label: "3 — Feed Pilgrims" }]
  );
}

async function stepEvents(phone, session) {
  const cause = CAUSES[session.data.causeKey];
  await sendMessage(phone,
    `*${cause.name}* selected ✓\n\n_"Whoever feeds a fasting person will have a reward equal to theirs."_ — Tirmidhi\n\n*Step 2 of 7 — Choose your blessed moments* 🗓️\n\nReply with numbers separated by commas e.g. *1,2*\n\n1️⃣ Ramadan — 30 nights\n2️⃣ Hajj & Dhul Hijjah — 10 days\n3️⃣ 6 Days of Shawwal\n4️⃣ Ashura — 1 day`
  );
}

async function stepCountry(phone, session) {
  const eventNames = session.data.eventKeys.map(k => EVENTS[k].name).join(", ");
  await sendButtons(phone,
    `*${eventNames}* selected ✓\n\n*Step 3 of 7 — Where will lives change?* 🌍\n\n🇵🇸 1 — Gaza _(Most urgent)_\n🇸🇩 2 — Sudan\n🇾🇪 3 — Yemen\n🇵🇰 4 — Pakistan\n🌍 5 — Global`,
    [{ id: "country_1", label: "1 — Gaza" }, { id: "country_2", label: "2 — Sudan" }, { id: "country_5", label: "5 — Global" }]
  );
}

async function stepImpactType(phone, session) {
  const cause = CAUSES[session.data.causeKey];
  await sendButtons(phone,
    `*Step 4 of 7 — Who receives your generosity?* 🤲\n\n1️⃣ Person — Direct support ($${cause.costPerson}/day)\n2️⃣ Family — ~5 people ($${cause.costFamily}/day)`,
    [{ id: "type_1", label: "1 — Person" }, { id: "type_2", label: "2 — Family" }]
  );
}

async function stepCount(phone, session) {
  const typeLabel = session.data.impactType === "family" ? "families" : "people";
  await sendButtons(phone,
    `*Step 5 of 7 — How many ${typeLabel} will you support?* 🔢\n\nChoose or reply with any number up to 50:`,
    [{ id: "count_1", label: "1" }, { id: "count_3", label: "3" }, { id: "count_5", label: "5" }]
  );
}

async function stepSchedule(phone, session) {
  const events = session.data.eventKeys.map(k => EVENTS[k]);
  let msg = `*Step 6 of 7 — Lock in your blessed moments* 🗓️\n`;
  let optionNum = 1;
  const optionMap = {};
  for (const ev of events) {
    const opts = SCHEDULE_OPTIONS[ev.id];
    msg += `\n*${ev.name}:*\n`;
    for (const [key, opt] of Object.entries(opts)) {
      msg += `${optionNum}️⃣ ${opt.label}\n`;
      optionMap[String(optionNum)] = { eventId: ev.id, optKey: key, days: opt.days, label: opt.label };
      optionNum++;
    }
  }
  msg += `\nReply with numbers e.g. *1,3*`;
  session.data.scheduleOptionMap = optionMap;
  await saveSession(phone, session);
  await sendMessage(phone, msg);
}

async function stepSummary(phone, session) {
  const cause     = CAUSES[session.data.causeKey];
  const country   = COUNTRIES[session.data.countryKey];
  const typeLabel = session.data.impactType === "family" ? "families" : "people";
  const costUnit  = session.data.impactType === "family" ? cause.costFamily : cause.costPerson;
  const count     = session.data.count;
  let lines = [];
  let grandTotal = 0;
  for (const sched of session.data.schedules) {
    const evKey = session.data.eventKeys.find(k => EVENTS[k].id === sched.eventId);
    const total = costUnit * count * sched.days;
    grandTotal += total;
    lines.push(`${EVENTS[evKey].name}\n   ${sched.label} · ${count} ${typeLabel} · $${costUnit} = *$${total} CAD*`);
  }
  session.data.grandTotal = grandTotal;
  await saveSession(phone, session);
  await sendButtons(phone,
    `*Your Impact Plan* ✨\n\n━━━━━━━━━━━━━━━━\n${lines.join("\n\n")}\n━━━━━━━━━━━━━━━━\n🌍 ${country}\n💚 Total: *$${grandTotal} CAD*\n📋 Tax-deductible\n\nSend payment link?`,
    [{ id: "confirm_pay", label: "Yes — send link" }, { id: "edit_plan", label: "Edit my plan" }]
  );
}

async function stepPayment(phone, session) {
  const token = Buffer.from(`${phone}:${Date.now()}`).toString("base64url").slice(0, 10);
  const link  = `${PAYMENT_BASE}/${token}`;
  await sendMessage(phone,
    `Your secure payment link 🔒\n\n${link}\n\n_Expires in 24 hours. Tax receipt emailed automatically._\n\n*Jazāk Allāhu Khayran* 🤲`
  );
  await clearSession(phone);
}

async function handleMessage(phone, text) {
  const t = (text || "").trim().toLowerCase();
  const session = await getSession(phone);

  if (["start", "hi", "hello", "مرحبا", "السلام عليكم"].includes(t)) {
    await clearSession(phone);
    const fresh = { step: 1, data: {} };
    await saveSession(phone, fresh);
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
    case 1: {
      const key = t.replace("cause_", "");
      if (!CAUSES[key]) { await sendMessage(phone, "Please reply 1, 2, or 3."); return; }
      session.data.causeKey = key;
      session.step = 2;
      await saveSession(phone, session);
      await stepEvents(phone, session);
      return;
    }
    case 2: {
      const keys = t.split(",").map(k => k.trim()).filter(k => EVENTS[k]);
      if (!keys.length) { await sendMessage(phone, "Please reply with numbers e.g. 1,2"); return; }
      session.data.eventKeys = keys;
      session.step = 3;
      await saveSession(phone, session);
      await stepCountry(phone, session);
      return;
    }
    case 3: {
      const key = t.replace("country_", "");
      if (!COUNTRIES[key]) { await sendMessage(phone, "Please reply 1–5."); return; }
      session.data.countryKey = key;
      session.step = 4;
      await saveSession(phone, session);
      await stepImpactType(phone, session);
      return;
    }
    case 4: {
      const key = t.replace("type_", "");
      if (!["1","2"].includes(key)) { await sendMessage(phone, "Please reply 1 or 2."); return; }
      session.data.impactType = key === "2" ? "family" : "person";
      session.step = 5;
      await saveSession(phone, session);
      await stepCount(phone, session);
      return;
    }
    case 5: {
      const num = parseInt(t.replace("count_", ""), 10);
      if (isNaN(num) || num < 1 || num > 50) { await sendMessage(phone, "Please reply with a number between 1 and 50."); return; }
      session.data.count = num;
      session.step = 6;
      await saveSession(phone, session);
      await stepSchedule(phone, session);
      return;
    }
    case 6: {
      const optMap = session.data.scheduleOptionMap || {};
      const schedules = t.split(",").map(k => optMap[k.trim()]).filter(Boolean);
      if (!schedules.length) { await sendMessage(phone, "Please reply with valid option numbers."); return; }
      session.data.schedules = schedules;
      session.step = 7;
      await saveSession(phone, session);
      await stepSummary(phone, session);
      return;
    }
    case 7: {
      if (t === "confirm_pay" || t.includes("yes")) {
        session.step = 8;
        await saveSession(phone, session);
        await stepPayment(phone, session);
      } else if (t === "edit_plan" || t.includes("edit")) {
        session.step = 1;
        session.data = {};
        await saveSession(phone, session);
        await stepCause(phone);
      } else {
        await sendMessage(phone, 'Reply "yes" to get your payment link or "edit" to change your plan.');
      }
      return;
    }
    default: {
      await clearSession(phone);
      await sendMessage(phone, 'Type *start* to begin a new donation plan.');
    }
  }
}

app.get("/webhook", (req, res) => {
  const { "hub.mode": mode, "hub.verify_token": token, "hub.challenge": challenge } = req.query;
  if (mode === "subscribe" && token === WA_VERIFY_TOKEN) return res.send(challenge);
  res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const message = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message) return;
    const phone = message.from;
    let text = "";
    if (message.type === "text") text = message.text.body;
    else if (message.type === "interactive") text = message.interactive?.button_reply?.id || "";
    if (text) await handleMessage(phone, text);
  } catch (err) {
    console.error("Webhook error:", err);
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`WhatsApp bot running on port ${PORT}`));

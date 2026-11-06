const express = require("express");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "30kb" }));

const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "OPENROUTER_API_KEY"];
const missing = required.filter(k => !process.env[k]);
let supabase;
if (!missing.length) {
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

const sha = value => crypto.createHash("sha256").update(value).digest("hex");
const randomHex = bytes => crypto.randomBytes(bytes).toString("hex");
const clean = (s, max = 100) => String(s || "").trim().slice(0, max);
const modes = ["AUTO", "SMOOTH", "EGO", "SHENG", "ROMANTIC", "BRAG", "MYSTERY", "SAVAGE", "NATURAL"];

app.use((req, res, next) => {
  const origin = process.env.APP_ORIGIN;
  if (origin && req.headers.origin && req.headers.origin !== origin) {
    return res.status(403).json({ error: "Origin not allowed." });
  }
  res.setHeader("Vary", "Origin");
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  }
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, configured: !missing.length, missing });
});

function ready(res) {
  if (missing.length) {
    res.status(503).json({ error: "Server is not configured. Add the required environment variables." });
    return false;
  }
  return true;
}

async function getSession(req, res) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token || token.length < 40) {
    res.status(401).json({ error: "Your session has expired. Recover your conversation." });
    return null;
  }
  const tokenHash = sha(token);
  const { data, error } = await supabase.from("conversations")
    .select("id,session_name,display_name,target_gender,preferences,history,created_at,updated_at,expires_at")
    .eq("token_hash", tokenHash).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (error || !data) {
    res.status(401).json({ error: "Session not found. Recover using your saved credentials." });
    return null;
  }
  return data;
}

app.post("/api/sessions", async (req, res) => {
  if (!ready(res)) return;
  const displayName = clean(req.body.personName, 50);
  const targetGender = req.body.targetGender === "boy" ? "boy" : "girl";
  if (!displayName) return res.status(400).json({ error: "Enter the person's name." });

  const slug = displayName.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) || "FRIEND";
  const sessionName = `KLINS-${slug}-${randomHex(3).toUpperCase()}`;
  const recoveryCode = String(crypto.randomInt(100000, 1000000));
  const recoveryKey = randomHex(16).toUpperCase();
  const token = randomHex(32);
  const [codeHash, keyHash] = await Promise.all([
    bcrypt.hash(recoveryCode, 12), bcrypt.hash(recoveryKey, 12)
  ]);
  const { data, error } = await supabase.from("conversations").insert({
    session_name: sessionName,
    display_name: displayName,
    target_gender: targetGender,
    code_hash: codeHash,
    recovery_hash: keyHash,
    token_hash: sha(token),
    expires_at: expiresAt,
    preferences: { language: "AUTO", mode: "AUTO" },
    history: []
  }).select("id,session_name,display_name,target_gender,preferences,history,created_at").single();

  if (error) {
    console.error("create session:", error.message);
    return res.status(500).json({ error: "Could not create the conversation. Try again." });
  }
  res.status(201).json({
    session: data,
    credentials: { sessionName, recoveryCode, recoveryKey },
    token
  });
});

app.post("/api/sessions/recover", async (req, res) => {
  if (!ready(res)) return;
  const sessionName = clean(req.body.sessionName, 60).toUpperCase();
  const code = clean(req.body.recoveryCode, 6);
  const recoveryKey = clean(req.body.recoveryKey, 64).toUpperCase();
  if (!sessionName || !/^\d{6}$/.test(code) || !/^[A-F0-9]{32}$/.test(recoveryKey)) {
    return res.status(400).json({ error: "Enter your session name, six-digit code and recovery key." });
  }

  const ip = String(req.headers["x-forwarded-for"] || req.ip || "unknown").split(",")[0].trim();
  const rateKey = sha(`${ip}|${sessionName}`);
  const { data: allowed, error: rateError } = await supabase.rpc("consume_recovery_attempt", {
    p_key: rateKey, p_window_seconds: 900, p_max_attempts: 5
  });
  if (rateError) {
    console.error("recovery rate limit:", rateError.message);
    return res.status(503).json({ error: "Recovery is temporarily unavailable. Try again later." });
  }
  if (!allowed) return res.status(429).json({ error: "Too many recovery attempts. Try again in 15 minutes." });

  const { data, error } = await supabase.from("conversations")
    .select("id,session_name,display_name,target_gender,code_hash,recovery_hash,preferences,history,created_at,updated_at")
    .eq("session_name", sessionName).maybeSingle();
  if (error || !data) return res.status(401).json({ error: "Those recovery details did not match." });

  const [codeOk, keyOk] = await Promise.all([
    bcrypt.compare(code, data.code_hash),
    bcrypt.compare(recoveryKey, data.recovery_hash)
  ]);
  if (!codeOk || !keyOk) return res.status(401).json({ error: "Those recovery details did not match." });

  const token = randomHex(32);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const { error: updateError } = await supabase.from("conversations")
    .update({ token_hash: sha(token), expires_at: expiresAt, updated_at: new Date().toISOString() })
    .eq("id", data.id);
  if (updateError) return res.status(500).json({ error: "Could not restore this conversation." });

  delete data.code_hash;
  delete data.recovery_hash;
  res.json({ session: data, token });
});

app.get("/api/sessions/current", async (req, res) => {
  if (!ready(res)) return;
  const session = await getSession(req, res);
  if (session) res.json({ session });
});

app.post("/api/chat", async (req, res) => {
  if (!ready(res)) return;
  const session = await getSession(req, res);
  if (!session) return;

  const incoming = clean(req.body.message, 1200);
  const mode = modes.includes(req.body.mode) ? req.body.mode : "AUTO";
  if (!incoming) return res.status(400).json({ error: "Paste their message first." });

  const history = Array.isArray(session.history) ? session.history.slice(-38) : [];
  const conversationText = [...history, { role: "them", content: incoming }]
    .map(m => `${m.role === "assistant" ? "Suggested reply" : "Their message"}: ${clean(m.content, 1200)}`)
    .join("\n");

  const system = `You are KLINSMD 4 PRO IV, a Kenyan texting and flirting assistant.
Your job: write ONE short, natural, ready-to-send reply to the latest message from the person the user is flirting with.
Understand Kenyan Kiswahili, Kenyan English, Sheng, code-switching and contemporary Kenyan texting. Reply in the language mix they naturally use. Understand playful Luo-influenced English confidence and bragging without stereotyping Luo people.
PERSONALITY: confident, calm, playful, emotionally intelligent, respectful, self-respecting. Never desperate or clingy. No begging, threats, slurs, humiliation, excessive compliments or manipulative pressure. Respect boundaries and a clear no.
NO SIMPING: never beg for attention, repeatedly ask why they are ignoring the user, overuse pet names, or sound emotionally dependent.
MODES:
AUTO = choose best fit from context.
SMOOTH = charming, naturally romantic.
EGO = witty and confident only when there is genuine disrespect or a put-down; distinguish mutual teasing from real disrespect.
SHENG = authentic Kenyan Sheng.
ROMANTIC = sweet, measured and not desperate.
BRAG = playful humorous confidence.
MYSTERY = intriguing but not manipulative.
SAVAGE = sharp and intelligent, never cruel.
NATURAL = everyday conversation.
Selected mode: ${mode}.
Person being flirted with: ${session.display_name} (${session.target_gender}).
Return exactly ONE reply, normally 3–20 words. No quotation marks, labels, explanations, bullets, or alternatives.
Then include a second line beginning exactly with META: followed by compact JSON with keys language, mode, ego, interest, tone, conversation. language should be Kiswahili, English, Sheng, Mixed or Unknown. mode should be one of AUTO, SMOOTH, EGO, SHENG, ROMANTIC, BRAG, MYSTERY, SAVAGE, NATURAL. ego is true only if genuine disrespect/provocation merits a confident boundary or comeback. interest must be cautious: Possible, Unclear, Low, or Positive. tone is Playful, Flirty, Serious, Dry, Warm or Unknown. conversation is Flowing, Drying, or Needs a topic change. Do not claim certainty about another person's feelings.`;

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.APP_ORIGIN || "https://klinsmd.vercel.app",
        "X-Title": "KLINSMD 4 PRO IV"
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || "openrouter/free",
        messages: [
          { role: "system", content: system },
          { role: "user", content: `Conversation context:\n${conversationText}\n\nWrite a reply to the latest message.` }
        ],
        temperature: 0.85,
        max_tokens: 180
      })
    });
    const payload = await response.json();
    if (!response.ok) {
      console.error("OpenRouter:", payload);
      return res.status(502).json({ error: "The AI is busy or the selected free model is unavailable. Try again shortly." });
    }
    const raw = payload.choices?.[0]?.message?.content?.trim() || "";
    const parts = raw.split(/\nMETA:\s*/i);
    const reply = clean(parts[0], 280);
    let meta = { language: "Unknown", mode, ego: false, interest: "Unclear", tone: "Unknown", conversation: "Flowing" };
    if (parts[1]) {
      try { meta = { ...meta, ...JSON.parse(parts[1]) }; } catch (_) {}
    }
    if (!reply) return res.status(502).json({ error: "The AI returned an empty reply. Try again." });

    const updatedHistory = [...history,
      { role: "them", content: incoming, at: new Date().toISOString() },
      { role: "assistant", content: reply, at: new Date().toISOString(), meta }
    ].slice(-40);

    const preferences = {
      ...(session.preferences || {}),
      language: clean(meta.language, 20),
      mode: clean(meta.mode, 20),
      lastMeta: meta
    };
    const { error: saveError } = await supabase.from("conversations")
      .update({ history: updatedHistory, preferences, updated_at: new Date().toISOString() })
      .eq("id", session.id);
    if (saveError) {
      console.error("save conversation:", saveError.message);
      return res.status(500).json({ error: "Reply generated, but saving failed. Please retry." });
    }
    res.json({ reply, meta, history: updatedHistory });
  } catch (err) {
    console.error("chat error:", err);
    res.status(500).json({ error: "Could not reach the AI service. Check your connection and retry." });
  }
});

app.patch("/api/sessions/preferences", async (req, res) => {
  if (!ready(res)) return;
  const session = await getSession(req, res);
  if (!session) return;
  const mode = modes.includes(req.body.mode) ? req.body.mode : "AUTO";
  const preferences = { ...(session.preferences || {}), mode };
  const { error } = await supabase.from("conversations")
    .update({ preferences, updated_at: new Date().toISOString() }).eq("id", session.id);
  if (error) return res.status(500).json({ error: "Could not save your settings." });
  res.json({ preferences });
});

app.delete("/api/sessions/current", async (req, res) => {
  if (!ready(res)) return;
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Not authorised." });
  const { error } = await supabase.from("conversations").delete().eq("token_hash", sha(token));
  if (error) return res.status(500).json({ error: "Could not delete the conversation." });
  res.json({ ok: true });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Unexpected server error." });
});

module.exports = app;

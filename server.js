const nodemailer = require("nodemailer");
require("dotenv").config();
const express = require("express");
const { VoiceResponse } = require("twilio").twiml;
const twilio = require("twilio");

const app = express();
app.use(express.urlencoded({ extended: false }));

// --- Simple health route for browser ---
app.get("/", (req, res) => {
  res.send("AI Receptionist backend is running ✅");
});

// --- Email transporter (Gmail) ---
// Currently not used on Render due to SMTP timeout issues,
// but kept here in case you want to enable it locally.
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER, // e.g. tauseeq.design@gmail.com
    pass: process.env.GMAIL_PASS // 16-char app password
  }
});

// --- Twilio client (for WhatsApp + Voice if needed) ---
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Temporary storage for call data (per process)
let callData = {};

// WhatsApp notify helper (for leads from calls AND chats)
async function notifyOnWhatsApp(text) {
  try {
    const msg = await twilioClient.messages.create({
      from: process.env.TWILIO_WHATSAPP_FROM, // e.g. whatsapp:+14155238886
      to: process.env.TWILIO_WHATSAPP_TO,     // e.g. whatsapp:+923001234567
      body: text
    });
    console.log("WhatsApp sent:", msg.sid);
  } catch (err) {
    console.error("WhatsApp error:", err);
  }
}

/* =========================================================
   VOICE FLOW
   ========================================================= */

app.post("/voice", (req, res) => {
  const twiml = new VoiceResponse();

  twiml
    .gather({
      input: "speech",
      action: "/collect-name",
      method: "POST",
      speechTimeout: "auto",
      hints:
        "Tauseeq, Haider, Ali, Ahmad, Ahmed, Hamza, Ayesha, Aisha, Fatima, Usman, Lahore Smile Dental Clinic"
    })
    .say(
      "Assalam o Alaikum. You have reached Lahore Smile Dental Clinic. Please say your full name slowly."
    );

  res.type("text/xml");
  res.send(twiml.toString());
});

app.post("/collect-name", (req, res) => {
  callData.name = req.body.SpeechResult;

  const twiml = new VoiceResponse();
  twiml
    .gather({
      input: "speech",
      action: "/collect-service",
      method: "POST",
      speechTimeout: "auto",
      hints:
        "cleaning, filling, checkup, root canal, braces, scaling, Lahore"
    })
    .say(
      "Thank you. What dental service do you need? For example, cleaning, filling, or checkup?"
    );

  res.type("text/xml");
  res.send(twiml.toString());
});

app.post("/collect-service", (req, res) => {
  callData.service = req.body.SpeechResult;

  const twiml = new VoiceResponse();
  twiml
    .gather({
      input: "speech",
      action: "/collect-time",
      method: "POST",
      speechTimeout: "auto"
    })
    .say("Great. What day and time would you prefer for your appointment?");

  res.type("text/xml");
  res.send(twiml.toString());
});

app.post("/collect-time", (req, res) => {
  callData.appointmentTime = req.body.SpeechResult;

  const twiml = new VoiceResponse();
  twiml
    .gather({
      input: "speech",
      action: "/collect-phone",
      method: "POST",
      speechTimeout: "auto"
    })
    .say(
      "Thank you. Finally, please say your phone number slowly so we can confirm your booking."
    );

  res.type("text/xml");
  res.send(twiml.toString());
});

app.post("/collect-phone", async (req, res) => {
  try {
    const callerNumber = req.body.From || "Unknown number";
    const callerName = callData.name || "Unknown name";
    const serviceNeeded = callData.service || "Not provided";
    const appointmentTime = callData.appointmentTime || "Not provided";
    const phoneSpoken = req.body.SpeechResult || "Not provided";

    callData.phone = phoneSpoken;

    const leadInfo = `
New Lead from AI Receptionist (CALL)

Name: ${callerName}
Phone (from Twilio): ${callerNumber}
Phone (spoken): ${phoneSpoken}
Service Needed: ${serviceNeeded}
Preferred Appointment Time: ${appointmentTime}
    `;

    console.log("New Lead (Call):", leadInfo);
    console.log("Skipping email on Render (SMTP timeout issue).");

    // Send WhatsApp notification only
    await notifyOnWhatsApp(leadInfo);

    const twiml = new VoiceResponse();
    twiml.say(
      "Thank you. Your details have been saved. Our team will contact you shortly to confirm your appointment. Khuda Hafiz."
    );
    twiml.hangup();

    res.type("text/xml");
    res.send(twiml.toString());
  } catch (error) {
    console.error("Call flow error:", error);

    const twiml = new VoiceResponse();
    twiml.say(
      "Sorry, there was a problem sending your details. Please try again later."
    );
    twiml.hangup();

    res.type("text/xml");
    res.send(twiml.toString());
  }
});

/* =========================================================
   WHATSAPP CHAT FLOW
   ========================================================= */

// Very simple in-memory session store per WhatsApp number
// {
//   "whatsapp:+92...": { stage: "asked_name" | "asked_service" | "asked_time" | "completed", ... }
// }
const chatSessions = {};

// Helper to send WhatsApp message (chat reply) from your Twilio WhatsApp number
async function sendWhatsAppChat(to, body, from) {
  try {
    const msg = await twilioClient.messages.create({
      from, // Twilio WhatsApp number, e.g. whatsapp:+14155238886
      to,   // patient number, e.g. whatsapp:+92300...
      body
    });
    console.log("WhatsApp chat sent:", msg.sid);
  } catch (err) {
    console.error("WhatsApp chat error:", err);
  }
}

// Webhook Twilio calls when a WhatsApp message comes in
app.post("/whatsapp/webhook", async (req, res) => {
  // Raw log so you can see exactly what Twilio sends
  console.log("Incoming WhatsApp message RAW body:", req.body);

  const from = req.body.From;          // patient, e.g. whatsapp:+92300...
  const to = req.body.To;              // your Twilio WhatsApp number
  const body = (req.body.Body || "").trim();

  console.log("Incoming WhatsApp message:", from, "->", to, ":", body);

  // Get or init session
  let session = chatSessions[from];
  if (!session) {
    session = { stage: "new" };
    chatSessions[from] = session;
  }

  let reply = "";

  try {
    if (session.stage === "new") {
      // First time message from this number
      reply =
        "Assalam o Alaikum 👋\n" +
        "Thank you for contacting Lahore Smile Dental Clinic.\n\n" +
        "To help you book an appointment, I will ask you a few quick questions.\n\n" +
        "First, what is your full name?";
      session.stage = "asked_name";
    } else if (session.stage === "asked_name") {
      session.name = body;
      reply =
        `Thank you ${session.name}.\n` +
        "What dental treatment would you like? (e.g. teeth cleaning, braces, filling, checkup)";
      session.stage = "asked_service";
    } else if (session.stage === "asked_service") {
      session.service = body;
      reply =
        "Got it.\nWhat day and time would you prefer for your appointment? (e.g. Monday 6:30 PM)";
      session.stage = "asked_time";
    } else if (session.stage === "asked_time") {
      session.appointmentTime = body;

      const summary = `
New Lead from AI Front Desk (WHATSAPP)

Name: ${session.name || "Not provided"}
Service Needed: ${session.service || "Not provided"}
Preferred Appointment Time: ${session.appointmentTime || "Not provided"}
WhatsApp: ${from.replace("whatsapp:", "")}
      `;

      // Send summary to you / clinic owner via WhatsApp
      await notifyOnWhatsApp(summary);

      reply =
        "Thank you. Your details have been sent to the clinic team.\n" +
        "We will contact you shortly to confirm your appointment.\n\n" +
        "If you want to add anything else, you can reply here.";

      session.stage = "completed";
    } else {
      // After completion
      reply =
        "We already have your booking details. If you want to change something, please tell us what you would like to update 🙏";
    }

    // Send reply to patient
    await sendWhatsAppChat(from, reply, to);

    // Twilio just needs 200 OK
    res.status(200).send("OK");
  } catch (err) {
    console.error("Error in WhatsApp webhook:", err);
    res.status(500).send("Error");
  }
});

// --- IMPORTANT: use Render port ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

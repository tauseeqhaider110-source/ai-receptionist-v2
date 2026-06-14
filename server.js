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
    console.log("WhatsApp sent (owner):", msg.sid);
  } catch (err) {
    console.error("WhatsApp error (owner):", err);
  }
}

/* =========================================================
   VOICE FLOW
   ========================================================= */

app.post("/voice", (req, res) => {
  try {
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
  } catch (err) {
    console.error("Error in /voice:", err);
    const twiml = new VoiceResponse();
    twiml.say(
      "Sorry, there was a problem. Please try again later."
    );
    twiml.hangup();
    res.type("text/xml");
    res.send(twiml.toString());
  }
});

app.post("/collect-name", (req, res) => {
  try {
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
  } catch (err) {
    console.error("Error in /collect-name:", err);
    const twiml = new VoiceResponse();
    twiml.say(
      "Sorry, there was a problem. Please try again later."
    );
    twiml.hangup();
    res.type("text/xml");
    res.send(twiml.toString());
  }
});

app.post("/collect-service", (req, res) => {
  try {
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
  } catch (err) {
    console.error("Error in /collect-service:", err);
    const twiml = new VoiceResponse();
    twiml.say(
      "Sorry, there was a problem. Please try again later."
    );
    twiml.hangup();
    res.type("text/xml");
    res.send(twiml.toString());
  }
});

app.post("/collect-time", (req, res) => {
  try {
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
  } catch (err) {
    console.error("Error in /collect-time:", err);
    const twiml = new VoiceResponse();
    twiml.say(
      "Sorry, there was a problem. Please try again later."
    );
    twiml.hangup();
    res.type("text/xml");
    res.send(twiml.toString());
  }
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
    console.error("Call flow error in /collect-phone:", error);

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
// { "whatsapp:+92...": { stage, name, service, appointmentTime } }
const chatSessions = {};

// Helper to send WhatsApp message (chat reply) from your Twilio WhatsApp number
async function sendWhatsAppChat(to, body, from) {
  try {
    const msg = await twilioClient.messages.create({
      from, // Twilio WhatsApp number, e.g. whatsapp:+14155238886
      to,   // patient number, e.g. whatsapp:+92300...
      body
    });
    console.log("WhatsApp chat sent (patient):", msg.sid);
  } catch (err) {
    console.error("WhatsApp chat error (patient):", err);
    throw err;
  }
}

// Webhook Twilio calls when a WhatsApp message comes in
app.post("/whatsapp/webhook", async (req, res) => {
  console.log("=== WhatsApp WEBHOOK HIT ===");
  console.log("Raw body:", JSON.stringify(req.body, null, 2));

  try {
    const from = req.body.From;          // patient, e.g. whatsapp:+92300...
    const to = req.body.To;              // your Twilio WhatsApp number
    const body = (req.body.Body || "").trim();

    console.log("Parsed WhatsApp message:", { from, to, body });

    // Get or init session
    let session = chatSessions[from];
    if (!session) {
      session = { stage: "new" };
      chatSessions[from] = session;
    }

    let reply = "";

    if (session.stage === "new") {
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

      console.log("Lead summary to owner (WhatsApp):", summary);

      // Send summary to you / clinic owner via WhatsApp
      try {
        await notifyOnWhatsApp(summary);
        console.log("Owner WhatsApp notification sent successfully");
      } catch (notifyErr) {
        console.error("Error sending owner WhatsApp notification:", notifyErr);
      }

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

    console.log("Replying to patient:", { to: from, from: to, reply });

    // Send reply to patient
    try {
      await sendWhatsAppChat(from, reply, to);
      console.log("Patient WhatsApp reply sent successfully");
    } catch (sendErr) {
      console.error("Error sending patient WhatsApp reply:", sendErr);
    }

    // Always respond to Twilio
    res.status(200).send("OK");
  } catch (err) {
    console.error("FATAL ERROR in WhatsApp webhook:", err);
    // Still respond to Twilio to avoid timeouts
    res.status(200).send("OK");
  }
});

// --- IMPORTANT: use Render port ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
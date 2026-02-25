const nodemailer = require("nodemailer");
require("dotenv").config();
const express = require("express");
const { VoiceResponse } = require("twilio").twiml;
const OpenAI = require("openai");
const twilio = require("twilio");

const app = express();
app.use(express.urlencoded({ extended: false }));

// Email transporter (Gmail)
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "tauseeq.design@gmail.com",          // your Gmail (sender)
    pass: "lwsk bezq skkv zzsa"                // your 16-char app password
  }
});

// Twilio client for WhatsApp
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Temporary storage for call data
let callData = {};

// WhatsApp notify helper
async function notifyOnWhatsApp(text) {
  try {
    const msg = await twilioClient.messages.create({
      from: process.env.TWILIO_WHATSAPP_FROM,  // e.g. whatsapp:+14155238886
      to: process.env.TWILIO_WHATSAPP_TO,      // e.g. whatsapp:+923001234567
      body: text
    });
    console.log("WhatsApp sent:", msg.sid);
  } catch (err) {
    console.error("WhatsApp error:", err);
  }
}

app.post("/voice", (req, res) => {
  const twiml = new VoiceResponse();

  twiml
    .gather({
      input: "speech",
      action: "/collect-name",
      method: "POST",
      speechTimeout: "auto",
      // Name hints: your name, common Pakistani names, clinic
      hints: "Tauseeq, Haider, Ali, Ahmad, Ahmed, Hamza, Ayesha, Aisha, Fatima, Usman, Lahore Smile Dental Clinic"
    })
    .say("Assalam o Alaikum. You have reached Lahore Smile Dental Clinic. Please say your full name slowly.");

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
      // Service hints to help recognition
      hints: "cleaning, filling, checkup, root canal, braces, scaling, Lahore"
    })
    .say("Thank you. What dental service do you need? For example, cleaning, filling, or checkup?");

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
    .say("Thank you. Finally, please say your phone number slowly so we can confirm your booking.");

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

    // Save phone from speech
    callData.phone = phoneSpoken;

    const leadInfo = `
New Lead from AI Receptionist

Name: ${callerName}
Phone (from Twilio): ${callerNumber}
Phone (spoken): ${phoneSpoken}
Service Needed: ${serviceNeeded}
Preferred Appointment Time: ${appointmentTime}
    `;

    // Send email
    const mailOptions = {
      from: '"AI Receptionist" <tauseeq.design@gmail.com>',
      to: "tauseeqhaider110@gmail.com", // where you receive leads
      subject: "New Dental Clinic Lead",
      text: leadInfo
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("New Lead:", leadInfo);
    console.log("Email sent successfully:", info.messageId);

    // Send WhatsApp notification
    await notifyOnWhatsApp(leadInfo);

    const twiml = new VoiceResponse();
    twiml.say("Thank you. Your details have been saved. Our team will contact you shortly to confirm your appointment. Khuda Hafiz.");
    twiml.hangup();

    res.type("text/xml");
    res.send(twiml.toString());
  } catch (error) {
    console.error("Email or WhatsApp error:", error);

    const twiml = new VoiceResponse();
    twiml.say("Sorry, there was a problem sending your details. Please try again later.");
    twiml.hangup();

    res.type("text/xml");
    res.send(twiml.toString());
  }
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});

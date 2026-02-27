// Webhook Twilio calls when a WhatsApp message comes in
app.post("/whatsapp/webhook", async (req, res) => {
  console.log("Incoming WhatsApp message RAW body:", req.body); // <‑ added log

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

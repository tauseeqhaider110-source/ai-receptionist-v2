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

      console.log("Lead summary to owner:", summary);

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
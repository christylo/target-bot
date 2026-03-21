import nodemailer from "nodemailer";

import type { AppConfig } from "../config.js";
import type { AlertMessage, Notifier } from "../core/types.js";

class ConsoleNotifier implements Notifier {
  name = "console";

  async notify(message: AlertMessage): Promise<void> {
    console.log("");
    console.log("=== ALERT ===");
    console.log(message.subject);
    console.log(message.body);
    console.log("=============");
    console.log("");
  }
}

class DiscordNotifier implements Notifier {
  name = "discord";

  constructor(private readonly webhookUrl: string) {}

  async notify(message: AlertMessage): Promise<void> {
    const response = await fetch(this.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: `**${message.subject}**\n${message.body}`
      })
    });

    if (!response.ok) {
      throw new Error(`Discord webhook failed with ${response.status} ${response.statusText}`);
    }
  }
}

class EmailNotifier implements Notifier {
  name = "email";
  private readonly transporter;

  constructor(private readonly config: NonNullable<AppConfig["smtp"]>) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.pass
      }
    });
  }

  async notify(message: AlertMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.config.from,
      to: this.config.to,
      subject: message.subject,
      text: message.body
    });
  }
}

export function createNotifiers(config: AppConfig): Notifier[] {
  const notifiers: Notifier[] = [new ConsoleNotifier()];

  if (config.discordWebhookUrl) {
    notifiers.push(new DiscordNotifier(config.discordWebhookUrl));
  }

  if (config.smtp) {
    notifiers.push(new EmailNotifier(config.smtp));
  }

  return notifiers;
}

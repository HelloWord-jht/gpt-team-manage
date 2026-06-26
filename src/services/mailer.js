import nodemailer from "nodemailer";

export class SmtpMailer {
  constructor(env = process.env) {
    this.env = env;
    this.transport = null;
  }

  isConfigured() {
    return Boolean(this.env.SMTP_USER && this.env.SMTP_PASS);
  }

  async sendRenewalReminder(message) {
    if (!this.isConfigured()) {
      const error = new Error("SMTP 未配置，请设置 SMTP_USER 和 SMTP_PASS");
      error.statusCode = 400;
      throw error;
    }

    const transport = this.getTransport();
    await transport.sendMail({
      from: this.env.SMTP_FROM || this.env.SMTP_USER,
      to: message.to || this.env.REMINDER_TO || this.env.SMTP_USER,
      subject: message.subject,
      text: message.text,
    });
  }

  getTransport() {
    if (!this.transport) {
      const port = Number(this.env.SMTP_PORT || 465);
      this.transport = nodemailer.createTransport({
        host: this.env.SMTP_HOST || "smtp.qq.com",
        port,
        secure: port === 465,
        auth: {
          user: this.env.SMTP_USER,
          pass: this.env.SMTP_PASS,
        },
      });
    }

    return this.transport;
  }
}

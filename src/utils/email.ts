interface SendEmailParams {
  to: string;
  subject: string;
  htmlContent: string;
  textContent?: string;
}

const senderEmail =
  process.env.BREVO_SENDER_EMAIL || "noreply@tallie-test-domain.com";
const senderName = process.env.BREVO_SENDER_NAME || "Tallie Reservations";

import * as Brevo from "@getbrevo/brevo";

export class EmailService {
  private static tx = (() => {
    const api = new Brevo.TransactionalEmailsApi();
    // Configure API key auth
    api.setApiKey(
      Brevo.TransactionalEmailsApiApiKeys.apiKey,
      process.env.BREVO_API_KEY || "",
    );
    return api;
  })();

  static async sendEmail({
    to,
    subject,
    htmlContent,
    textContent,
  }: SendEmailParams): Promise<void> {
    if (!process.env.BREVO_API_KEY) {
      // Fail soft: log and return to avoid crashing flows when not configured
      console.warn("[EMAIL] BREVO_API_KEY missing. Email not sent.");
      return;
    }

    const payload = new Brevo.SendSmtpEmail();
    payload.sender = { email: senderEmail, name: senderName } as any;
    payload.to = [{ email: to } as any];
    payload.subject = subject;
    payload.htmlContent = htmlContent;
    if (textContent) payload.textContent = textContent;

    await EmailService.tx.sendTransacEmail(payload);
  }

  static async sendPasswordResetEmail(
    to: string,
    resetLink: string,
  ): Promise<void> {
    const subject = "Password Reset Instructions";
    const htmlContent = `
      <p>We received a request to reset your password.</p>
      <p>Click the link below to reset it:</p>
      <p><a href="${resetLink}">Reset your password</a></p>
      <p>If you did not request this, you can safely ignore this email.</p>
    `;
    await EmailService.sendEmail({
      to,
      subject,
      htmlContent,
      textContent: `Reset your password: ${resetLink}`,
    });
  }

  static async sendReservationConfirmationEmail(
    to: string,
    details: {
      restaurantName: string;
      customerName: string;
      startISO: string;
      partySize: number;
      tableNumber?: number;
      durationMinutes: number;
    },
  ): Promise<void> {
    const subject = `Your reservation at ${details.restaurantName}`;
    const htmlContent = `
      <h3>Reservation Confirmed</h3>
      <p>Hello ${details.customerName},</p>
      <p>Your reservation is confirmed at <strong>${details.restaurantName}</strong>.</p>
      <ul>
        <li>Date & Time: ${new Date(details.startISO).toLocaleString()}</li>
        <li>Party Size: ${details.partySize}</li>
        <li>Duration: ${details.durationMinutes} minutes</li>
        ${details.tableNumber ? `<li>Table: ${details.tableNumber}</li>` : ""}
      </ul>
      <p>We look forward to hosting you!</p>
    `;
    await EmailService.sendEmail({ to, subject, htmlContent });
  }

  static async sendReservationModificationEmail(
    to: string,
    details: {
      restaurantName: string;
      customerName: string;
      originalStartISO: string;
      newStartISO: string;
      partySize: number;
      durationMinutes: number;
    },
  ): Promise<void> {
    const subject = `Reservation Updated at ${details.restaurantName}`;
    const htmlContent = `
      <h3>Reservation Modified</h3>
      <p>Hello ${details.customerName},</p>
      <p>Your reservation at <strong>${details.restaurantName}</strong> has been updated.</p>
      <h4>Updated Details:</h4>
      <ul>
        <li>New Date & Time: ${new Date(details.newStartISO).toLocaleString()}</li>
        <li>Party Size: ${details.partySize}</li>
        <li>Duration: ${details.durationMinutes} minutes</li>
      </ul>
      <p><em>Original time was: ${new Date(details.originalStartISO).toLocaleString()}</em></p>
      <p>We look forward to hosting you!</p>
    `;
    await EmailService.sendEmail({ to, subject, htmlContent });
  }

  static async sendReservationCancellationEmail(
    to: string,
    details: {
      restaurantName: string;
      customerName: string;
      startISO: string;
      partySize: number;
    },
  ): Promise<void> {
    const subject = `Reservation Cancelled at ${details.restaurantName}`;
    const htmlContent = `
      <h3>Reservation Cancelled</h3>
      <p>Hello ${details.customerName},</p>
      <p>Your reservation at <strong>${details.restaurantName}</strong> has been cancelled.</p>
      <h4>Cancelled Reservation Details:</h4>
      <ul>
        <li>Date & Time: ${new Date(details.startISO).toLocaleString()}</li>
        <li>Party Size: ${details.partySize}</li>
      </ul>
      <p>We hope to see you again soon!</p>
      <p>If this cancellation was not expected, please contact us immediately.</p>
    `;
    await EmailService.sendEmail({ to, subject, htmlContent });
  }

  static async sendWaitlistNotificationEmail(
    to: string,
    details: {
      restaurantName: string;
      customerName: string;
      tableAvailable: boolean;
      tableNumber?: number;
      expiresIn?: string;
    },
  ): Promise<void> {
    const subject = details.tableAvailable
      ? `Table Available at ${details.restaurantName}!`
      : `Waitlist Update from ${details.restaurantName}`;

    let htmlContent: string;

    if (details.tableAvailable) {
      htmlContent = `
        <h3>Great News - A Table is Available!</h3>
        <p>Hello ${details.customerName},</p>
        <p>A table has become available at <strong>${details.restaurantName}</strong>!</p>
        ${details.tableNumber ? `<p>Table ${details.tableNumber} is ready for you.</p>` : ""}
        ${details.expiresIn ? `<p><strong>Please confirm within ${details.expiresIn}</strong> to secure your spot.</p>` : ""}
        <p>Reply to this email or call us to confirm your reservation.</p>
        <p>We look forward to hosting you!</p>
      `;
    } else {
      htmlContent = `
        <h3>Waitlist Update</h3>
        <p>Hello ${details.customerName},</p>
        <p>This is an update regarding your waitlist entry at <strong>${details.restaurantName}</strong>.</p>
        <p>We are still working to find a table for you and will notify you as soon as one becomes available.</p>
        <p>Thank you for your patience!</p>
      `;
    }

    await EmailService.sendEmail({ to, subject, htmlContent });
  }

  static async sendWaitlistConfirmationEmail(
    to: string,
    details: {
      restaurantName: string;
      customerName: string;
      preferredDate: string;
      preferredTime: string;
      partySize: number;
      position: number;
    },
  ): Promise<void> {
    const subject = `Waitlist Confirmation at ${details.restaurantName}`;
    const htmlContent = `
      <h3>You're on the Waitlist!</h3>
      <p>Hello ${details.customerName},</p>
      <p>You have been added to the waitlist at <strong>${details.restaurantName}</strong>.</p>
      <h4>Waitlist Details:</h4>
      <ul>
        <li>Preferred Date: ${details.preferredDate}</li>
        <li>Preferred Time: ${details.preferredTime}</li>
        <li>Party Size: ${details.partySize}</li>
        <li>Your Position: #${details.position}</li>
      </ul>
      <p>We will notify you as soon as a table becomes available!</p>
    `;
    await EmailService.sendEmail({ to, subject, htmlContent });
  }
}

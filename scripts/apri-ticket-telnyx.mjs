#!/usr/bin/env node

/**
 * Apre/aggiorna un ticket di supporto Telnyx per l'ordine del numero italiano.
 * Uso: npm run ticket-telnyx
 */

import nodemailer from 'nodemailer';
import { config } from '../lib/config.js';

const mail = config.mail;
if (!mail.host || !mail.user || !mail.pass) {
  console.error('Errore: SMTP non configurato in .env');
  process.exit(1);
}

const to = 'support@telnyx.com';
const subject =
  '[Support ticket] Italian local number stuck in regulatory review - +390698237118';

const text = `Hello Telnyx Support / Number Operations,

We would like to open a support ticket and request a status update / escalation for an Italian local number order that has been in "requirement-info-under-review" since 2026-11-09 with no feedback or decline reason.

ACCOUNT
  Email: tatianalori@mtitaliaretail.com
  Company: MT ITALIA SRLS

ORDER DETAILS
  Number order ID: 1bb70f5d-c9a2-45d9-a99a-5eb771c2046a
  Sub number order ID: 1980ed7b-4b55-4a2d-ab95-d05b49644017
  Phone number: +390698237118 (Italy / Rome / local / voice)
  Requirement group ID: a3e80b38-127e-40e6-b0bd-6519fde3d102 (IT / local / ordering)
  Order created: 2026-11-09T12:18:44Z
  Current status: order "pending", requirements_met=false, requirement-info-under-review

WHAT WE ALREADY DID
  - All 17 regulatory requirements were filled with values on 2026-11-09.
  - We uploaded 3 supporting documents: Italian Chamber of Commerce certificate
    (visura), government identity card, and a recent Sorgenia utility bill as
    proof of address.
  - We understand Italy does not support requirement-group pre-approval, so the
    group remains "unapproved" and we expect the standard review on the order.
  - A comment with the same request has been posted on the sub number order via
    the Telnyx Comments API (comment ID 264aecb1-8110-495b-b474-f4841cea9a50).

REQUEST
  1. Please confirm whether any document or field is missing, invalid, or needs
     resubmission (no decline reason or comment has been posted so far).
  2. Please provide an estimated completion time or escalate the case for review.

This number is intended for an inbound customer-support IVR, so activation is
time-sensitive. Please reply to this address (assistenza@mtitaliaretail.com) or
post a comment on the order.

Thank you,
MT ITALIA SRLS
`;

const transporter = nodemailer.createTransport({
  host: mail.host,
  port: mail.port,
  secure: mail.secure,
  auth: { user: mail.user, pass: mail.pass },
  tls: { minVersion: 'TLSv1.2' },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 10000
});

const info = await transporter.sendMail({
  from: mail.from || mail.user,
  to,
  subject,
  text,
  replyTo: 'assistenza@mtitaliaretail.com'
});

console.log('Ticket inviato a:', to);
console.log('Message-ID:', info.messageId);
console.log('Risposta SMTP:', info.response);

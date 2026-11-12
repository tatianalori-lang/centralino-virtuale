import nodemailer from 'nodemailer';
import { config } from '../lib/config.js';

const mail = config.mail;
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
  to: 'support@telnyx.com',
  replyTo: 'assistenza@mtitaliaretail.com',
  subject: '[Follow-up] CAP 00179 added - please approve Italian number +390698237118',
  text: `Hello Telnyx Support / Number Operations,

Follow-up on our open ticket for order 1bb70f5d-c9a2-45d9-a99a-5eb771c2046a
(sub number order 1980ed7b-4b55-4a2d-ab95-d05b49644017, number +390698237118).

The Italian postal code (CAP) 00179 has now been added explicitly to EVERY
address-related field on the Telnyx account:

  Registered business address (id 3090775836417066414)
    Via Marco Tabarrini 13, 00179 Roma (RM), Italy
    street_address / extended_address / postal_code / locality / administrative_area / country

  Legal representative residence (id 3090775840611370416)
    Via Genzano 63, 00179 Roma (RM), Italy
    same fields, CAP 00179

Requirement group a3e80b38-127e-40e6-b0bd-6519fde3d102 (IT / local / ordering)
is now 17/17 fulfilled, both address-type requirements point to the updated
addresses, and the group has been re-applied to the sub number order. All 17
requirements show status "pending-approval"; the order is still
"requirement-info-under-review".

Company data for cross-check:
  MT ITALIA SRLS
  P.IVA / VAT: 15588261006 / IT15588261006
  Codice Fiscale: LROTTN76D63H501L
  Documents: visura camerale, carta d'identita, bolletta Sorgenia (proof of address)

Please confirm whether anything else is missing, approve the requirements and
activate the number, or provide an estimated timeline. This is blocking our
customer-support phone line.

Thank you,
MT ITALIA SRLS`
});

console.log('Sollecito inviato:', info.messageId, '|', info.response);

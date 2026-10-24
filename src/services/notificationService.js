const { Notification, User } = require('../models');
const { sendEmail } = require('./emailService');

async function createNotification({
  organization,
  user,
  type,
  title,
  body,
  link,
  meta,
  sendMail = true,
  emailSubject,
  emailHtml,
}) {
  let emailAttempted = false;
  let emailSent = false;
  let emailSkippedReason;

  if (sendMail) {
    try {
      const userDoc =
        typeof user === 'object' && user.email
          ? user
          : await User.findById(user).select('email fullName notificationPrefs').lean();

      const allowEmail = userDoc?.notificationPrefs?.email !== false;
      if (!userDoc?.email) {
        emailSkippedReason = 'User has no email';
      } else if (!allowEmail) {
        emailSkippedReason = 'User disabled email notifications';
      } else {
        const result = await sendEmail({
          organizationId: organization,
          to: userDoc.email,
          subject: emailSubject || title,
          text: body,
          html: emailHtml,
        });
        emailAttempted = result.attempted;
        emailSent = result.sent;
        emailSkippedReason = result.reason;
      }
    } catch (err) {
      emailAttempted = true;
      emailSent = false;
      emailSkippedReason = err.message || 'Email failed';
    }
  } else {
    emailSkippedReason = 'Email not requested for this notification';
  }

  return Notification.create({
    organization,
    user: user._id || user,
    type,
    title,
    body,
    link,
    meta,
    emailAttempted,
    emailSent,
    emailSkippedReason,
  });
}

async function notifyUsers(users, payload) {
  const docs = [];
  for (const u of users) {
    docs.push(
      await createNotification({
        ...payload,
        user: u._id || u,
      })
    );
  }
  return docs;
}

module.exports = { createNotification, notifyUsers };

/**
 * Static product help — always indexed so the bot can explain how the app works.
 */
function buildHelpDocs(appName = 'Has Tracker') {
  return [
    {
      sourceId: 'nav-admin',
      audience: 'admin',
      title: 'Admin navigation',
      content: `${appName} admin portal sections: Dashboard (overview stats), Properties (PG buildings), Rooms & Beds (floor/room/bed inventory), Registrations (applications and assign room/bed), Tenants (active residents), Rent & Payments (rent records and payments), Maintenance (tickets), Staff (team members), Announcements (notices emailed to tenants), Reports (occupancy and finance summaries), Settings (organization, defaults, SMTP email, chatbot AI).`,
      keywords: ['admin', 'menu', 'navigation', 'dashboard', 'where', 'find'],
    },
    {
      sourceId: 'nav-tenant',
      audience: 'tenant',
      title: 'Tenant app navigation',
      content: `${appName} tenant app tabs: Home, My Room (assignment details), Payments (mark rent paid and upload screenshot), Tickets (raise maintenance requests), Notices (announcements), Profile. Use the bottom navigation to switch sections.`,
      keywords: ['tenant', 'app', 'menu', 'navigation', 'home', 'room'],
    },
    {
      sourceId: 'registrations',
      audience: 'admin',
      title: 'How registrations work',
      content: `There is one shared registration form for all properties. Applicants pick a property from a dropdown on the public form. Submissions auto-create a tenant account (no approve/reject). Admins open Registrations and use Assign room & bed to place the tenant. Edit the form under Settings ? Defaults ? Edit registration form, or Registrations ? Edit.`,
      keywords: ['registration', 'apply', 'form', 'assign', 'bed', 'approve'],
    },
    {
      sourceId: 'payments',
      audience: 'all',
      title: 'How rent payments work',
      content: `Tenants mark a rent payment as paid from the Payments tab and may upload a payment screenshot. There is no admin payment approval/verify step. Admins track rent status under Rent & Payments. Default rent due day and currency are configured in Settings ? Defaults.`,
      keywords: ['rent', 'payment', 'paid', 'screenshot', 'due', 'mark'],
    },
    {
      sourceId: 'rooms-beds',
      audience: 'admin',
      title: 'Rooms and beds',
      content: `Rooms & Beds shows rooms by floor. Each room card lists up to 4 beds; extra beds open in a sidebar (+N more). Add beds from the room details. Delete a bed to soft-remove it; remaining beds renumber automatically. Occupied beds show the tenant name.`,
      keywords: ['room', 'bed', 'floor', 'delete', 'add', 'occupancy'],
    },
    {
      sourceId: 'tickets',
      audience: 'all',
      title: 'Maintenance tickets',
      content: `Tenants create maintenance tickets from Tickets ? New, choosing a category (plumbing, electrical, cleaning, etc.). Staff manage tickets under Maintenance in the admin portal. Ticket categories are customized in Settings ? Defaults.`,
      keywords: ['ticket', 'maintenance', 'repair', 'plumbing', 'complaint'],
    },
    {
      sourceId: 'announcements-email',
      audience: 'admin',
      title: 'Announcements and email',
      content: `Publishing an announcement notifies tenants in-app and emails them when SMTP is enabled. Configure Email / SMTP in Settings: host (e.g. smtp.gmail.com), port 587, user email, Gmail app password, from name, then enable email and send a test. App name in Organization appears in email branding.`,
      keywords: ['announcement', 'email', 'smtp', 'gmail', 'app password', 'notify'],
    },
    {
      sourceId: 'settings',
      audience: 'admin',
      title: 'Settings overview',
      content: `Settings tabs: Organization (name, app name, contact), Defaults (rent due day, currency, timezone, ticket categories, registration form link), Email / SMTP (mail for announcements), AI Chatbot (enable assistant, API key for smarter answers), Account (your login).`,
      keywords: ['settings', 'smtp', 'currency', 'app name', 'chatbot', 'ai'],
    },
    {
      sourceId: 'login',
      audience: 'all',
      title: 'Login and roles',
      content: `Staff (org admin, property manager, etc.) sign in and land on the admin portal. Tenants sign in and land on the tenant app. Use the login page with email and password. After registration assignment, tenants can log in with the credentials created at registration.`,
      keywords: ['login', 'password', 'role', 'admin', 'tenant', 'sign in'],
    },
    {
      sourceId: 'chatbot',
      audience: 'all',
      title: 'AI assistant',
      content: `The ${appName} assistant answers questions about this PG platform using live data (properties, rooms, announcements, policies, how-to guides). Knowledge reindexes automatically so answers stay current. Admins can force a reindex from Settings ? AI Chatbot.`,
      keywords: ['chatbot', 'assistant', 'ai', 'help', 'rag', 'ask'],
    },
  ];
}

module.exports = { buildHelpDocs };

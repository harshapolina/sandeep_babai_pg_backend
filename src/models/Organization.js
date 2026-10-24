const mongoose = require('mongoose');

const organizationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    legalName: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    address: { type: String, trim: true },
    city: { type: String, default: 'Hyderabad' },
    state: { type: String, default: 'Telangana' },
    country: { type: String, default: 'India' },
    logoUrl: String,
    settings: {
      appName: { type: String, default: 'Has Tracker' },
      defaultRentDueDay: { type: Number, default: 5 },
      currency: { type: String, default: 'INR' },
      timezone: { type: String, default: 'Asia/Kolkata' },
      autoApproveRegistrations: { type: Boolean, default: true },
      ticketCategories: {
        type: [String],
        default: [
          'Plumbing',
          'Electrical',
          'Cleaning',
          'Furniture',
          'Internet',
          'Water supply',
          'Other',
        ],
      },
      /** Per-bed monthly rent by sharing type (1/2/3/4+ sharing) */
      sharingPrices: {
        single: { type: Number, default: 15000, min: 0 },
        double: { type: Number, default: 12000, min: 0 },
        triple: { type: Number, default: 10000, min: 0 },
        quad: { type: Number, default: 8000, min: 0 },
        dorm: { type: Number, default: 6000, min: 0 },
        other: { type: Number, default: 9000, min: 0 },
      },
      mail: {
        enabled: { type: Boolean, default: false },
        host: { type: String, default: '' },
        port: { type: Number, default: 587 },
        secure: { type: Boolean, default: false },
        user: { type: String, default: '' },
        /** SMTP / Gmail app password */
        pass: { type: String, default: '', select: false },
        fromName: { type: String, default: '' },
        fromEmail: { type: String, default: '' },
      },
      chatbot: {
        enabled: { type: Boolean, default: true },
        provider: {
          type: String,
          enum: ['auto', 'gemini', 'openai', 'local'],
          default: 'auto',
        },
        /** Optional LLM API key for richer answers (Gemini / OpenAI) */
        apiKey: { type: String, default: '', select: false },
        model: { type: String, default: '' },
        hasApiKey: { type: Boolean, default: false },
      },
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Organization', organizationSchema);

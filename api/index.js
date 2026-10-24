const { connectDB } = require('../src/config/db');
const app = require('../src/index');

let ready;
async function ensureReady() {
  if (!ready) ready = connectDB();
  await ready;
}

module.exports = async (req, res) => {
  try {
    await ensureReady();
    return app(req, res);
  } catch (err) {
    console.error('API bootstrap failed:', err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: false, message: err.message || 'Server error' }));
  }
};

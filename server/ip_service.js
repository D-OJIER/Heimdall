const os = require('os');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());

app.get('/api/ip', (req, res) => {
  const nets = os.networkInterfaces();
  let ip = 'localhost';
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      // Skip non-ipv4 and internal (i.e. 127.0.0.1) addresses
      if (net.family === 'IPv4' && !net.internal) {
        ip = net.address;
        // prefer the first non-internal IPv4 we find
        return res.json({ ip });
      }
    }
  }
  res.json({ ip });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => console.log(`IP service running on port ${PORT}`));

module.exports = app;

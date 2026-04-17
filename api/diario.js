// API route para ler o arquivo diario.json
// Em produção na Vercel, este arquivo é read-only
const fs = require('fs');
const path = require('path');

module.exports = (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const filePath = path.join(process.cwd(), 'diario.json');

  if (req.method === 'GET') {
    try {
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        // Return empty data structure if file doesn't exist
        return res.status(200).json({});
      }
      
      const data = fs.readFileSync(filePath, 'utf8');
      const jsonData = JSON.parse(data);
      res.status(200).json(jsonData);
    } catch (error) {
      console.error('Error reading diario.json:', error);
      res.status(500).json({ error: 'Failed to read data' });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
};

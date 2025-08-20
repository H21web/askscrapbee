const fetch = require('node-fetch');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { q: query } = req.query;
  if (!query) {
    return res.status(400).json({ error: 'Missing query parameter "q"' });
  }

  try {
    // Use Bing search API instead
    const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&form=QBRE`;
    
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    
    // Simple extraction - look for answer snippets
    const answerMatch = html.match(/<div[^>]*class="[^"]*b_ans[^"]*"[^>]*>(.*?)<\/div>/s);
    
    if (answerMatch) {
      let answer = answerMatch[1]
        .replace(/<[^>]*>/g, '') // Remove HTML tags
        .replace(/\s+/g, ' ')     // Normalize spaces
        .trim();
      
      if (answer.length > 20) {
        return res.status(200).json({
          success: true,
          response: answer,
          query: query,
          source: 'bing-search',
          timestamp: new Date().toISOString()
        });
      }
    }

    return res.status(404).json({
      error: 'No answer found',
      query: query
    });

  } catch (error) {
    return res.status(500).json({
      error: 'Search failed',
      details: error.message,
      query: query
    });
  }
};

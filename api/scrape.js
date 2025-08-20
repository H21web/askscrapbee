const fetch = require('node-fetch');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { query } = req.query;
  if (!query) {
    return res.status(400).json({ error: 'Query parameter missing' });
  }

  try {
    // Use DuckDuckGo's instant answer API (free, no auth needed)
    const ddgResponse = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`);
    
    if (ddgResponse.ok) {
      const data = await ddgResponse.json();
      
      // Try different fields for the answer
      let answer = '';
      if (data.Abstract && data.Abstract.length > 20) {
        answer = data.Abstract;
      } else if (data.Definition && data.Definition.length > 20) {
        answer = data.Definition;
      } else if (data.RelatedTopics && data.RelatedTopics[0] && data.RelatedTopics[0].Text) {
        answer = data.RelatedTopics.Text;
      }

      if (answer) {
        return res.status(200).json({
          success: true,
          text: answer.trim(),
          query: query,
          source: 'duckduckgo-api',
          timestamp: new Date().toISOString()
        });
      }
    }

    // Fallback: Use Wikipedia API for factual questions
    const wikiResponse = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`);
    
    if (wikiResponse.ok) {
      const wikiData = await wikiResponse.json();
      if (wikiData.extract && wikiData.extract.length > 20) {
        return res.status(200).json({
          success: true,
          text: wikiData.extract,
          query: query,
          source: 'wikipedia-api'
        });
      }
    }

    return res.status(404).json({
      error: 'No answer found',
      message: 'Unable to find a relevant answer for your question',
      query: query
    });

  } catch (error) {
    return res.status(500).json({
      error: 'Service unavailable',
      details: error.message,
      query: query
    });
  }
};

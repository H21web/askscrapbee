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
    // Use iask.ai's actual API endpoint (the one their website uses)
    const response = await fetch('https://iask.ai/api/v1/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Origin': 'https://iask.ai',
        'Referer': 'https://iask.ai/'
      },
      body: JSON.stringify({
        query: query,
        options: {
          detail_level: 'concise'
        }
      })
    });

    if (response.ok) {
      const data = await response.json();
      
      // Extract the answer text
      let answerText = '';
      if (data.answer) {
        answerText = data.answer;
      } else if (data.response) {
        answerText = data.response;
      } else if (data.result) {
        answerText = data.result;
      } else if (data.text) {
        answerText = data.text;
      }

      if (answerText && answerText.length > 20) {
        // Clean the text - remove footnotes, links, etc.
        let cleanText = answerText
          .replace(/\[\d+\]/g, '')           // Remove [1], [2], etc.
          .replace(/\[.*?\]/g, '')           // Remove any other brackets
          .replace(/https?:\/\/[^\s]+/g, '') // Remove URLs
          .replace(/\s+/g, ' ')              // Normalize whitespace
          .trim();

        return res.status(200).json({
          success: true,
          text: cleanText,
          query: query,
          source: 'iask-internal-api',
          timestamp: new Date().toISOString()
        });
      }
    }

    // Fallback: Try alternative API endpoint
    const altResponse = await fetch(`https://iask.ai/search?format=json&q=${encodeURIComponent(query)}`, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; APIBot/1.0)'
      }
    });

    if (altResponse.ok) {
      const altData = await altResponse.json();
      if (altData && altData.answer) {
        return res.status(200).json({
          success: true,
          text: altData.answer.replace(/\[\d+\]/g, '').trim(),
          query: query,
          source: 'iask-alt-api'
        });
      }
    }

    // Last resort: Try to mimic the AJAX request their frontend makes
    const ajaxResponse = await fetch('https://iask.ai/ajax/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: `q=${encodeURIComponent(query)}&detail_level=concise`
    });

    if (ajaxResponse.ok) {
      const ajaxData = await ajaxResponse.json();
      if (ajaxData && (ajaxData.answer || ajaxData.response)) {
        const text = ajaxData.answer || ajaxData.response;
        return res.status(200).json({
          success: true,
          text: text.replace(/\[\d+\]/g, '').trim(),
          query: query,
          source: 'iask-ajax'
        });
      }
    }

    // If all API attempts fail
    return res.status(404).json({
      error: 'No answer found',
      message: 'Unable to get answer from iask.ai APIs',
      query: query
    });

  } catch (error) {
    return res.status(500).json({
      error: 'Request failed',
      details: error.message,
      query: query
    });
  }
};

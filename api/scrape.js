const fetch = require('node-fetch');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { query } = req.query;
  
  if (!query) {
    return res.status(400).json({ 
      error: 'Query parameter missing',
      usage: 'GET /api/scrape?query=your_question'
    });
  }

  try {
    // Direct approach - try to get the answer via iask.ai's API if it exists
    const apiUrl = `https://iask.ai/api/search?q=${encodeURIComponent(query)}`;
    
    try {
      const apiResponse = await fetch(apiUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Referer': 'https://iask.ai/',
        }
      });
      
      if (apiResponse.ok) {
        const data = await apiResponse.json();
        if (data && (data.answer || data.response || data.text)) {
          return res.status(200).json({
            success: true,
            text: data.answer || data.response || data.text,
            query: query,
            source: 'iask-api',
            timestamp: new Date().toISOString()
          });
        }
      }
    } catch (e) {
      console.log('API approach failed, trying page scraping');
    }

    // Fallback: scrape the page HTML
    const pageUrl = `https://iask.ai/q?mode=question&options[detail_level]=concise&q=${encodeURIComponent(query)}`;
    
    const response = await fetch(pageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    const dom = new JSDOM(html);
    const document = dom.window.document;

    // Try multiple selectors to find content
    const selectors = [
      '#output',
      '.answer-content',
      '[data-testid="answer"]',
      '.response-text',
      'main .content',
      'article'
    ];

    let result = null;
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent.trim().length > 50) {
        result = element.textContent.trim();
        break;
      }
    }

    // If no content found, try to extract from script tags (JSON data)
    if (!result) {
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        const content = script.textContent;
        if (content.includes('answer') || content.includes('response')) {
          try {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const data = JSON.parse(jsonMatch[0]);
              if (data.answer || data.response || data.text) {
                result = data.answer || data.response || data.text;
                break;
              }
            }
          } catch (e) {
            continue;
          }
        }
      }
    }

    if (result && result.length > 20) {
      // Clean up the text
      result = result.replace(/\s+/g, ' ').trim();
      result = result.replace(/^(Answer:|Response:|Result:)\s*/i, '');

      return res.status(200).json({
        success: true,
        text: result,
        query: query,
        url: pageUrl,
        timestamp: new Date().toISOString(),
        source: 'html-scraping',
        textLength: result.length
      });
    } else {
      return res.status(404).json({
        error: 'No content found',
        message: 'Could not extract answer from the page',
        query: query,
        htmlLength: html.length,
        debug: {
          foundOutput: html.includes('id="output"'),
          foundAnswer: html.includes('answer'),
          foundResponse: html.includes('response')
        }
      });
    }

  } catch (error) {
    return res.status(500).json({
      error: 'Scraping failed',
      details: error.message,
      query: query,
      timestamp: new Date().toISOString()
    });
  }
};

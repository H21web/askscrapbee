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
    return res.status(400).json({ error: 'Query parameter missing' });
  }

  try {
    console.log(`Processing query: ${query}`);

    // Method 1: Try direct API endpoints (fastest)
    const apiEndpoints = [
      `https://iask.ai/api/search?q=${encodeURIComponent(query)}&detail_level=concise`,
      `https://iask.ai/api/v1/search?query=${encodeURIComponent(query)}`,
      `https://iask.ai/search.json?q=${encodeURIComponent(query)}`
    ];

    for (const apiUrl of apiEndpoints) {
      try {
        console.log(`Trying API: ${apiUrl}`);
        const apiResponse = await fetch(apiUrl, {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://iask.ai/'
          },
          timeout: 5000
        });

        if (apiResponse.ok) {
          const data = await apiResponse.json();
          if (data && (data.answer || data.response || data.text || data.result)) {
            const text = data.answer || data.response || data.text || data.result;
            if (text && text.length > 50 && !text.includes('Answer Provided by Ask ai')) {
              return res.status(200).json({
                success: true,
                text: cleanText(text),
                query: query,
                source: 'direct-api',
                timestamp: new Date().toISOString()
              });
            }
          }
        }
      } catch (e) {
        console.log(`API ${apiUrl} failed: ${e.message}`);
        continue;
      }
    }

    // Method 2: Multiple page requests with delay (handles lazy loading)
    const pageUrl = `https://iask.ai/q?mode=question&options[detail_level]=concise&q=${encodeURIComponent(query)}`;
    
    // Try immediate fetch
    let html = await fetchPageWithRetry(pageUrl, 1);
    let content = extractFirstParagraph(html);

    // If content not loaded, try with delays
    if (!content || content.includes('Answer Provided by Ask ai')) {
      console.log('Content not loaded, trying with delays...');
      
      // Wait 2 seconds and try again
      await new Promise(resolve => setTimeout(resolve, 2000));
      html = await fetchPageWithRetry(pageUrl, 2);
      content = extractFirstParagraph(html);
      
      // If still not loaded, wait 3 more seconds
      if (!content || content.includes('Answer Provided by Ask ai')) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        html = await fetchPageWithRetry(pageUrl, 3);
        content = extractFirstParagraph(html);
      }
    }

    // Method 3: Extract from script tags (embedded JSON data)
    if (!content || content.includes('Answer Provided by Ask ai')) {
      console.log('Trying to extract from script tags...');
      content = extractFromScripts(html);
    }

    if (content && content.length > 20 && !content.includes('Answer Provided by Ask ai')) {
      return res.status(200).json({
        success: true,
        text: cleanText(content),
        query: query,
        url: pageUrl,
        source: 'html-scraping-delayed',
        timestamp: new Date().toISOString(),
        textLength: content.length
      });
    }

    // If all methods fail
    return res.status(404).json({
      error: 'Content not available',
      message: 'The page content is still loading or not available. This may be due to heavy traffic on iask.ai.',
      query: query,
      suggestion: 'Try again in a few seconds',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Scraping error:', error.message);
    return res.status(500).json({
      error: 'Scraping failed',
      details: error.message,
      query: query,
      timestamp: new Date().toISOString()
    });
  }
};

// Helper function: Fetch page with retry logic
async function fetchPageWithRetry(url, attempt) {
  console.log(`Fetching page (attempt ${attempt}): ${url}`);
  
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return await response.text();
}

// Helper function: Extract first paragraph from HTML
function extractFirstParagraph(html) {
  try {
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    
    // Try multiple selectors
    const selectors = [
      'div#output p:first-child',
      'div#output p',
      '#output p',
      '.answer-content p',
      'main p',
      'article p'
    ];

    for (const selector of selectors) {
      const p = doc.querySelector(selector);
      if (p && p.textContent.trim().length > 20) {
        // Remove links and footnotes
        Array.from(p.querySelectorAll('a, sup, sub')).forEach(el => el.remove());
        let text = p.textContent || '';
        
        // Skip if it's just a loading message
        if (!text.includes('Answer Provided by Ask ai') && !text.includes('Loading...')) {
          return text;
        }
      }
    }
  } catch (e) {
    console.log('Error extracting paragraph:', e.message);
  }
  return null;
}

// Helper function: Extract from script tags
function extractFromScripts(html) {
  try {
    const dom = new JSDOM(html);
    const scripts = dom.window.document.querySelectorAll('script');
    
    for (const script of scripts) {
      const content = script.textContent;
      
      // Look for JSON data containing answers
      if (content.includes('answer') || content.includes('response')) {
        try {
          // Try to find JSON objects
          const jsonMatches = content.match(/\{[^{}]*"(?:answer|response|text)"[^{}]*\}/g);
          
          if (jsonMatches) {
            for (const jsonStr of jsonMatches) {
              try {
                const data = JSON.parse(jsonStr);
                if (data.answer || data.response || data.text) {
                  const text = data.answer || data.response || data.text;
                  if (text.length > 50 && !text.includes('Answer Provided by Ask ai')) {
                    return text;
                  }
                }
              } catch (e) {
                continue;
              }
            }
          }
        } catch (e) {
          continue;
        }
      }
    }
  } catch (e) {
    console.log('Error extracting from scripts:', e.message);
  }
  return null;
}

// Helper function: Clean text
function cleanText(text) {
  if (!text) return '';
  
  // Remove footnotes like [1], [1][2], etc.
  text = text.replace(/\[\d+(?:\]\[\d+)*\]/g, '');
  
  // Remove any other bracketed content
  text = text.replace(/\[.*?\]/g, '');
  
  // Remove URLs
  text = text.replace(/https?:\/\/[^\s]+/g, '');
  
  // Remove extra whitespace
  text = text.replace(/\s+/g, ' ').trim();
  
  // Remove common prefixes
  text = text.replace(/^(Answer:|Response:|Result:)\s*/i, '');
  
  return text;
}

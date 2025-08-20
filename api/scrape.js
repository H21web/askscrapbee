const fetch = require('node-fetch');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

module.exports = async (req, res) => {
  // CORS headers
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

  const url = `https://iask.ai/q?mode=question&options[detail_level]=concise&q=${encodeURIComponent(query)}`;
  
  // Simple polling: Check every 3 seconds, max 5 attempts (15 seconds total)
  for (let attempt = 1; attempt <= 5; attempt++) {
    console.log(`Attempt ${attempt}: Checking for content...`);
    
    // Wait before each attempt (except first)
    if (attempt > 1) {
      await sleep(3000); // 3 seconds
    }
    
    try {
      // Fetch the page
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      if (!response.ok) continue;
      
      const html = await response.text();
      const content = getOutputText(html);
      
      // If we found content with 30+ characters, return it
      if (content && content.length >= 30) {
        return res.status(200).json({
          success: true,
          text: content,
          query: query,
          attempt: attempt,
          timestamp: new Date().toISOString()
        });
      }
      
    } catch (error) {
      console.log(`Attempt ${attempt} failed:`, error.message);
    }
  }
  
  // No content found after all attempts
  return res.status(404).json({
    error: 'No content found',
    message: 'Could not find content in #output div after 15 seconds',
    query: query
  });
};

// Simple function to extract text from #output div
function getOutputText(html) {
  try {
    const dom = new JSDOM(html);
    const outputDiv = dom.window.document.querySelector('#output');
    
    if (!outputDiv) {
      console.log('No #output div found');
      return null;
    }
    
    // Get all text from the output div
    let text = outputDiv.textContent || '';
    
    // Simple cleaning
    text = text
      .replace(/Email this answer|Share Answer|Add Email|Provided by iAsk\.ai|Ask AI/gi, '') // Remove UI text
      .replace(/Thinking\.\.\.|Loading\.\.\.|Please wait/gi, '') // Remove loading text
      .replace(/\[\d+\]/g, '') // Remove [1], [1], etc.
      .replace(/\s+/g, ' ') // Multiple spaces to single space
      .trim(); // Remove leading/trailing spaces
    
    // Check if it's real content (not just loading messages)
    if (text.length < 30) return null;
    if (text.toLowerCase().includes('thinking')) return null;
    if (text.toLowerCase().includes('loading')) return null;
    
    console.log(`Found content: ${text.length} characters`);
    return text;
    
  } catch (error) {
    console.log('Error extracting text:', error.message);
    return null;
  }
}

// Simple sleep function
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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
    const pageUrl = `https://iask.ai/q?mode=question&options[detail_level]=concise&q=${encodeURIComponent(query)}`;

    // Smart polling: Keep checking until real content appears
    const maxAttempts = 15; // Maximum 15 attempts (about 45 seconds)
    const checkInterval = 3000; // Check every 3 seconds
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      console.log(`Attempt ${attempt}/${maxAttempts}: Checking for content...`);
      
      // Wait before each attempt (except first)
      if (attempt > 1) {
        await new Promise(resolve => setTimeout(resolve, checkInterval));
      }
      
      // Fetch the page
      const response = await fetch(pageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });

      if (!response.ok) {
        console.log(`HTTP ${response.status} on attempt ${attempt}`);
        continue;
      }

      const html = await response.text();
      const content = extractRealContent(html);
      
      if (content.isRealContent) {
        console.log(`✅ Real content found on attempt ${attempt}!`);
        return res.status(200).json({
          success: true,
          text: content.text,
          query: query,
          url: pageUrl,
          source: 'iask-ai-smart-wait',
          attempt: attempt,
          waitTime: (attempt - 1) * checkInterval,
          timestamp: new Date().toISOString(),
          textLength: content.text.length
        });
      } else {
        console.log(`⏳ Still ${content.status} on attempt ${attempt}...`);
      }
    }

    // If we reach here, content never loaded
    return res.status(408).json({
      error: 'Content load timeout',
      message: 'iask.ai is taking longer than expected to generate an answer. This might be due to high traffic or a complex question.',
      query: query,
      attempts: maxAttempts,
      totalWaitTime: (maxAttempts - 1) * checkInterval,
      suggestion: 'Try again with a simpler question or wait a few minutes'
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

// Smart content extraction function
function extractRealContent(html) {
  try {
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    
    // Look for the output div
    const outputDiv = doc.querySelector('div#output');
    if (!outputDiv) {
      return { isRealContent: false, status: 'no-output-div', text: null };
    }

    // Get all text content from output div
    const allText = outputDiv.textContent || '';
    
    // Check for loading/thinking states (skip these)
    const loadingIndicators = [
      'Thinking...',
      'Loading...',
      'Please wait',
      'Answer Provided by Ask ai',
      'Generating answer',
      'Processing',
      'Working on it'
    ];
    
    const isLoading = loadingIndicators.some(indicator => 
      allText.toLowerCase().includes(indicator.toLowerCase())
    );
    
    if (isLoading) {
      const foundIndicator = loadingIndicators.find(indicator => 
        allText.toLowerCase().includes(indicator.toLowerCase())
      );
      return { isRealContent: false, status: `loading (${foundIndicator})`, text: null };
    }
    
    // Look for actual content in paragraphs
    const paragraphs = outputDiv.querySelectorAll('p');
    
    for (const p of paragraphs) {
      if (p && p.textContent) {
        let text = p.textContent.trim();
        
        // Must be substantial content (more than 50 characters)
        if (text.length < 50) continue;
        
        // Skip if it contains loading indicators
        const hasLoadingText = loadingIndicators.some(indicator => 
          text.toLowerCase().includes(indicator.toLowerCase())
        );
        if (hasLoadingText) continue;
        
        // This looks like real content - clean it up
        const clonedP = p.cloneNode(true);
        
        // Remove links, footnotes, and other elements
        Array.from(clonedP.querySelectorAll('a, sup, sub, cite')).forEach(el => el.remove());
        
        text = clonedP.textContent || '';
        
        // Clean up the text
        text = text.replace(/\[\d+(?:\]\[\d+)*\]/g, ''); // Remove [1], [1][2], etc.
        text = text.replace(/\[.*?\]/g, '');              // Remove any other brackets
        text = text.replace(/https?:\/\/[^\s]+/g, '');    // Remove URLs
        text = text.replace(/\s+/g, ' ').trim();          // Normalize whitespace
        text = text.replace(/^(Answer:|Response:|Result:)\s*/i, ''); // Remove prefixes
        
        if (text.length > 30) {
          return { isRealContent: true, status: 'content-found', text: text };
        }
      }
    }
    
    // If no paragraphs found, check if output div has any substantial text
    if (allText.length > 50 && !isLoading) {
      // Clean the text from the entire div
      let cleanText = allText
        .replace(/\[\d+(?:\]\[\d+)*\]/g, '')
        .replace(/\[.*?\]/g, '')
        .replace(/https?:\/\/[^\s]+/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      
      if (cleanText.length > 30) {
        return { isRealContent: true, status: 'div-content-found', text: cleanText };
      }
    }
    
    return { isRealContent: false, status: 'no-substantial-content', text: null };
    
  } catch (error) {
    console.error('Content extraction error:', error.message);
    return { isRealContent: false, status: 'extraction-error', text: null };
  }
}

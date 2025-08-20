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

    // Reduced attempts for faster response - max 20 seconds
    const maxAttempts = 7;  // Reduced from 15
    const checkInterval = 3000; // 3 seconds
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      console.log(`Attempt ${attempt}/${maxAttempts}: Looking for first paragraph...`);
      
      if (attempt > 1) {
        await new Promise(resolve => setTimeout(resolve, checkInterval));
      }
      
      const response = await fetch(pageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html',
          'Cache-Control': 'no-cache'
        }
      });

      if (!response.ok) continue;

      const html = await response.text();
      const firstParagraph = extractFirstParagraphOnly(html);
      
      if (firstParagraph) {
        console.log(`✅ First paragraph found on attempt ${attempt}!`);
        return res.status(200).json({
          success: true,
          text: firstParagraph,
          query: query,
          url: pageUrl,
          attempt: attempt,
          waitTime: (attempt - 1) * checkInterval,
          timestamp: new Date().toISOString(),
          textLength: firstParagraph.length
        });
      }
      
      console.log(`⏳ No content paragraph yet (attempt ${attempt})...`);
    }

    // Quick timeout - don't wait too long
    return res.status(408).json({
      error: 'Quick timeout',
      message: 'First paragraph is taking longer than expected to load (20 seconds). Try a simpler question or check back later.',
      query: query,
      maxWaitTime: (maxAttempts - 1) * checkInterval,
      suggestion: 'Try rephrasing your question to be more specific'
    });

  } catch (error) {
    return res.status(500).json({
      error: 'Request failed',
      details: error.message,
      query: query
    });
  }
};

// Fast first paragraph extraction - stops as soon as found
function extractFirstParagraphOnly(html) {
  try {
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    
    // Look for output div
    const outputDiv = doc.querySelector('div#output');
    if (!outputDiv) return null;

    // Quick check: Find first substantial paragraph only
    const paragraphSelectors = [
      'div#output > p:first-of-type',          // First direct paragraph
      'div#output p:first-child',              // First child paragraph  
      'div#output > div:first-child > p:first-of-type', // First nested paragraph
      'div#output p'                           // Any paragraph (take first valid one)
    ];

    for (const selector of paragraphSelectors) {
      const paragraph = doc.querySelector(selector);
      
      if (paragraph) {
        // Clone to avoid modifying original
        const clone = paragraph.cloneNode(true);
        
        // Remove unwanted elements quickly
        clone.querySelectorAll('a, sup, sub, button, span[class*="spinner"]').forEach(el => el.remove());
        
        let text = clone.textContent || '';
        
        // Quick clean
        text = quickCleanText(text);
        
        // Fast validation - is this actual content?
        if (isFirstParagraphValid(text)) {
          return text;
        }
      }
    }

    return null;
    
  } catch (error) {
    console.error('Fast extraction error:', error.message);
    return null;
  }
}

// Quick text cleaning - minimal processing for speed
function quickCleanText(text) {
  if (!text) return '';
  
  // Remove only essential unwanted content
  text = text.replace(/Email this answer/gi, '');
  text = text.replace(/Share Answer/gi, '');
  text = text.replace(/Provided by iAsk\.ai/gi, '');
  text = text.replace(/Ask AI\.?/gi, '');
  text = text.replace(/\[\d+\]/g, '');              // Remove [1], [2]
  text = text.replace(/\s+/g, ' ').trim();          // Normalize spaces
  
  return text;
}

// Fast validation - check if this looks like a real answer paragraph
function isFirstParagraphValid(text) {
  // Must be substantial
  if (!text || text.length < 40) return false;
  
  // Quick reject patterns
  const rejectPatterns = [
    /thinking/i, /loading/i, /please wait/i,
    /answer provided by/i, /email/i, /share/i,
    /spinner/i, /animation/i, /\.css/i
  ];
  
  // If contains reject patterns, skip
  if (rejectPatterns.some(pattern => pattern.test(text))) return false;
  
  // Quick positive check - should have normal words
  const hasNormalWords = /\b(is|are|the|and|or|but|can|will|may|this|that)\b/i.test(text);
  
  return hasNormalWords && text.length >= 40 && text.length <= 1000; // Reasonable length
}

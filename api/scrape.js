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

    // Smart polling - return immediately when first paragraph >= 30 chars
    const maxAttempts = 10;  
    const quickInterval = 2000; // Check every 2 seconds
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      console.log(`Attempt ${attempt}: Quick check for first paragraph...`);
      
      // Small delay between attempts (except first)
      if (attempt > 1) {
        await new Promise(resolve => setTimeout(resolve, quickInterval));
      }
      
      try {
        // Fast fetch with shorter timeout
        const response = await Promise.race([
          fetch(pageUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Accept': 'text/html',
              'Cache-Control': 'no-cache'
            }
          }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Fetch timeout')), 5000)
          )
        ]);

        if (!response.ok) {
          console.log(`HTTP ${response.status} on attempt ${attempt}`);
          continue;
        }

        const html = await response.text();
        
        // SMART: Check for first paragraph immediately
        const firstParagraph = getFirstValidParagraph(html);
        
        if (firstParagraph && firstParagraph.length >= 30) {
          console.log(`🚀 INSTANT SUCCESS: Found ${firstParagraph.length} chars on attempt ${attempt}!`);
          
          return res.status(200).json({
            success: true,
            text: firstParagraph,
            query: query,
            url: pageUrl,
            attempt: attempt,
            totalTime: (attempt - 1) * quickInterval,
            timestamp: new Date().toISOString(),
            textLength: firstParagraph.length,
            note: "Returned as soon as 30+ characters found"
          });
        } else if (firstParagraph) {
          console.log(`📏 Found ${firstParagraph.length} chars (< 30), continuing...`);
        } else {
          console.log(`❌ No valid paragraph yet on attempt ${attempt}`);
        }
        
      } catch (fetchError) {
        console.log(`Fetch error on attempt ${attempt}: ${fetchError.message}`);
        continue;
      }
    }

    // Only timeout if truly no content found
    return res.status(404).json({
      error: 'Content not found',
      message: 'Could not find a paragraph with 30+ characters after checking for 20 seconds',
      query: query,
      attempts: maxAttempts,
      suggestion: 'Try a different question or check if iask.ai is accessible'
    });

  } catch (error) {
    return res.status(500).json({
      error: 'Service error',
      details: error.message,
      query: query
    });
  }
};

// FAST paragraph extraction - returns immediately when valid content found
function getFirstValidParagraph(html) {
  try {
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    
    // Quick check: Is there an output div?
    const outputDiv = doc.querySelector('div#output');
    if (!outputDiv) {
      console.log('No output div found');
      return null;
    }

    // PRIORITY ORDER: Check most likely selectors first
    const prioritySelectors = [
      'div#output > p',                    // Direct paragraphs
      'div#output > div > p',              // One level nested
      'div#output p',                      // Any paragraph in output
      'div#output > div:first-child p'    // First div's paragraphs
    ];

    for (const selector of prioritySelectors) {
      const paragraphs = doc.querySelectorAll(selector);
      
      for (const paragraph of paragraphs) {
        if (!paragraph) continue;
        
        // Quick clone and clean
        const clone = paragraph.cloneNode(true);
        
        // Remove obvious UI elements quickly
        clone.querySelectorAll('a, sup, sub, button, .spinner, [class*="share"], [class*="email"]').forEach(el => el.remove());
        
        let text = clone.textContent || '';
        
        // INSTANT clean (minimal processing)
        text = instantClean(text);
        
        // RETURN IMMEDIATELY if valid paragraph found
        if (isInstantValid(text)) {
          console.log(`✅ Valid paragraph found: "${text.substring(0, 50)}..."`);
          return text;
        }
      }
    }

    console.log('No valid paragraphs in output div');
    return null;
    
  } catch (error) {
    console.error('Extraction error:', error.message);
    return null;
  }
}

// INSTANT text cleaning - only essential cleaning for speed
function instantClean(text) {
  if (!text) return '';
  
  // Remove only the most obvious UI text
  text = text.replace(/Email this answer|Share Answer|Add Email|Provided by iAsk\.ai|Ask AI/gi, '');
  
  // Remove footnotes
  text = text.replace(/\[\d+\]/g, '');
  
  // Clean whitespace
  text = text.replace(/\s+/g, ' ').trim();
  
  return text;
}

// INSTANT validation - very fast checks
function isInstantValid(text) {
  // Must have minimum length
  if (!text || text.length < 10) return false;
  
  // Quick reject obvious non-content
  if (/^(thinking|loading|please wait|answer provided|email|share)/i.test(text)) {
    return false;
  }
  
  // Quick reject CSS/technical content
  if (/spinner|animation|keyframes|transform|css/i.test(text)) {
    return false;
  }
  
  // Quick positive check - looks like real text
  const hasRealWords = /\b(is|are|was|were|the|and|or|but|can|will|this|that|when|where|how|what|why)\b/i.test(text);
  
  return hasRealWords && text.length >= 10;
}

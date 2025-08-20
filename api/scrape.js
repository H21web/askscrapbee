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

    // Aggressive content detection - multiple strategies
    const maxAttempts = 8;
    const interval = 2500; // 2.5 seconds
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      console.log(`🔍 Attempt ${attempt}/${maxAttempts}: Scanning for content...`);
      
      if (attempt > 1) {
        await new Promise(resolve => setTimeout(resolve, interval));
      }
      
      try {
        const response = await fetch(pageUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache'
          }
        });

        if (!response.ok) {
          console.log(`❌ HTTP ${response.status} on attempt ${attempt}`);
          continue;
        }

        const html = await response.text();
        console.log(`📄 HTML length: ${html.length} characters`);
        
        // Multi-strategy content extraction
        const content = extractWithMultipleStrategies(html);
        
        if (content && content.length >= 30) {
          console.log(`✅ SUCCESS: Found ${content.length} characters on attempt ${attempt}!`);
          console.log(`📝 Content preview: "${content.substring(0, 100)}..."`);
          
          return res.status(200).json({
            success: true,
            text: content,
            query: query,
            url: pageUrl,
            attempt: attempt,
            totalTime: (attempt - 1) * interval,
            timestamp: new Date().toISOString(),
            textLength: content.length
          });
        } else if (content) {
          console.log(`📏 Found ${content.length} chars (need 30+), continuing...`);
        } else {
          console.log(`❌ No content detected on attempt ${attempt}`);
        }
        
      } catch (fetchError) {
        console.log(`🌐 Network error on attempt ${attempt}: ${fetchError.message}`);
        continue;
      }
    }

    return res.status(404).json({
      error: 'Content extraction failed',
      message: 'Unable to extract readable content from iask.ai. This could be due to: 1) The question being too specific/niche, 2) iask.ai experiencing issues, 3) Content being blocked or restricted.',
      query: query,
      attempts: maxAttempts,
      totalTime: (maxAttempts - 1) * interval,
      suggestions: [
        'Try rephrasing the question in simpler terms',
        'Use English keywords if using non-English terms',
        'Check if the topic exists in general knowledge',
        'Try again in a few minutes'
      ]
    });

  } catch (error) {
    return res.status(500).json({
      error: 'Service error',
      details: error.message,
      query: query
    });
  }
};

// MULTI-STRATEGY content extraction
function extractWithMultipleStrategies(html) {
  try {
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    
    console.log('🔍 Trying extraction strategies...');
    
    // Strategy 1: Direct output div content
    let content = tryOutputDivStrategy(doc);
    if (content) {
      console.log('✅ Strategy 1 (output div) succeeded');
      return content;
    }
    
    // Strategy 2: Script tag JSON data
    content = tryScriptDataStrategy(doc);
    if (content) {
      console.log('✅ Strategy 2 (script data) succeeded');
      return content;
    }
    
    // Strategy 3: Meta tags and structured data
    content = tryMetaDataStrategy(doc);
    if (content) {
      console.log('✅ Strategy 3 (meta data) succeeded');
      return content;
    }
    
    // Strategy 4: Broad content search
    content = tryBroadSearchStrategy(doc);
    if (content) {
      console.log('✅ Strategy 4 (broad search) succeeded');
      return content;
    }
    
    console.log('❌ All extraction strategies failed');
    return null;
    
  } catch (error) {
    console.error('🔥 Extraction error:', error.message);
    return null;
  }
}

// Strategy 1: Look for output div content
function tryOutputDivStrategy(doc) {
  const selectors = [
    'div#output',
    '[id="output"]', 
    '.output',
    '[data-testid="output"]',
    '[data-testid="answer"]'
  ];
  
  for (const selector of selectors) {
    const container = doc.querySelector(selector);
    if (container) {
      console.log(`📦 Found container with selector: ${selector}`);
      
      // Look for paragraphs inside
      const paragraphs = container.querySelectorAll('p, div, span');
      for (const p of paragraphs) {
        const text = extractAndCleanText(p);
        if (isValidContent(text)) {
          return text;
        }
      }
      
      // Try the container itself
      const containerText = extractAndCleanText(container);
      if (isValidContent(containerText)) {
        return containerText;
      }
    }
  }
  return null;
}

// Strategy 2: Look for JSON data in script tags
function tryScriptDataStrategy(doc) {
  const scripts = doc.querySelectorAll('script');
  
  for (const script of scripts) {
    const content = script.textContent || '';
    
    // Look for JSON objects with answer data
    const jsonPatterns = [
      /"answer":\s*"([^"]{30,})"/,
      /"response":\s*"([^"]{30,})"/,
      /"text":\s*"([^"]{30,})"/,
      /"content":\s*"([^"]{30,})"/
    ];
    
    for (const pattern of jsonPatterns) {
      const match = content.match(pattern);
      if (match && match[1]) {
        const text = match[1].replace(/\\n/g, ' ').replace(/\\"/g, '"');
        const cleaned = simpleClean(text);
        if (isValidContent(cleaned)) {
          return cleaned;
        }
      }
    }
  }
  return null;
}

// Strategy 3: Look for meta tags and structured data
function tryMetaDataStrategy(doc) {
  const metaSelectors = [
    'meta[property="og:description"]',
    'meta[name="description"]',
    'meta[property="article:description"]'
  ];
  
  for (const selector of metaSelectors) {
    const meta = doc.querySelector(selector);
    if (meta) {
      const content = meta.getAttribute('content');
      if (content) {
        const cleaned = simpleClean(content);
        if (isValidContent(cleaned)) {
          return cleaned;
        }
      }
    }
  }
  return null;
}

// Strategy 4: Broad search for any substantial text
function tryBroadSearchStrategy(doc) {
  // Remove unwanted elements
  const unwanted = doc.querySelectorAll('script, style, nav, header, footer, .nav, .header, .footer');
  unwanted.forEach(el => el.remove());
  
  // Look for substantial text blocks
  const textContainers = doc.querySelectorAll('main, article, .content, .answer, section, div');
  
  for (const container of textContainers) {
    const text = extractAndCleanText(container);
    if (isValidContent(text)) {
      // Take first substantial sentence/paragraph
      const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 20);
      if (sentences.length > 0) {
        return sentences[0].trim() + '.';
      }
      return text;
    }
  }
  return null;
}

// Extract and clean text from element
function extractAndCleanText(element) {
  if (!element) return '';
  
  // Clone to avoid modifying original
  const clone = element.cloneNode(true);
  
  // Remove unwanted elements
  clone.querySelectorAll('script, style, button, a[href], .share, .email, [class*="spinner"], [class*="animation"]').forEach(el => el.remove());
  
  let text = clone.textContent || '';
  return simpleClean(text);
}

// Simple but effective text cleaning
function simpleClean(text) {
  if (!text) return '';
  
  text = text.replace(/Email this answer|Share Answer|Add Email|Provided by iAsk\.ai|Ask AI|Thinking\.\.\.|Loading\.\.\./gi, '');
  text = text.replace(/\[\d+\]/g, ''); // Remove [1], [2], etc.
  text = text.replace(/https?:\/\/[^\s]+/g, ''); // Remove URLs
  text = text.replace(/\s+/g, ' ').trim(); // Normalize whitespace
  
  return text;
}

// Validate if content is substantial and real
function isValidContent(text) {
  if (!text || text.length < 20) return false;
  
  // Reject obvious non-content
  const rejectPatterns = [
    /^(thinking|loading|please wait|error|not found)/i,
    /spinner|animation|keyframes|css/i,
    /email|share|add email/i
  ];
  
  if (rejectPatterns.some(pattern => pattern.test(text))) return false;
  
  // Should have normal language patterns
  const hasNormalWords = /\b(is|are|was|were|the|and|or|but|can|will|may|this|that|when|where|how|what|why|a|an|in|on|at|to|for|of|with|by)\b/i.test(text);
  
  return hasNormalWords && text.length >= 20 && text.length <= 2000;
}

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
      const content = getCleanOutputText(html);
      
      // If we found clean content with 30+ characters, return it
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
    message: 'Could not find clean content in #output div after 15 seconds',
    query: query
  });
};

// Enhanced function to extract CLEAN text from #output div
function getCleanOutputText(html) {
  try {
    const dom = new JSDOM(html);
    const document = dom.window.document;
    const outputDiv = document.querySelector('#output');
    
    if (!outputDiv) {
      console.log('No #output div found');
      return null;
    }
    
    // REMOVE unwanted elements BEFORE extracting text
    const unwantedElements = outputDiv.querySelectorAll(
      'style, script, button, a, .spinner, [class*="spinner"], [class*="share"], [class*="email"], sup, sub'
    );
    unwantedElements.forEach(el => el.remove());
    
    // Look for actual content paragraphs
    const paragraphs = outputDiv.querySelectorAll('p, div');
    let cleanText = '';
    
    for (const p of paragraphs) {
      let text = p.textContent || '';
      
      // Skip if it's clearly UI/CSS content
      if (isUIOrCSS(text)) continue;
      
      // Clean the text
      text = deepClean(text);
      
      // If it's substantial and clean, use it
      if (text.length >= 30 && isRealContent(text)) {
        cleanText = text;
        break; // Take the first good paragraph
      }
    }
    
    // If no good paragraphs, try the whole div but clean it heavily
    if (!cleanText) {
      let fullText = outputDiv.textContent || '';
      fullText = deepClean(fullText);
      
      if (fullText.length >= 30 && isRealContent(fullText)) {
        // Take first substantial sentence
        const sentences = fullText.split(/[.!?]+/).filter(s => s.trim().length > 20);
        if (sentences.length > 0) {
          cleanText = sentences[0].trim() + '.';
        }
      }
    }
    
    console.log(`Clean content found: ${cleanText.length} characters`);
    return cleanText || null;
    
  } catch (error) {
    console.log('Error extracting text:', error.message);
    return null;
  }
}

// Check if text is UI/CSS content
function isUIOrCSS(text) {
  const uiPatterns = [
    /\.(spinner|css|animation)/,
    /@keyframes/,
    /transform:|animation:|cubic-bezier/,
    /translateY|translate\(/,
    /animation-delay|animation-timing/,
    /Add at least one email/,
    /Share Answer/,
    /Email this answer/
  ];
  
  return uiPatterns.some(pattern => pattern.test(text));
}

// Deep cleaning function
function deepClean(text) {
  if (!text) return '';
  
  // Remove CSS and animations
  text = text.replace(/\.[a-zA-Z_][a-zA-Z0-9_]*\{[^}]*\}/g, ''); // CSS classes
  text = text.replace(/@keyframes[^}]*\{[^}]*\}/g, ''); // CSS keyframes
  text = text.replace(/animation[^;]*;/g, ''); // CSS animation properties
  text = text.replace(/transform[^;]*;/g, ''); // CSS transform properties
  text = text.replace(/cubic-bezier\([^)]*\)/g, ''); // CSS timing functions
  text = text.replace(/translateY?\([^)]*\)/g, ''); // CSS translate functions
  
  // Remove UI text
  text = text.replace(/Add at least one email/gi, '');
  text = text.replace(/Email this answer/gi, '');
  text = text.replace(/Share Answer/gi, '');
  text = text.replace(/Provided by iAsk\.ai/gi, '');
  text = text.replace(/Ask AI\.?/gi, '');
  text = text.replace(/spinner_[a-zA-Z0-9]+/gi, '');
  
  // Remove loading states
  text = text.replace(/Thinking\.\.\.|Loading\.\.\.|Please wait/gi, '');
  
  // Remove footnotes and links
  text = text.replace(/\[\d+\]/g, '');
  text = text.replace(/https?:\/\/[^\s]+/g, '');
  
  // Clean whitespace
  text = text.replace(/\s+/g, ' ').trim();
  
  // Remove common prefixes
  text = text.replace(/^(Answer:|Response:|Result:)\s*/i, '');
  
  return text;
}

// Check if text is real content (not UI elements)
function isRealContent(text) {
  if (!text || text.length < 10) return false;
  
  // Reject if contains technical/UI patterns
  const badPatterns = [
    /spinner|animation|keyframe|css|transform/i,
    /email|share|add.*email/i,
    /thinking|loading|please wait/i,
    /^[^a-zA-Z]*$/ // Only special characters
  ];
  
  if (badPatterns.some(pattern => pattern.test(text))) return false;
  
  // Should contain normal words
  const hasWords = /\b(is|are|was|were|the|and|or|but|can|will|this|that|when|where|how|what|a|an|in|on|at|to|for|of|with|by)\b/i.test(text);
  
  return hasWords;
}

// Simple sleep function
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

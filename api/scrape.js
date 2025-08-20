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
  
  // Check every 2.5 seconds, max 6 attempts (15 seconds total)
  for (let attempt = 1; attempt <= 6; attempt++) {
    console.log(`Attempt ${attempt}: Looking for ANY content...`);
    
    if (attempt > 1) {
      await sleep(2500); // 2.5 seconds
    }
    
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html',
          'Cache-Control': 'no-cache'
        }
      });
      
      if (!response.ok) continue;
      
      const html = await response.text();
      const content = findAnyContent(html);
      
      if (content && content.length >= 20) { // Lower threshold
        console.log(`✅ Found content: "${content.substring(0, 50)}..."`);
        
        return res.status(200).json({
          success: true,
          text: content,
          query: query,
          attempt: attempt,
          waitTime: (attempt - 1) * 2500,
          timestamp: new Date().toISOString(),
          textLength: content.length
        });
      }
      
    } catch (error) {
      console.log(`Attempt ${attempt} failed:`, error.message);
    }
  }
  
  return res.status(404).json({
    error: 'No content found',
    message: 'Could not extract any readable content from iask.ai',
    query: query
  });
};

// AGGRESSIVE content finder - finds content even mixed with UI
function findAnyContent(html) {
  try {
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    
    console.log('🔍 Searching for content...');
    
    // Strategy 1: Look for #output div
    let outputDiv = doc.querySelector('#output');
    if (outputDiv) {
      console.log('📦 Found #output div');
      
      // Get raw text and clean it
      let rawText = outputDiv.textContent || '';
      let cleaned = aggressiveClean(rawText);
      
      console.log(`📝 Raw text length: ${rawText.length}`);
      console.log(`🧹 Cleaned text length: ${cleaned.length}`);
      console.log(`📄 First 100 chars: "${cleaned.substring(0, 100)}"`);
      
      if (cleaned.length >= 20) {
        return cleaned;
      }
    }
    
    // Strategy 2: Look for any substantial text blocks
    const textSelectors = [
      'main', 'article', '.content', '.answer', 'section', 
      'div[class*="content"]', 'div[class*="answer"]', 'div[class*="result"]'
    ];
    
    for (const selector of textSelectors) {
      const elements = doc.querySelectorAll(selector);
      for (const el of elements) {
        let text = el.textContent || '';
        let cleaned = aggressiveClean(text);
        
        if (cleaned.length >= 20) {
          console.log(`✅ Found content in ${selector}`);
          return cleaned;
        }
      }
    }
    
    console.log('❌ No content found');
    return null;
    
  } catch (error) {
    console.log('❌ Error:', error.message);
    return null;
  }
}

// AGGRESSIVE cleaning - removes junk but keeps real content
function aggressiveClean(text) {
  if (!text) return '';
  
  console.log('🧹 Starting aggressive clean...');
  
  // Split text into words to analyze
  let words = text.split(/\s+/);
  console.log(`📊 Total words: ${words.length}`);
  
  // Remove CSS/technical words
  words = words.filter(word => {
    // Skip CSS classes and technical stuff
    if (/^\.?\w*_[a-zA-Z0-9]+$/.test(word)) return false; // .spinner_abc123
    if (/^@?\w*(keyframes|animation|transform|cubic|bezier)/.test(word)) return false;
    if (/^\{.*\}$/.test(word)) return false; // CSS blocks
    if (/^(animation|transform|translate)/.test(word)) return false;
    if (/\d+s$/.test(word) && word.includes('infinite')) return false; // 1.05s infinite
    
    return true;
  });
  
  console.log(`📊 After CSS filter: ${words.length} words`);
  
  // Join back
  let cleaned = words.join(' ');
  
  // Remove specific UI phrases
  const uiPhrases = [
    'Add at least one email',
    'Email this answer',
    'Share Answer',
    'Provided by iAsk.ai',
    'Ask AI',
    'Thinking...',
    'Loading...',
    'Please wait'
  ];
  
  uiPhrases.forEach(phrase => {
    cleaned = cleaned.replace(new RegExp(phrase, 'gi'), '');
  });
  
  // Remove footnotes and URLs
  cleaned = cleaned.replace(/\[\d+\]/g, ''); // [1], [2]
  cleaned = cleaned.replace(/https?:\/\/[^\s]+/g, ''); // URLs
  
  // Clean whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  // Remove common prefixes
  cleaned = cleaned.replace(/^(Answer:|Response:|Result:)\s*/i, '');
  
  // If text is too short, return empty
  if (cleaned.length < 20) return '';
  
  // Take first substantial sentence if text is very long
  if (cleaned.length > 500) {
    const sentences = cleaned.split(/[.!?]+/);
    const goodSentences = sentences
      .filter(s => s.trim().length > 30)
      .filter(s => !/email|share|spinner/i.test(s))
      .slice(0, 3); // Take first 3 good sentences
    
    if (goodSentences.length > 0) {
      cleaned = goodSentences.join('. ').trim() + '.';
    }
  }
  
  console.log(`✅ Final cleaned text: ${cleaned.length} chars`);
  return cleaned;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

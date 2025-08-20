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
    console.log(`🔍 Processing query: ${query}`);
    
    const url = `https://www.bing.com/copilotsearch?q=${encodeURIComponent(query)}&FORM=CSSCOP`;
    console.log(`🌐 URL: ${url}`);
    
    // Try multiple times with different strategies
    const maxAttempts = 4;
    const interval = 4000; // 4 seconds
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      console.log(`📡 Attempt ${attempt}/${maxAttempts}: Fetching...`);
      
      if (attempt > 1) {
        await sleep(interval);
      }
      
      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache',
            'Referer': 'https://www.bing.com/'
          }
        });

        if (!response.ok) {
          console.log(`❌ HTTP ${response.status}`);
          continue;
        }

        const html = await response.text();
        console.log(`📄 HTML length: ${html.length} chars`);
        
        // DEBUG: Log page structure
        debugPageStructure(html);
        
        const answerText = extractAnswerWithMultipleStrategies(html);
        
        if (answerText && answerText.length >= 20) {
          console.log(`✅ SUCCESS: ${answerText.length} chars found`);
          
          return res.status(200).json({
            success: true,
            text: answerText,
            query: query,
            attempt: attempt,
            source: 'bing-copilot-multi',
            timestamp: new Date().toISOString(),
            textLength: answerText.length
          });
        }
        
      } catch (error) {
        console.log(`🔥 Attempt ${attempt} error: ${error.message}`);
      }
    }

    return res.status(404).json({
      error: 'No answer found',
      message: 'Could not extract answer from Bing Copilot after debugging multiple strategies',
      query: query,
      debug: 'Check console logs for page structure details'
    });

  } catch (error) {
    return res.status(500).json({
      error: 'Service error',
      details: error.message,
      query: query
    });
  }
};

// DEBUG: Log page structure to understand the HTML
function debugPageStructure(html) {
  try {
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    
    console.log('\n🔍 === PAGE STRUCTURE DEBUG ===');
    
    // Check for various possible containers
    const possibleSelectors = [
      '.answer_container',
      '[class*="answer"]',
      '[class*="response"]',
      '[class*="copilot"]',
      '[class*="result"]',
      '.cib-serp-main',
      '.b_ans',
      '.ans',
      'main',
      '[role="main"]'
    ];
    
    possibleSelectors.forEach(selector => {
      const elements = doc.querySelectorAll(selector);
      if (elements.length > 0) {
        console.log(`✅ Found ${elements.length} elements with selector: ${selector}`);
        elements.forEach((el, i) => {
          const text = el.textContent?.substring(0, 100) || '';
          console.log(`   Element ${i + 1}: "${text}..."`);
        });
      }
    });
    
    // Check for strong tags anywhere
    const allStrongs = doc.querySelectorAll('strong');
    console.log(`📝 Total <strong> tags found: ${allStrongs.length}`);
    
    allStrongs.forEach((strong, i) => {
      if (i < 10) { // Show first 10
        const text = strong.textContent?.substring(0, 50) || '';
        console.log(`   Strong ${i + 1}: "${text}..."`);
      }
    });
    
    console.log('=== END DEBUG ===\n');
    
  } catch (error) {
    console.log('❌ Debug error:', error.message);
  }
}

// Try multiple extraction strategies
function extractAnswerWithMultipleStrategies(html) {
  try {
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    
    // Strategy 1: Original approach (answer_container)
    let result = tryOriginalStrategy(doc);
    if (result) return result;
    
    // Strategy 2: Common Bing answer selectors
    result = tryBingAnswerSelectors(doc);
    if (result) return result;
    
    // Strategy 3: Any strong tags with substantial content
    result = tryAnyStrongTags(doc);
    if (result) return result;
    
    // Strategy 4: Copilot-specific selectors
    result = tryCopilotSelectors(doc);
    if (result) return result;
    
    console.log('❌ All strategies failed');
    return null;
    
  } catch (error) {
    console.log('❌ Extraction error:', error.message);
    return null;
  }
}

// Strategy 1: Original approach
function tryOriginalStrategy(doc) {
  const container = doc.querySelector('div.answer_container');
  if (container) {
    const strongs = container.querySelectorAll('strong');
    return extractTextFromStrongs(strongs, 'Strategy 1 (answer_container)');
  }
  return null;
}

// Strategy 2: Common Bing answer patterns
function tryBingAnswerSelectors(doc) {
  const selectors = [
    '.cib-serp-main strong',
    '.b_ans strong', 
    '.ans strong',
    '[class*="answer"] strong',
    '[class*="response"] strong',
    '[data-testid*="answer"] strong'
  ];
  
  for (const selector of selectors) {
    const strongs = doc.querySelectorAll(selector);
    if (strongs.length > 0) {
      const result = extractTextFromStrongs(strongs, `Strategy 2 (${selector})`);
      if (result) return result;
    }
  }
  return null;
}

// Strategy 3: Any substantial strong tags
function tryAnyStrongTags(doc) {
  const allStrongs = doc.querySelectorAll('strong');
  if (allStrongs.length > 0) {
    return extractTextFromStrongs(allStrongs, 'Strategy 3 (all strongs)', true);
  }
  return null;
}

// Strategy 4: Copilot-specific selectors
function tryCopilotSelectors(doc) {
  const selectors = [
    '[class*="copilot"] strong',
    'main strong',
    '[role="main"] strong',
    '.serp-list strong',
    '.search-results strong'
  ];
  
  for (const selector of selectors) {
    const strongs = doc.querySelectorAll(selector);
    if (strongs.length > 0) {
      const result = extractTextFromStrongs(strongs, `Strategy 4 (${selector})`);
      if (result) return result;
    }
  }
  return null;
}

// Extract and clean text from strong elements
function extractTextFromStrongs(strongs, strategyName, filterQuality = false) {
  const textParts = [];
  
  strongs.forEach((strong, index) => {
    let text = strong.textContent || '';
    text = text.trim();
    
    // Skip loading/empty text
    if (text.length < 3 || isLoadingText(text)) return;
    
    // If filtering for quality, skip navigation/UI text
    if (filterQuality && isUIText(text)) return;
    
    textParts.push(text);
    
    if (index < 5) { // Log first 5 for debugging
      console.log(`   ${strategyName} - Strong ${index + 1}: "${text.substring(0, 30)}..."`);
    }
  });
  
  if (textParts.length === 0) return null;
  
  const result = textParts.join(' ').trim();
  if (result.length >= 20) {
    console.log(`✅ ${strategyName} SUCCESS: ${result.length} chars`);
    return result;
  }
  
  return null;
}

// Check if text indicates loading
function isLoadingText(text) {
  const patterns = [
    /loading/i, /please wait/i, /thinking/i, /searching/i,
    /processing/i, /\.\.\.$/, /^[.\s]*$/
  ];
  return patterns.some(p => p.test(text));
}

// Check if text is UI navigation (for quality filtering)
function isUIText(text) {
  const patterns = [
    /^(home|search|menu|login|sign|back|next|more|less)$/i,
    /^[0-9]+$/, // Just numbers
    /^[a-z]$/i  // Single letters
  ];
  return patterns.some(p => p.test(text));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

